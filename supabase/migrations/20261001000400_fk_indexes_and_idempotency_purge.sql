-- =============================================================================
-- Sabai — (1) an index behind every foreign key that has none, (2) a purge for stale Idempotency-Key rows.
--
-- 1. A foreign key without an index makes every delete or key change on the parent table scan the whole child table, and every
--    join from parent to child read it whole. Migration 20261001000300 added the seven that the hot screens need; this one
--    covers the rest. Each index is on the key's columns without the leading tenant_id (ids are unique), which serves both the key's check and the join; a key already covered by an index that starts with those columns gets nothing new.
--    Left out on purpose — the two busiest append-only writers, where each extra index slows every sale and every stock
--    movement and nothing deletes their parents: stock_movements, journal_lines. (The columns they are looked up by already
--    have indexes of their own.) Tables created later are held to the same rule by 005_foreign_key_indexes.sql, which fails
--    on any foreign key that has neither an index nor a line in its exemption list.
--    `create index` blocks writes while it builds: on a database that already holds a lot of data, create these by hand first with
--    `create index concurrently` under the same names (this statement then skips them).
--
-- 2. `app.api_idempotency` keeps one row per Idempotency-Key. A stored answer is only replayed for 24 hours (and a claim that
--    never finished is taken over after 2 minutes), so older rows can never be used again. `app.purge_idempotency` deletes them,
--    in batches so one run never holds a long lock; the API runs it every hour (apps/api/src/maintenance.ts). Safe to run as
--    often as you like. Not tenant data: the table is infrastructure, written only by the API's service connection.
-- =============================================================================
do $$
declare
  fk record;
  v_name text;
begin
  -- `lookup` is the foreign key's columns without the leading tenant_id: ids are unique, so an index on them alone answers the
  -- foreign key's check (`tenant_id = $1 and parent_id = $2`) and the join, and is smaller than one that starts with tenant_id.
  -- A key counts as indexed when some valid index starts with those columns (or with the whole key).
  for fk in
    select cl.relname,
           l.lookup,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
              from unnest(l.lookup) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols,
           (select string_agg(a.attname, '_' order by k.ord)
              from unnest(l.lookup) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as name_part,
           c.conrelid
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      cross join lateral (
        select coalesce(array_agg(k.attnum order by k.ord) filter (where a.attname <> 'tenant_id'), c.conkey) as lookup
          from unnest(c.conkey) with ordinality k(attnum, ord)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) l
     where c.contype = 'f'
       and c.connamespace = 'app'::regnamespace
       and cl.relname not in ('stock_movements', 'journal_lines')
       and not exists (
         select 1 from pg_index i
          where i.indrelid = c.conrelid and i.indisvalid
            and ((i.indkey::int2[])[0:cardinality(l.lookup) - 1] = l.lookup::int2[]
              or (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey))
     order by cl.relname, c.conname
  loop
    v_name := fk.relname || '_' || fk.name_part || '_fk';
    if length(v_name) > 63 then
      v_name := left(fk.relname || '_' || fk.name_part, 52) || '_' || substr(md5(fk.relname || '_' || fk.name_part), 1, 7) || '_fk';
    end if;
    execute format('create index if not exists %I on app.%I (%s)', v_name, fk.relname, fk.cols);
  end loop;
end $$;

create or replace function app.purge_idempotency(p_now timestamptz default now(), p_batch int default 5000)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted int;
  v_total int := 0;
begin
  loop
    with doomed as (
      select tenant_id, key from app.api_idempotency
       where created_at < p_now - interval '24 hours'
       order by created_at
       limit p_batch
       for update skip locked)
    delete from app.api_idempotency k using doomed d
     where k.tenant_id = d.tenant_id and k.key = d.key;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
    exit when v_deleted < p_batch;
  end loop;
  return v_total;
end $$;

-- Internal: only the API's service connection runs it, never a signed-in person.
revoke execute on function app.purge_idempotency(timestamptz, int) from public, anon, authenticated;
