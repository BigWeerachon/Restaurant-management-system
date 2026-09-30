-- =============================================================================
-- Sabai — V1.1: delivery menu prices, in the database.
-- A delivery platform's menu usually costs more than the shop's own (the platform
-- keeps a share). The web demo has always modelled that as a markup on the base
-- price rounded up to a friendly ฿5; the database had nowhere to keep it, so a shop
-- on the API charged base prices on every channel. `price_markup` is that markup
-- (0.15 = +15 %), and `resolve_menu_price` applies it when nobody has set an
-- explicit price for the item on that channel. Same rounding as
-- packages/domain/src/pricing.ts `channelPrice` (a test holds them together).
-- =============================================================================
alter table app.sales_channels
  add column price_markup numeric(5,4) not null default 0 check (price_markup between 0 and 1);

create or replace function app.resolve_menu_price(p_item uuid, p_channel uuid, p_branch uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select p.price from app.menu_item_prices p where p.menu_item_id = p_item and p.channel_id = p_channel and p.branch_id = p_branch),
    (select p.price from app.menu_item_prices p where p.menu_item_id = p_item and p.channel_id = p_channel and p.branch_id is null),
    (select p.price from app.menu_item_prices p where p.menu_item_id = p_item and p.channel_id is null and p.branch_id = p_branch),
    (select case when coalesce(c.price_markup, 0) > 0 then ceil(i.price * (1 + c.price_markup) / 5) * 5 else i.price end
       from app.menu_items i left join app.sales_channels c on c.id = p_channel
      where i.id = p_item)
  )
$$;
