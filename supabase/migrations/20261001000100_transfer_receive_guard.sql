-- =============================================================================
-- Sabai — a transfer cannot be received for more than was sent.
--
-- `receive_transfer` took whatever quantity the receiver typed. Typing more than was sent put stock into the destination that
-- the source never gave up — stock made out of nothing, and a stock value that no movement explains. (Found while writing the
-- first tests of transfers, 003_transfers_and_reopen.sql.) The receipt is now refused, and nothing is changed.
-- Receiving less is still allowed: the difference becomes a visible transfer loss at the receiving branch.
-- Everything else in the function is as it was in 20260927000600_purchasing_inventory_ops.sql.
-- =============================================================================
create or replace function app.receive_transfer(p_transfer uuid, p_lines jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  tr app.stock_transfers;
  actor uuid;
  bd date;
begin
  select * into tr from app.stock_transfers where id = p_transfer for update;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  perform app.assert_permission(tr.tenant_id, 'inventory.receive', tr.to_branch_id);
  if tr.status <> 'sent' then perform app.raise_error('TRANSFER_NOT_SENT'); end if;
  actor := app.actor_membership_id(tr.tenant_id);
  bd := app.business_date(tr.to_branch_id);

  if exists (select 1
               from jsonb_array_elements(p_lines) x
               join app.stock_transfer_lines l on l.transfer_id = tr.id and l.ingredient_id = (x->>'ingredient_id')::uuid
              where (x->>'qty_received')::numeric > l.qty_sent) then
    perform app.raise_error('TRANSFER_OVER_RECEIVED');
  end if;

  update app.stock_transfer_lines l
     set qty_received = coalesce((select (x->>'qty_received')::numeric from jsonb_array_elements(p_lines) x
                                   where (x->>'ingredient_id')::uuid = l.ingredient_id), l.qty_sent)
   where l.transfer_id = tr.id;

  insert into app.stock_movements (tenant_id, branch_id, location_id, ingredient_id, qty, unit_cost, reason, source_type, source_id, business_date, created_by)
  select tr.tenant_id, tr.to_branch_id, tr.to_location_id, l.ingredient_id, l.qty_received, l.unit_cost, 'transfer_in', 'transfer', tr.id, bd, actor
    from app.stock_transfer_lines l where l.transfer_id = tr.id and l.qty_received > 0;

  -- Short deliveries become visible waste at the receiving branch, not silent loss.
  insert into app.stock_movements (tenant_id, branch_id, location_id, ingredient_id, qty, unit_cost, reason, reason_code, source_type, source_id, business_date, created_by, note)
  select tr.tenant_id, tr.to_branch_id, tr.to_location_id, l.ingredient_id, l.qty_sent - l.qty_received, l.unit_cost, 'transfer_in', 'transfer_loss', 'transfer', tr.id, bd, actor, 'ส่วนต่างการโอน'
    from app.stock_transfer_lines l where l.transfer_id = tr.id and l.qty_received < l.qty_sent;
  insert into app.stock_movements (tenant_id, branch_id, location_id, ingredient_id, qty, reason, reason_code, source_type, source_id, business_date, created_by, note)
  select tr.tenant_id, tr.to_branch_id, tr.to_location_id, l.ingredient_id, -(l.qty_sent - l.qty_received), 'waste', 'transfer_loss', 'transfer', tr.id, bd, actor, 'ส่วนต่างการโอน'
    from app.stock_transfer_lines l where l.transfer_id = tr.id and l.qty_received < l.qty_sent;

  update app.stock_transfers set status = 'received', received_by = actor, received_at = now() where id = tr.id;
  perform app.emit_event(tr.tenant_id, tr.from_branch_id, 'transfer', tr.id, 'inventory.transfer_received',
    jsonb_build_object('transfer_no', tr.transfer_no), actor);
end;
$$;
