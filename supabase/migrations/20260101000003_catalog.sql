-- =============================================================================
-- 0003  Catalog: categories, suppliers, products, media
-- =============================================================================

create table categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  description text not null default '',
  image_url   text,
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index categories_active_idx on categories (sort_order, name) where is_active;

create trigger categories_updated_at
  before update on categories
  for each row execute function set_updated_at();

create table suppliers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  contact_name text not null default '',
  email        citext,
  phone        text not null default '',
  address      text not null default '',
  website      text,
  notes        text not null default '',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index suppliers_name_key on suppliers (lower(name));

create trigger suppliers_updated_at
  before update on suppliers
  for each row execute function set_updated_at();

-- --- Products ----------------------------------------------------------------
-- All money is stored as integer cents. Never floats.
--
-- `quantity`          physical stock on the shelf
-- `quantity_reserved` held for orders awaiting payment
-- available to sell = quantity - quantity_reserved

create table products (
  id                uuid primary key default gen_random_uuid(),
  sku               text not null,
  barcode           text,
  name              text not null,
  slug              text not null unique,
  description       text not null default '',
  category_id       uuid references categories(id) on delete set null,
  supplier_id       uuid references suppliers(id) on delete set null,
  manufacturer      text not null default '',

  cost_cents        int not null default 0 check (cost_cents >= 0),
  price_cents       int not null check (price_cents >= 0),
  compare_at_cents  int check (compare_at_cents is null or compare_at_cents >= 0),

  quantity          int not null default 0 check (quantity >= 0),
  quantity_reserved int not null default 0 check (quantity_reserved >= 0),
  min_quantity      int not null default 0 check (min_quantity >= 0),
  max_quantity      int check (max_quantity is null or max_quantity >= 0),
  unit              text not null default 'each',

  storage_location  text not null default '',
  shelf             text not null default '',
  bin               text not null default '',
  batch_number      text not null default '',
  lot_number        text not null default '',
  expiry_date       date,

  status            product_status not null default 'active',
  is_featured       boolean not null default false,
  is_new            boolean not null default false,
  tags              text[] not null default '{}',
  notes             text not null default '',

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint products_reserved_within_stock check (quantity_reserved <= quantity),
  constraint products_max_gte_min check (max_quantity is null or max_quantity >= min_quantity)
);

create unique index products_sku_key     on products (upper(sku));
create unique index products_barcode_key on products (barcode) where barcode is not null;

-- Storefront listing: the common "active products in a category, newest first"
-- and "featured" paths.
create index products_storefront_idx on products (category_id, created_at desc) where status = 'active';
create index products_featured_idx   on products (created_at desc) where status = 'active' and is_featured;
create index products_price_idx      on products (price_cents) where status = 'active';
create index products_tags_idx       on products using gin (tags);

-- Live search across name + SKU + description.
create index products_search_idx on products using gin (
  (name || ' ' || sku || ' ' || description) gin_trgm_ops
);

-- Admin alert queries.
create index products_expiry_idx on products (expiry_date) where expiry_date is not null;
create index products_low_stock_idx on products (quantity) where status = 'active';

create trigger products_updated_at
  before update on products
  for each row execute function set_updated_at();

-- --- Media -------------------------------------------------------------------

create table product_images (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id) on delete cascade,
  storage_path text not null,          -- path inside the `product-images` bucket
  alt_text     text not null default '',
  sort_order   int  not null default 0,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now()
);

create index product_images_product_idx on product_images (product_id, sort_order);
create unique index product_images_one_primary on product_images (product_id) where is_primary;

create table product_documents (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id) on delete cascade,
  storage_path text not null,
  file_name    text not null,
  mime_type    text not null default 'application/octet-stream',
  size_bytes   bigint not null default 0,
  uploaded_by  uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index product_documents_product_idx on product_documents (product_id);

create table supplier_documents (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid not null references suppliers(id) on delete cascade,
  storage_path text not null,
  file_name    text not null,
  mime_type    text not null default 'application/octet-stream',
  size_bytes   bigint not null default 0,
  uploaded_by  uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index supplier_documents_supplier_idx on supplier_documents (supplier_id);
