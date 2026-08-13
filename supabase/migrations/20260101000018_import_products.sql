-- =============================================================================
-- 0018  Import products from a spreadsheet
-- =============================================================================
-- Typing a few hundred products by hand is the single biggest barrier to
-- getting a shop live, so this takes a spreadsheet and does it in one go.
--
-- Only a name is required. Everything else can be blank and filled in later
-- through the normal product editor — the point is to get the catalog listed,
-- not to demand a perfect file on the first attempt.
--
-- Three things this deliberately does NOT do:
--
--   * It never writes `products.quantity` directly. An opening count arrives as
--     a `receiving` movement, exactly as it would through the Adjust button, so
--     imported stock has the same ledger trail as stock counted by hand.
--   * It never deletes. A row missing from the file is left alone, because a
--     truncated export should not wipe a catalog.
--   * It is one transaction. A bad row on line 400 rolls the whole thing back
--     rather than leaving half a catalog behind.

-- Turns a name into a URL segment. Mirrors slugify() in the application.
create or replace function slugify_text(p_value text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]+', '-', 'g'));
$$;

/**
 * p_rows is an array of objects. Every key is optional except `name`:
 *
 *   { "name", "sku", "barcode", "description", "category", "supplier",
 *     "unit", "price", "cost", "compare_at", "quantity", "min_quantity",
 *     "manufacturer", "tags", "status" }
 *
 * Money arrives already converted to integer cents — the browser does that
 * because it can show the person what it parsed before they commit.
 *
 * p_mode:
 *   'update' — a row whose SKU already exists updates that product
 *   'skip'   — existing SKUs are left untouched and counted as skipped
 */
create or replace function import_products(p_rows jsonb, p_mode text default 'update')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row        jsonb;
  v_index      int := 0;
  v_created    int := 0;
  v_updated    int := 0;
  v_skipped    int := 0;
  v_name       text;
  v_sku        text;
  v_slug       text;
  v_base_slug  text;
  v_suffix     int;
  v_existing   products;
  -- FOUND reflects the last statement executed, and the category/supplier
  -- lookups below run between the existence check and the branch on it. Keep
  -- the answer in a variable rather than trusting FOUND to survive.
  v_exists     boolean;
  v_category   uuid;
  v_supplier   uuid;
  v_quantity   int;
  v_product_id uuid;
  v_text       text;
  v_errors     jsonb := '[]'::jsonb;
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

    -- A blank SKU gets a generated one. Staff can rewrite it in the editor; the
    -- alternative is refusing a file whose only flaw is not having invented
    -- codes yet.
    v_sku := upper(nullif(regexp_replace(coalesce(v_row ->> 'sku', ''), '\s+', '', 'g'), ''));
    if v_sku is null then
      -- Derived from the name alone, so re-running the same file updates the
      -- catalog instead of duplicating it. Accidentally importing twice is a
      -- far more likely mistake than two different products sharing a name.
      v_sku := 'IMP-' || upper(substr(md5(lower(v_name)), 1, 8));
    end if;

    v_existing := null;
    select * into v_existing from products where upper(sku) = v_sku;
    v_exists := v_existing.id is not null;

    if v_exists and p_mode = 'skip' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Categories and suppliers are matched by name and created when new, so a
    -- spreadsheet can introduce both without a separate setup pass.
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
      -- Update. Only columns present in the file are touched, so a partial
      -- spreadsheet cannot blank out details entered by hand.
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
      -- Slugs are unique. Two products legitimately sharing a name get a
      -- numbered suffix rather than failing the whole import.
      v_base_slug := nullif(slugify_text(v_name), '');
      if v_base_slug is null then v_base_slug := 'product'; end if;
      v_slug := v_base_slug;
      v_suffix := 1;
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
        v_name,
        v_slug,
        coalesce(v_row ->> 'description', ''),
        v_category,
        v_supplier,
        coalesce(v_row ->> 'manufacturer', ''),
        coalesce(nullif(trim(coalesce(v_row ->> 'unit', '')), ''), 'each'),
        coalesce((v_row ->> 'price')::int, 0),
        coalesce((v_row ->> 'cost')::int, 0),
        (v_row ->> 'compare_at')::int,
        0,                                    -- opening count is posted below
        coalesce((v_row ->> 'min_quantity')::int, 0),
        coalesce(nullif(v_row ->> 'status', ''), 'active')::product_status,
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
          v_product_id, 'receiving', v_quantity,
          'Imported from spreadsheet', '', 'import');
      end if;

      v_created := v_created + 1;
    end if;
  end loop;

  perform log_activity('products.imported', 'import', null,
    jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped));

  return jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'skipped', v_skipped,
    'errors', v_errors
  );
end;
$$;
