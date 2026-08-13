-- =============================================================================
-- 0006  Operational functions — the only supported way to move stock or money
-- =============================================================================

-- Applies one movement and updates the product atomically.
--
-- For physical types (receiving, sale, adjustment, return, damaged, expired,
-- transfer, cycle_count) the before/change/after columns describe
-- `products.quantity`.
--
-- For the two holding types (reservation, reservation_release) they describe
-- `products.quantity_reserved` instead — physical stock has not moved, it is
-- just spoken for. Both live in one ledger so a single query answers
-- "everything that ever happened to this product".
create or replace function apply_inventory_movement(
  p_product_id uuid,
  p_type       movement_type,
  p_change     int,
  p_reason     text default '',
  p_notes      text default '',
  p_reference  text default '',
  p_order_id   uuid default null,
  p_actor_id   uuid default null
)
returns inventory_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product   products;
  v_before    int;
  v_after     int;
  v_actor     uuid := coalesce(p_actor_id, auth.uid());
  v_label     text;
  v_movement  inventory_movements;
  v_reserved  boolean := p_type in ('reservation', 'reservation_release');
begin
  select * into v_product from products where id = p_product_id for update;

  if not found then
    raise exception 'Product % no longer exists.', p_product_id using errcode = 'no_data_found';
  end if;

  v_before := case when v_reserved then v_product.quantity_reserved else v_product.quantity end;
  v_after  := v_before + p_change;

  if v_after < 0 then
    raise exception 'Not enough stock for %: % on hand, % requested.',
      v_product.name, v_before, abs(p_change)
      using errcode = 'check_violation';
  end if;

  if v_reserved then
    if v_after > v_product.quantity then
      raise exception 'Cannot hold % units of %; only % in stock.',
        v_after, v_product.name, v_product.quantity
        using errcode = 'check_violation';
    end if;
    update products set quantity_reserved = v_after where id = p_product_id;
  else
    -- Shrinking physical stock must not strand an existing hold.
    if v_after < v_product.quantity_reserved then
      update products set quantity_reserved = v_after where id = p_product_id;
    end if;
    update products set quantity = v_after where id = p_product_id;
  end if;

  select coalesce(nullif(full_name, ''), email::text) into v_label from profiles where id = v_actor;

  insert into inventory_movements (
    product_id, order_id, type, quantity_before, quantity_change, quantity_after,
    reason, notes, reference, performed_by, performed_label
  )
  values (
    p_product_id, p_order_id, p_type, v_before, p_change, v_after,
    p_reason, p_notes, p_reference, v_actor, coalesce(v_label, 'system')
  )
  returning * into v_movement;

  perform refresh_product_alerts(p_product_id);

  return v_movement;
end;
$$;

