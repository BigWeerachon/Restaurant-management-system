-- =============================================================================
-- Sabai — V1.1: opening stock for a newly added ingredient.
-- Mirrors apps/web/src/lib/demo/engine.ts's addIngredient (openingQty): the
-- quantity already on the shelf when the ingredient is first entered, recorded
-- as an 'opening' movement so the ledger still explains every gram.
-- =============================================================================
create or replace function app.record_opening_stock(p_location uuid, p_ingredient uuid, p_qty numeric, p_unit_cost numeric default 0)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  loc app.stock_locations;
  v_id uuid;
begin
  select * into loc from app.stock_locations where stock_locations.id = p_location;
  if not found then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'location')); end if;
  perform app.assert_permission(loc.tenant_id, 'inventory.manage', loc.branch_id);
  if p_qty is null or p_qty <= 0 then perform app.raise_error('INVALID_QTY'); end if;
  if p_unit_cost is null or p_unit_cost < 0 then perform app.raise_error('INVALID_AMOUNT'); end if;
  insert into app.stock_movements (tenant_id, branch_id, location_id, ingredient_id, qty, unit_cost, reason,
                                   source_type, business_date, created_by)
  values (loc.tenant_id, loc.branch_id, loc.id, p_ingredient, p_qty, p_unit_cost, 'opening', 'opening',
          app.business_date(loc.branch_id), app.actor_membership_id(loc.tenant_id))
  returning stock_movements.id into v_id;
  perform app.emit_event(loc.tenant_id, loc.branch_id, 'ingredient', p_ingredient, 'inventory.opening_stock',
    jsonb_build_object('qty', p_qty, 'unit_cost', p_unit_cost));
  return v_id;
end;
$$;
