-- =============================================================================
-- 0016  Show the discount on the customer's tracking page
-- =============================================================================
-- lookup_order() predates coupons. It returned the subtotal, delivery, tax, and
-- total, so an order with a coupon on it did not add up on screen:
--
--   $49.90 + $0.00 delivery + $2.25 tax  ≠  $47.16 total
--
-- The total was right; the line explaining the gap was missing. A customer
-- seeing that has every reason to think they have been overcharged, and it is
-- the sort of thing that generates a phone call rather than a complaint.
--
-- Also surfaces the delivery promotion label, so "Free delivery on 5 items or
-- more" is visible on the receipt rather than an unexplained zero.

create or replace function lookup_order(p_order_number text, p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_order orders;
begin
  select * into v_order
  from orders
  where upper(order_number) = upper(trim(p_order_number))
    and customer_email = trim(p_email)::citext;

  if not found then
    -- Deliberately vague: this endpoint is unauthenticated, so it must not
    -- confirm whether an order number exists.
    return jsonb_build_object('found', false,
      'message', 'No order matches that order number and email.');
  end if;

  return jsonb_build_object(
    'found', true,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'placed_at', v_order.placed_at,
    'estimated_delivery_at', v_order.estimated_delivery_at,
    'delivered_at', v_order.delivered_at,
    'tracking_notes', v_order.tracking_notes,
    'customer_name', v_order.customer_name,
    'address', jsonb_build_object(
      'line1', v_order.address_line1, 'line2', v_order.address_line2,
      'city', v_order.city, 'province', v_order.province, 'postal_code', v_order.postal_code
    ),
    'subtotal_cents', v_order.subtotal_cents,
    'discount_cents', v_order.discount_cents,
    'coupon_code', v_order.coupon_code,
    'coupon_label', v_order.coupon_label,
    'delivery_fee_cents', v_order.delivery_fee_cents,
    'delivery_discount_label', v_order.delivery_discount_label,
    'tax_cents', v_order.tax_cents,
    'total_cents', v_order.total_cents,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', name, 'sku', sku, 'quantity', quantity,
        'unit_price_cents', unit_price_cents, 'line_total_cents', line_total_cents
      ) order by name), '[]'::jsonb)
      from order_items where order_id = v_order.id
    )
  );
end;
$$;

grant execute on function lookup_order(text, text) to anon, authenticated;