-- Opens and closes stock alerts for one product. Idempotent.
create or replace function refresh_product_alerts(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product   products;
  v_threshold int;
  v_warn_days int;
begin
  select * into v_product from products where id = p_product_id;
  if not found then return; end if;

  select low_stock_threshold_default, expiry_warning_days
    into v_threshold, v_warn_days
  from settings where id;

  v_threshold := greatest(coalesce(nullif(v_product.min_quantity, 0), v_threshold), 0);

  -- Out of stock
  if v_product.quantity = 0 and v_product.status = 'active' then
    insert into inventory_alerts (product_id, type, message)
    values (p_product_id, 'out_of_stock', v_product.name || ' is out of stock.')
    on conflict do nothing;
  else
    update inventory_alerts set is_resolved = true, resolved_at = now()
    where product_id = p_product_id and type = 'out_of_stock' and not is_resolved;
  end if;

  -- Low stock
  if v_product.quantity > 0 and v_product.quantity <= v_threshold and v_product.status = 'active' then
    insert into inventory_alerts (product_id, type, message)
    values (p_product_id, 'low_stock',
            v_product.name || ' is down to ' || v_product.quantity || ' ' || v_product.unit || '.')
    on conflict do nothing;
  else
    update inventory_alerts set is_resolved = true, resolved_at = now()
    where product_id = p_product_id and type = 'low_stock' and not is_resolved;
  end if;

  -- Expired / expiring
  if v_product.expiry_date is not null then
    if v_product.expiry_date < current_date then
      insert into inventory_alerts (product_id, type, message)
      values (p_product_id, 'expired',
              v_product.name || ' expired on ' || to_char(v_product.expiry_date, 'Mon DD, YYYY') || '.')
      on conflict do nothing;
      update inventory_alerts set is_resolved = true, resolved_at = now()
      where product_id = p_product_id and type = 'expiring' and not is_resolved;
    elsif v_product.expiry_date <= current_date + v_warn_days then
      insert into inventory_alerts (product_id, type, message)
      values (p_product_id, 'expiring',
              v_product.name || ' expires ' || to_char(v_product.expiry_date, 'Mon DD, YYYY') || '.')
      on conflict do nothing;
    else
      update inventory_alerts set is_resolved = true, resolved_at = now()
      where product_id = p_product_id and type in ('expiring', 'expired') and not is_resolved;
    end if;
  end if;
end;
$$;

-- Keeps alerts honest when an admin edits thresholds, expiry, or status by hand.
create or replace function products_refresh_alerts_trigger()
returns trigger
language plpgsql
as $$
begin
  perform refresh_product_alerts(new.id);
  return new;
end;
$$;

create trigger products_alerts_sync
  after insert or update of quantity, min_quantity, expiry_date, status on products
  for each row execute function products_refresh_alerts_trigger();

-- =============================================================================
-- Checkout
-- =============================================================================
-- Called by the server with the service role. Prices, delivery fees, and taxes
-- are all recomputed here — the browser's numbers are treated as a suggestion,
-- never as input.
--
-- p_payload:
-- {
--   "customer": { "name", "email", "phone" },
--   "address":  { "line1", "line2", "city", "province", "postal_code", "notes" },
--   "items":    [ { "product_id": uuid, "quantity": int }, ... ]
-- }

create or replace function place_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item          jsonb;
  v_product       products;
  v_quantity      int;
  v_subtotal      int := 0;
  v_tax_rate      int;
  v_quote         jsonb;
  v_delivery_fee  int;
  v_tax           int;
  v_total         int;
  v_order_id      uuid := gen_random_uuid();
  v_order_number  text;
  v_postal        text;
  v_eta_max       int;
  v_line_total    int;
begin
  if jsonb_array_length(coalesce(p_payload -> 'items', '[]'::jsonb)) = 0 then
    raise exception 'Add at least one item before checking out.' using errcode = 'check_violation';
  end if;

  v_postal := normalize_postal(p_payload #>> '{address,postal_code}');
  if v_postal is null then
    raise exception 'A postal code is required.' using errcode = 'check_violation';
  end if;

  -- Lock every product in a stable order so concurrent checkouts queue instead
  -- of deadlocking.
  perform 1
  from products
  where id in (
    select (value ->> 'product_id')::uuid
    from jsonb_array_elements(p_payload -> 'items')
  )
  order by id
  for update;

  for v_item in select * from jsonb_array_elements(p_payload -> 'items')
  loop
    v_quantity := (v_item ->> 'quantity')::int;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Item quantities must be at least 1.' using errcode = 'check_violation';
    end if;

    select * into v_product from products where id = (v_item ->> 'product_id')::uuid;

    if not found or v_product.status <> 'active' then
      raise exception 'One of the items is no longer available.' using errcode = 'no_data_found';
    end if;

    if (v_product.quantity - v_product.quantity_reserved) < v_quantity then
      raise exception '% only has % left.', v_product.name,
        (v_product.quantity - v_product.quantity_reserved)
        using errcode = 'check_violation';
    end if;

    v_subtotal := v_subtotal + (v_product.price_cents * v_quantity);
  end loop;

  v_quote := quote_delivery(v_postal, p_payload #>> '{address,city}', v_subtotal);

  if not (v_quote ->> 'deliverable')::boolean then
    raise exception '%', v_quote ->> 'message' using errcode = 'check_violation';
  end if;

  v_delivery_fee := (v_quote ->> 'fee_cents')::int;
  v_eta_max      := (v_quote ->> 'eta_max_minutes')::int;

  select tax_rate_bps into v_tax_rate from settings where id;
  v_tax   := round((v_subtotal + v_delivery_fee) * v_tax_rate / 10000.0);
  v_total := v_subtotal + v_delivery_fee + v_tax;

  v_order_number := next_order_number();

  insert into orders (
    id, order_number, customer_name, customer_email, customer_phone,
    address_line1, address_line2, city, province, postal_code, delivery_notes,
    delivery_zone_id, delivery_zone_name,
    subtotal_cents, delivery_fee_cents, tax_cents, total_cents, tax_rate_bps,
    inventory_reserved, estimated_delivery_at
  )
  values (
    v_order_id, v_order_number,
    p_payload #>> '{customer,name}',
    p_payload #>> '{customer,email}',
    p_payload #>> '{customer,phone}',
    p_payload #>> '{address,line1}',
    coalesce(p_payload #>> '{address,line2}', ''),
    p_payload #>> '{address,city}',
    coalesce(p_payload #>> '{address,province}', 'BC'),
    v_postal,
    coalesce(p_payload #>> '{address,notes}', ''),
    (v_quote ->> 'zone_id')::uuid,
    v_quote ->> 'zone_name',
    v_subtotal, v_delivery_fee, v_tax, v_total, v_tax_rate,
    true,
    now() + make_interval(mins => v_eta_max)
  );

  for v_item in select * from jsonb_array_elements(p_payload -> 'items')
  loop
    v_quantity := (v_item ->> 'quantity')::int;
    select * into v_product from products where id = (v_item ->> 'product_id')::uuid;
    v_line_total := v_product.price_cents * v_quantity;

    insert into order_items (
      order_id, product_id, sku, name, unit, unit_price_cents, quantity, line_total_cents
    )
    values (
      v_order_id, v_product.id, v_product.sku, v_product.name, v_product.unit,
      v_product.price_cents, v_quantity, v_line_total
    );

    -- Hold the stock. It stays held until payment lands or the order is cancelled.
    perform apply_inventory_movement(
      v_product.id, 'reservation', v_quantity,
      'Order placed', '', v_order_number, v_order_id
    );
  end loop;

  insert into order_status_history (order_id, to_status, note)
  values (v_order_id, 'pending_payment', 'Order placed. Awaiting Interac e-Transfer.');

  perform log_activity('order.placed', 'order', v_order_number,
    jsonb_build_object('total_cents', v_total, 'items', jsonb_array_length(p_payload -> 'items')));

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'subtotal_cents', v_subtotal,
    'delivery_fee_cents', v_delivery_fee,
    'tax_cents', v_tax,
    'total_cents', v_total,
    'zone_name', v_quote ->> 'zone_name',
    'estimated_delivery_at', (now() + make_interval(mins => v_eta_max))
  );
end;
$$;

-- =============================================================================
-- Payment confirmation
-- =============================================================================
-- Interac e-Transfers are matched by hand. When the full amount is in, the held
-- stock converts to a permanent sale and the order moves to Preparing.

create or replace function confirm_payment(
  p_order_id     uuid,
  p_amount_cents int,
  p_received_at  timestamptz default now(),
  p_reference    text default '',
  p_notes        text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
  v_item  order_items;
  v_paid  int;
  v_advance boolean;
begin
  if not has_min_role('employee') then
    raise exception 'You do not have permission to record payments.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'no_data_found';
  end if;

  if v_order.status in ('cancelled', 'refunded') then
    raise exception 'Order % is %.', v_order.order_number, v_order.status
      using errcode = 'check_violation';
  end if;

  insert into payments (order_id, amount_cents, reference, notes, received_at, recorded_by)
  values (p_order_id, p_amount_cents, p_reference, p_notes, p_received_at, auth.uid());

  v_paid := v_order.amount_paid_cents + p_amount_cents;

  if v_paid < v_order.total_cents then
    update orders
       set amount_paid_cents = v_paid,
           payment_status = 'partially_paid'
     where id = p_order_id;

    perform log_activity('payment.partial', 'order', v_order.order_number,
      jsonb_build_object('amount_cents', p_amount_cents, 'paid_cents', v_paid));

    return jsonb_build_object('fully_paid', false, 'amount_paid_cents', v_paid,
                              'balance_cents', v_order.total_cents - v_paid);
  end if;

  -- Paid in full. Release each hold and post the sale against physical stock.
  if not v_order.inventory_deducted then
    for v_item in select * from order_items where order_id = p_order_id
    loop
      if v_item.product_id is not null then
        if v_order.inventory_reserved then
          perform apply_inventory_movement(
            v_item.product_id, 'reservation_release', -v_item.quantity,
            'Payment received', '', v_order.order_number, p_order_id);
        end if;

        perform apply_inventory_movement(
          v_item.product_id, 'sale', -v_item.quantity,
          'Payment received', '', v_order.order_number, p_order_id);
      end if;
    end loop;
  end if;

  -- Only advance an order that is still waiting on money. A late or corrected
  -- payment against an order that already shipped must not drag it backwards.
  v_advance := v_order.status in ('pending_payment', 'payment_received');

  update orders
     set amount_paid_cents = v_paid,
         payment_status = 'paid',
         paid_at = coalesce(paid_at, p_received_at),
         status = case when v_advance then 'preparing'::order_status else status end,
         inventory_reserved = false,
         inventory_deducted = true
   where id = p_order_id;

  if v_advance then
    insert into order_status_history (order_id, from_status, to_status, note, changed_by)
    values (p_order_id, v_order.status, 'preparing', 'Interac e-Transfer confirmed.', auth.uid());
  end if;

  perform log_activity('payment.confirmed', 'order', v_order.order_number,
    jsonb_build_object('amount_cents', p_amount_cents));

  return jsonb_build_object(
    'fully_paid', true,
    'amount_paid_cents', v_paid,
    'status', case when v_advance then 'preparing' else v_order.status::text end);
end;
$$;

-- =============================================================================
-- Status changes
-- =============================================================================

create or replace function set_order_status(
  p_order_id uuid,
  p_status   order_status,
  p_note     text default ''
)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    orders;
  v_item     order_items;
  v_previous order_status;
begin
  if not has_min_role('employee') then
    raise exception 'You do not have permission to change order status.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'no_data_found';
  end if;

  if v_order.status = p_status then
    return v_order;
  end if;

  -- Cancelling or refunding puts stock back where it came from.
  if p_status in ('cancelled', 'refunded') then
    for v_item in select * from order_items where order_id = p_order_id
    loop
      if v_item.product_id is null then continue; end if;

      if v_order.inventory_reserved then
        perform apply_inventory_movement(
          v_item.product_id, 'reservation_release', -v_item.quantity,
          initcap(p_status::text), p_note, v_order.order_number, p_order_id);
      elsif v_order.inventory_deducted then
        perform apply_inventory_movement(
          v_item.product_id, 'return', v_item.quantity,
          initcap(p_status::text), p_note, v_order.order_number, p_order_id);
      end if;
    end loop;
  end if;

  v_previous := v_order.status;

  update orders
     set status = p_status,
         inventory_reserved = case when p_status in ('cancelled','refunded') then false else inventory_reserved end,
         inventory_deducted = case when p_status in ('cancelled','refunded') then false else inventory_deducted end,
         payment_status     = case when p_status = 'refunded' then 'refunded'::payment_status else payment_status end,
         delivered_at       = case when p_status = 'delivered' then now() else delivered_at end,
         cancelled_at       = case when p_status in ('cancelled','refunded') then now() else cancelled_at end
   where id = p_order_id
  returning * into v_order;

  insert into order_status_history (order_id, from_status, to_status, note, changed_by)
  values (p_order_id, v_previous, p_status, p_note, auth.uid());

  perform log_activity('order.status_changed', 'order', v_order.order_number,
    jsonb_build_object('to', p_status, 'note', p_note));

  return v_order;
end;
$$;

-- =============================================================================
-- Customer order lookup — order number + email, no account
-- =============================================================================

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
    'delivery_fee_cents', v_order.delivery_fee_cents,
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
