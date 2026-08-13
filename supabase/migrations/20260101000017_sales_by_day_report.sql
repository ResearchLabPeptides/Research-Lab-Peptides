-- =============================================================================
-- 0017  A sales-by-day view that is not capped at 30 days
-- =============================================================================
-- `daily_sales` exists to feed the dashboard chart, so it is a fixed 30-day
-- window built from generate_series — gaps filled with zeroes so the chart does
-- not lie by omission.
--
-- That makes it wrong as a report source. Asking for "this year" and getting
-- thirty rows back, labelled as a year, is worse than getting an error.
--
-- This view covers every day that actually has an order, with no upper bound.
-- It has no zero-filled gaps, which is correct for a spreadsheet: a day with no
-- orders is a day you do not want a row for.

create view sales_by_day with (security_invoker = true) as
select
  date_trunc('day', o.placed_at)::date        as day,
  count(*)                                    as order_count,
  sum(o.subtotal_cents)                       as subtotal_cents,
  sum(o.discount_cents)                       as discount_cents,
  sum(o.delivery_fee_cents)                   as delivery_fee_cents,
  sum(o.tax_cents)                            as tax_cents,
  sum(o.total_cents)                          as revenue_cents,
  sum(o.amount_paid_cents)                    as collected_cents,
  count(*) filter (where o.status = 'pending_payment') as awaiting_payment,
  count(*) filter (where o.coupon_id is not null)      as orders_with_coupon
from orders o
where o.status <> 'cancelled'
group by 1
order by 1 desc;
