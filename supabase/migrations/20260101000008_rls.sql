-- =============================================================================
-- 0008  Row Level Security
-- =============================================================================
-- Default posture: deny. The storefront (anon) may read active catalog data and
-- nothing else. It cannot read orders, costs, suppliers, or stock ledgers.
-- Orders are created only through place_order(), which runs as definer.

alter table profiles            enable row level security;
alter table settings            enable row level security;
alter table activity_log        enable row level security;
alter table categories          enable row level security;
alter table suppliers           enable row level security;
alter table products            enable row level security;
alter table product_images      enable row level security;
alter table product_documents   enable row level security;
alter table supplier_documents  enable row level security;
alter table delivery_zones      enable row level security;
alter table delivery_rules      enable row level security;
alter table orders              enable row level security;
alter table order_items         enable row level security;
alter table order_status_history enable row level security;
alter table payments            enable row level security;
alter table inventory_movements enable row level security;
alter table inventory_alerts    enable row level security;
alter table order_counters      enable row level security;

-- --- Profiles ----------------------------------------------------------------

create policy "staff read profiles" on profiles
  for select using (is_staff());

create policy "own profile update" on profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = current_role_name());  -- cannot self-promote

create policy "admins manage profiles" on profiles
  for all using (has_min_role('administrator')) with check (has_min_role('administrator'));

-- --- Settings ----------------------------------------------------------------
-- Anonymous visitors need company name, currency, tax rate, and the payment
-- email to render the storefront. Those columns carry no risk; the row is
-- readable and only administrators may write it.

create policy "anyone reads settings" on settings for select using (true);
create policy "admins write settings" on settings
  for update using (has_min_role('administrator')) with check (has_min_role('administrator'));

-- --- Catalog -----------------------------------------------------------------

create policy "anyone reads active categories" on categories
  for select using (is_active or is_staff());
create policy "managers write categories" on categories
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

create policy "anyone reads active products" on products
  for select using (status = 'active' or is_staff());
create policy "managers write products" on products
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

create policy "anyone reads images of active products" on product_images
  for select using (
    is_staff() or exists (
      select 1 from products p where p.id = product_id and p.status = 'active'
    )
  );
create policy "managers write product images" on product_images
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

create policy "staff read product documents" on product_documents
  for select using (is_staff());
create policy "managers write product documents" on product_documents
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

create policy "staff read suppliers" on suppliers for select using (is_staff());
create policy "managers write suppliers" on suppliers
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

create policy "staff read supplier documents" on supplier_documents
  for select using (is_staff());
create policy "managers write supplier documents" on supplier_documents
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

-- --- Delivery ----------------------------------------------------------------
-- Zones are readable so the storefront can show a coverage map and fee table.

create policy "anyone reads active zones" on delivery_zones
  for select using (is_active or is_staff());
create policy "managers write zones" on delivery_zones
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

create policy "anyone reads active rules" on delivery_rules
  for select using (is_active or is_staff());
create policy "managers write rules" on delivery_rules
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

-- --- Orders ------------------------------------------------------------------
-- No anon policy at all. Customers reach their own order through lookup_order(),
-- which requires the order number and the matching email.

create policy "staff read orders" on orders for select using (is_staff());
create policy "employees update orders" on orders
  for update using (has_min_role('employee')) with check (has_min_role('employee'));
create policy "managers delete orders" on orders
  for delete using (has_min_role('manager'));

create policy "staff read order items" on order_items for select using (is_staff());
create policy "managers write order items" on order_items
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

create policy "staff read status history" on order_status_history
  for select using (is_staff());

create policy "staff read payments" on payments for select using (is_staff());
create policy "employees record payments" on payments
  for insert with check (has_min_role('employee'));

-- --- Inventory ---------------------------------------------------------------

create policy "staff read movements" on inventory_movements
  for select using (is_staff());
create policy "employees record movements" on inventory_movements
  for insert with check (has_min_role('employee'));

create policy "staff read alerts" on inventory_alerts for select using (is_staff());
create policy "employees resolve alerts" on inventory_alerts
  for update using (has_min_role('employee')) with check (has_min_role('employee'));

-- --- Audit -------------------------------------------------------------------

create policy "admins read activity log" on activity_log
  for select using (has_min_role('administrator'));

-- order_counters intentionally has no policy: only next_order_number() touches
-- it, and that function is security definer.

-- --- Realtime ----------------------------------------------------------------
-- Dashboard tiles and the order board subscribe to these.

alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table inventory_alerts;
alter publication supabase_realtime add table products;
