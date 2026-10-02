-- =============================================================================
-- Every foreign key in `app` has an index that starts with its columns (not counting tenant_id) (migration
-- 20261001000400_fk_indexes_and_idempotency_purge.sql), so deleting or joining through a parent never reads a whole child table.
-- stock_movements and journal_lines are exempt on purpose (busiest append-only writers; see the migration header). A new table
-- with a foreign key must index it or be added to the exemptions here with a reason.
-- Also: the purge of stale Idempotency-Key rows.
-- =============================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;

create schema if not exists test;
create or replace function test.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERTION FAILED: %', p_msg; end if;
end $$;

do $$
declare v_missing text;
begin
  select string_agg(c.conrelid::regclass::text || ' (' || c.conname || ')', ', ') into v_missing
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    cross join lateral (
      select coalesce(array_agg(k.attnum order by k.ord) filter (where a.attname <> 'tenant_id'), c.conkey) as lookup
        from unnest(c.conkey) with ordinality k(attnum, ord)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) l
   where c.contype = 'f' and c.connamespace = 'app'::regnamespace
     and cl.relname not in ('stock_movements', 'journal_lines')
     and not exists (
       select 1 from pg_index i
        where i.indrelid = c.conrelid and i.indisvalid
          and ((i.indkey::int2[])[0:cardinality(l.lookup) - 1] = l.lookup::int2[]
            or (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey));
  perform test.ok(v_missing is null, 'every foreign key has an index: ' || coalesce(v_missing, ''));
end $$;

-- ---- purge of stale Idempotency-Key rows ------------------------------------------------------------------------------------
do $$
declare
  t1 uuid := gen_random_uuid();
  t2 uuid := gen_random_uuid();
  v_n int;
begin
  delete from app.api_idempotency;
  insert into app.api_idempotency (tenant_id, key, method, path, request_hash, status, response, created_at) values
    (t1, 'fresh-key-0001', 'POST', '/v1/x', 'h', 200, '{}', now() - interval '1 hour'),
    (t1, 'edge-key-00001', 'POST', '/v1/x', 'h', 200, '{}', now() - interval '23 hours 59 minutes'),
    (t1, 'stale-key-0001', 'POST', '/v1/x', 'h', 200, '{}', now() - interval '24 hours 1 minute'),
    (t2, 'stale-key-0001', 'POST', '/v1/x', 'h', 200, '{}', now() - interval '3 days'),
    (t2, 'stuck-claim-01', 'POST', '/v1/x', 'h', 0,   '{}', now() - interval '2 days');

  v_n := app.purge_idempotency();
  perform test.ok(v_n = 3, 'purge removes the three rows older than 24 h, got ' || v_n);
  perform test.ok((select count(*) from app.api_idempotency) = 2, 'the two recent rows stay');
  perform test.ok(exists (select 1 from app.api_idempotency where key = 'edge-key-00001'), 'a row just inside 24 h stays');
  perform test.ok(app.purge_idempotency() = 0, 'running it again finds nothing');

  -- Batches: more rows than one batch is all removed.
  insert into app.api_idempotency (tenant_id, key, method, path, request_hash, status, response, created_at)
    select t1, 'bulk-key-' || g, 'POST', '/v1/x', 'h', 200, '{}', now() - interval '2 days' from generate_series(1, 25) g;
  v_n := app.purge_idempotency(now(), 10);
  perform test.ok(v_n = 25, 'purge loops over batches, got ' || v_n);
  perform test.ok((select count(*) from app.api_idempotency) = 2, 'only the recent rows remain after batching');

  -- "now" can be given, so a later moment purges what is then older than 24 h.
  perform test.ok(app.purge_idempotency(now() + interval '2 days') = 2, 'purge as of a later moment');
end $$;

-- Not callable by a signed-in person.
do $$
declare v_denied boolean := false;
begin
  set local role authenticated;
  begin
    perform app.purge_idempotency();
  exception when insufficient_privilege then v_denied := true;
  end;
  reset role;
  perform test.ok(v_denied, 'authenticated cannot run the purge');
end $$;
