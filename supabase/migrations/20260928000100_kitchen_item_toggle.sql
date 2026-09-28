-- =============================================================================
-- Sabai — V1.1: toggle a single kitchen ticket item (not the whole ticket).
-- Mirrors apps/web/src/lib/demo/engine.ts's toggleTicketItem: a cook can mark
-- one item on a multi-item ticket done (or undo that) without bumping items
-- that aren't ready yet. First toggle on a fresh ticket also starts it, same
-- as tapping any item is "starting the ticket".
-- =============================================================================
create or replace function app.toggle_ticket_item(p_ticket_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ti app.kitchen_ticket_items;
  kt app.kitchen_tickets;
begin
  select * into ti from app.kitchen_ticket_items where id = p_ticket_item_id for update;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  select * into kt from app.kitchen_tickets where id = ti.ticket_id for update;
  perform app.assert_permission(kt.tenant_id, 'kds.bump', kt.branch_id);
  if kt.status = 'cancelled' then perform app.raise_error('TICKET_CANCELLED'); end if;
  if ti.status = 'voided' then return; end if;

  update app.kitchen_ticket_items
     set status = case when status = 'done' then 'pending' else 'done' end,
         done_at = case when status = 'done' then null else now() end
   where id = ti.id;

  if kt.status = 'new' then
    update app.kitchen_tickets set status = 'in_progress', started_at = coalesce(started_at, now()) where id = kt.id;
  end if;

  perform app.emit_event(kt.tenant_id, kt.branch_id, 'kitchen_ticket', kt.id, 'kitchen.item_toggled',
    jsonb_build_object('ticket_item_id', ti.id, 'order_id', kt.order_id), app.actor_membership_id(kt.tenant_id));
end;
$$;
