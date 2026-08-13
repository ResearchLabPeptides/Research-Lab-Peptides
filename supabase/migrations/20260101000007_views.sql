-- =============================================================================
-- 0007  Reporting views
-- =============================================================================
-- security_invoker keeps RLS in force: a view can never be a way around a policy.

create view product_stock with (security_invoker = true) as
select
  p.id,
  p.sku,
  p.name,
  p.slug,
  p.status,
  p.unit,
  p.price_cents,
  p.cost_cents,
  p.quantity,
  p.quantity_reserved,
  p.quantity - p.quantity_reserved            as quantity_available,
  p.min_quantity,
  p.expiry_date,
  c.name                                      as category_name,
  s.name                                      as supplier_name,
  p.quantity * p.cost_cents                   as stock_value_cents,
  (p.quantity = 0)                            as is_out_of_stock,
  (p.quantity > 0 and p.quantity <= greatest(p.min_quantity, 0)) as is_low_stock
from products p
left join categories c on c.id = p.category_id
left join suppliers  s on s.id = p.supplier_id;

-- One row. Everything the dashboard tiles need, in a single round trip.
create view dashboard_metrics with (security_invoker = true) as
select
  (select coalesce(sum(total_cents), 0) from orders
    where placed_at >= date_trunc('day', now()) and status <> 'cancelled')      as sales_today_cents,
  (select count(*) from orders
    where placed_at >= date_trunc('day', now()))                                as orders_today,
  (select count(*) from orders where status = 'pending_payment')                as pending_payments,
  (select coalesce(sum(total_cents), 0) from orders
    where status = 'pending_payment')                                           as pending_payment_cents,
  (select count(*) from orders
    where status in ('preparing', 'out_for_delivery'))                          as pending_deliveries,
  (select coalesce(sum(quantity * cost_cents), 0) from products
    where status = 'active')                                                    as inventory_value_cents,
  (select count(*) from products
    where status = 'active' and quantity > 0 and quantity <= greatest(min_quantity, 0)) as low_stock_count,
  (select count(*) from products
    where status = 'active' and quantity = 0)                                   as out_of_stock_count,
  (select coalesce(sum(total_cents), 0) from orders
    where placed_at >= date_trunc('month', now()) and status <> 'cancelled')    as revenue_month_cents,
  (select coalesce(sum(delivery_fee_cents), 0) from orders
    where placed_at >= date_trunc('month', now()) and status <> 'cancelled')    as delivery_fees_month_cents,
  (select count(*) from inventory_alerts where not is_resolved)                 as open_alerts;

-- Last 30 days of sales, one row per day, gaps filled with zero so charts do
-- not lie by omission.
create view daily_sales with (security_invoker = true) as
select
  d.day::date                              as day,
  coalesce(count(o.id), 0)                 as order_count,
  coalesce(sum(o.total_cents), 0)          as revenue_cents,
  coalesce(sum(o.delivery_fee_cents), 0)   as delivery_fee_cents
from generate_series(current_date - interval '29 days', current_date, interval '1 day') as d(day)
left join orders o
  on o.placed_at >= d.day
 and o.placed_at <  d.day + interval '1 day'
 and o.status <> 'cancelled'
group by d.day
order by d.day;

create view top_selling_products with (security_invoker = true) as
select
  oi.product_id,
  oi.sku,
  oi.name,
  sum(oi.quantity)         as units_sold,
  sum(oi.line_total_cents) as revenue_cents,
  count(distinct oi.order_id) as order_count
from order_items oi
join orders o on o.id = oi.order_id
where o.status not in ('cancelled', 'refunded')
  and o.placed_at >= now() - interval '90 days'
group by oi.product_id, oi.sku, oi.name
order by units_sold desc;

create view inventory_movement_report with (security_invoker = true) as
select
  m.id,
  m.created_at,
  m.type,
  p.sku,
  p.name          as product_name,
  m.quantity_before,
  m.quantity_change,
  m.quantity_after,
  m.reason,
  m.notes,
  m.reference,
  m.performed_label,
  o.order_number
from inventory_movements m
join products p on p.id = m.product_id
left join orders o on o.id = m.order_id;

create view open_alerts with (security_invoker = true) as
select
  a.id,
  a.type,
  a.message,
  a.created_at,
  p.id   as product_id,
  p.sku,
  p.name as product_name,
  p.quantity,
  p.expiry_date
from inventory_alerts a
join products p on p.id = a.product_id
where not a.is_resolved
order by
  case a.type
    when 'out_of_stock' then 0
    when 'expired'      then 1
    when 'low_stock'    then 2
    when 'expiring'     then 3
  end,
  a.created_at desc;

create view delivery_charge_report with (security_invoker = true) as
select
  date_trunc('day', o.placed_at)::date as day,
  o.delivery_zone_name                 as zone,
  count(*)                             as orders,
  sum(o.delivery_fee_cents)            as delivery_fees_cents,
  sum(o.subtotal_cents)                as subtotal_cents
from orders o
where o.status <> 'cancelled'
group by 1, 2
order by 1 desc, 2;
