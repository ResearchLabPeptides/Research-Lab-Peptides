-- =============================================================================
-- 0019  Canada-wide shipping, optional SKUs, new products start hidden
-- =============================================================================

-- --- 1. No region lock ------------------------------------------------------
-- The pricing model is unchanged — a base charge plus the free/discount rules.
-- The only thing going away is the postal-code gate that refused addresses
-- outside a listed area. Shops that want it back can switch it on in Settings.

alter table settings alter column delivery_restrict_area set default false;
update settings set delivery_restrict_area = false;

-- --- 2. A product no longer needs a SKU -------------------------------------
-- Requiring one blocks the common case: someone listing what they sell before
-- they have invented codes for any of it. A blank SKU now gets a generated one
-- derived from the name, so it is stable if the same product is added twice.

create or replace function fill_missing_sku()
returns trigger
language plpgsql
as $$
declare
  v_base text;
  v_try  text;
  v_n    int := 1;
begin
  if new.sku is not null and trim(new.sku) <> '' then
    return new;
  end if;

  -- Hash the whole name. Taking the first few letters would collide across
  -- products that merely start alike.
  v_base := 'SKU-' || upper(substr(md5(lower(coalesce(new.name, 'product'))), 1, 6));
  v_try  := v_base;

  while exists (select 1 from products where upper(sku) = v_try and id is distinct from new.id) loop
    v_n := v_n + 1;
    v_try := v_base || '-' || v_n;
  end loop;

  new.sku := v_try;
  return new;
end;
$$;

-- BEFORE INSERT, so the generated value satisfies the NOT NULL and the unique
-- index without either having to be relaxed.
create trigger products_fill_sku
  before insert on products
  for each row execute function fill_missing_sku();

-- --- 3. New products start hidden -------------------------------------------
-- A product created without a price would otherwise appear on the shop at
-- $0.00 the moment it is saved. Starting inactive makes listing something and
-- finishing it later the safe default rather than a race.

alter table products alter column status set default 'inactive';

-- Imports follow the same rule, unless the file says otherwise.
create or replace function import_products(p_rows jsonb, p_mode text default 'update')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb; v_index int := 0; v_created int := 0; v_updated int := 0; v_skipped int := 0;
  v_name text; v_sku text; v_slug text; v_base_slug text; v_suffix int;
  v_existing products; v_exists boolean; v_category uuid; v_supplier uuid;
  v_quantity int; v_product_id uuid; v_text text; v_errors jsonb := '[]'::jsonb;
begin
  if not has_min_role('manager') then
    raise exception 'Your role cannot import products.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'There is nothing to import.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Import up to 2000 products at a time. Split the file and run it twice.'
      using errcode = 'check_violation';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_index := v_index + 1;
    v_name := nullif(trim(coalesce(v_row ->> 'name', '')), '');

    if v_name is null then
      v_errors := v_errors || jsonb_build_object('row', v_index, 'message', 'No product name.');
      continue;
    end if;

    v_sku := upper(nullif(regexp_replace(coalesce(v_row ->> 'sku', ''), '\s+', '', 'g'), ''));
    if v_sku is null then
      v_sku := 'IMP-' || upper(substr(md5(lower(v_name)), 1, 8));
    end if;

    v_existing := null;
    select * into v_existing from products where upper(sku) = v_sku;
    v_exists := v_existing.id is not null;

    if v_exists and p_mode = 'skip' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_category := null;
    v_text := nullif(trim(coalesce(v_row ->> 'category', '')), '');
    if v_text is not null then
      select id into v_category from categories where lower(name) = lower(v_text) limit 1;
      if v_category is null then
        insert into categories (name, slug, sort_order)
        values (v_text, slugify_text(v_text), 99)
        on conflict (slug) do update set name = excluded.name
        returning id into v_category;
      end if;
    end if;

    v_supplier := null;
    v_text := nullif(trim(coalesce(v_row ->> 'supplier', '')), '');
    if v_text is not null then
      select id into v_supplier from suppliers where lower(name) = lower(v_text) limit 1;
      if v_supplier is null then
        insert into suppliers (name) values (v_text) returning id into v_supplier;
      end if;
    end if;

    if v_exists then
      update products set
        name             = v_name,
        barcode          = coalesce(nullif(trim(coalesce(v_row ->> 'barcode', '')), ''), barcode),
        description      = coalesce(nullif(v_row ->> 'description', ''), description),
        category_id      = coalesce(v_category, category_id),
        supplier_id      = coalesce(v_supplier, supplier_id),
        manufacturer     = coalesce(nullif(v_row ->> 'manufacturer', ''), manufacturer),
        unit             = coalesce(nullif(trim(coalesce(v_row ->> 'unit', '')), ''), unit),
        price_cents      = coalesce((v_row ->> 'price')::int, price_cents),
        cost_cents       = coalesce((v_row ->> 'cost')::int, cost_cents),
        compare_at_cents = coalesce((v_row ->> 'compare_at')::int, compare_at_cents),
        min_quantity     = coalesce((v_row ->> 'min_quantity')::int, min_quantity)
      where id = v_existing.id;
      v_updated := v_updated + 1;
    else
      v_base_slug := nullif(slugify_text(v_name), '');
      if v_base_slug is null then v_base_slug := 'product'; end if;
      v_slug := v_base_slug; v_suffix := 1;
      while exists (select 1 from products where slug = v_slug) loop
        v_suffix := v_suffix + 1;
        v_slug := v_base_slug || '-' || v_suffix;
      end loop;

      insert into products (
        sku, barcode, name, slug, description, category_id, supplier_id, manufacturer,
        unit, price_cents, cost_cents, compare_at_cents, quantity, min_quantity, status, tags
      )
      values (
        v_sku,
        nullif(trim(coalesce(v_row ->> 'barcode', '')), ''),
        v_name, v_slug,
        coalesce(v_row ->> 'description', ''),
        v_category, v_supplier,
        coalesce(v_row ->> 'manufacturer', ''),
        coalesce(nullif(trim(coalesce(v_row ->> 'unit', '')), ''), 'each'),
        coalesce((v_row ->> 'price')::int, 0),
        coalesce((v_row ->> 'cost')::int, 0),
        (v_row ->> 'compare_at')::int,
        0,
        coalesce((v_row ->> 'min_quantity')::int, 0),
        -- Imported products stay hidden until someone has checked the prices.
        coalesce(nullif(v_row ->> 'status', ''), 'inactive')::product_status,
        coalesce(
          (select array_agg(trim(t)) from jsonb_array_elements_text(
             case when jsonb_typeof(v_row -> 'tags') = 'array' then v_row -> 'tags' else '[]'::jsonb end
           ) t),
          '{}'::text[])
      )
      returning id into v_product_id;

      v_quantity := coalesce((v_row ->> 'quantity')::int, 0);
      if v_quantity > 0 then
        perform apply_inventory_movement(
          v_product_id, 'receiving', v_quantity, 'Imported from spreadsheet', '', 'import');
      end if;

      v_created := v_created + 1;
    end if;
  end loop;

  perform log_activity('products.imported', 'import', null,
    jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped));

  return jsonb_build_object('created', v_created, 'updated', v_updated,
                            'skipped', v_skipped, 'errors', v_errors);
end;
$$;
