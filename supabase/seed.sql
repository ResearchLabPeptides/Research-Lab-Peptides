-- =============================================================================
-- Seed data — a realistic delivery-only grocer in Surrey, BC
-- =============================================================================
-- Safe to re-run. Replace with your own catalog before going live.

update settings set
  company_name  = 'Fernwood Provisions',
  currency      = 'CAD',
  tax_rate_bps  = 500,                     -- 5% GST
  payment_email = 'payments@fernwoodprovisions.ca',
  delivery_email = 'delivery@fernwoodprovisions.ca',
  support_phone = '(604) 555-0142',
  order_prefix  = 'ORD',
  low_stock_threshold_default = 12,
  expiry_warning_days = 21
where id;

-- --- Categories --------------------------------------------------------------

insert into categories (name, slug, description, sort_order) values
  ('Produce',        'produce',        'Picked this week from Fraser Valley growers.', 1),
  ('Bakery',         'bakery',         'Baked each morning, delivered the same day.',  2),
  ('Dairy & Eggs',   'dairy-eggs',     'Cold-chain from the farm to your door.',       3),
  ('Pantry',         'pantry',         'Oils, grains, tins, and everything shelf-stable.', 4),
  ('Coffee & Tea',   'coffee-tea',     'Roasted locally in small batches.',            5),
  ('Household',      'household',      'Refills and cleaning, low waste.',             6)
on conflict (slug) do nothing;

-- --- Suppliers ---------------------------------------------------------------

insert into suppliers (name, contact_name, email, phone, address) values
  ('Fraser Valley Growers Co-op', 'Amrit Dhillon', 'orders@fvgrowers.ca',   '(604) 555-0110', '18220 Colebrook Rd, Surrey, BC'),
  ('Boundary Bay Bakehouse',      'Marta Silva',   'wholesale@bbbake.ca',   '(604) 555-0121', '1140 56 St, Delta, BC'),
  ('Kootenay Creamery',           'Owen Beck',     'sales@kootcream.ca',    '(250) 555-0133', '4 Baker St, Nelson, BC'),
  ('Pacific Dry Goods',           'Lena Osei',     'ap@pacificdry.ca',      '(604) 555-0144', '8899 Grace Rd, Burnaby, BC'),
  ('Ironwood Coffee Roasters',    'Sam Tran',      'hello@ironwoodroast.ca','(604) 555-0155', '2100 Scott Rd, Surrey, BC')
on conflict do nothing;

-- --- Delivery zones ----------------------------------------------------------

insert into delivery_zones
  (name, code, description, fee_cents, free_delivery_threshold_cents, minimum_order_cents,
   max_distance_km, estimated_minutes_min, estimated_minutes_max, priority)
values
  ('Surrey Core',      'A', 'Same-day within Surrey city limits.',        500,  7500, 2500, 15, 60,  120, 10),
  ('Delta & Langley',  'B', 'Next available window.',                    1000, 12500, 3000, 35, 120, 240, 20),
  ('Metro Vancouver',  'C', 'Scheduled evening runs.',                   1500, 20000, 4000, 60, 180, 360, 30)
on conflict do nothing;

-- Postal prefixes are the first three characters (the Forward Sortation Area).

insert into delivery_rules (zone_id, match_type, match_value)
select id, 'postal_prefix', v
from delivery_zones, unnest(array['V3R','V3S','V3T','V3V','V3W','V3X','V3Z','V4N','V4P']) v
where code = 'A'
on conflict do nothing;

insert into delivery_rules (zone_id, match_type, match_value)
select id, 'postal_prefix', v
from delivery_zones, unnest(array['V4A','V4C','V4E','V4K','V4L','V4M','V1M','V2Y','V2Z','V3A','V4W']) v
where code = 'B'
on conflict do nothing;

insert into delivery_rules (zone_id, match_type, match_value)
select id, 'postal_prefix', v
from delivery_zones, unnest(array['V5A','V5B','V5C','V5E','V5G','V5H','V5J','V5K','V5L','V5M','V5N','V5P','V5R','V5S','V5T','V5V','V5W','V5X','V5Y','V5Z','V6A','V6B','V6E','V6G','V6H','V6J','V6K','V6L','V6M','V6N','V6P','V6R','V6S','V6T','V6Z','V7A','V7C','V7E']) v
where code = 'C'
on conflict do nothing;

-- --- Products ----------------------------------------------------------------

with s as (
  select
    (select id from categories where slug = 'produce')    as c_produce,
    (select id from categories where slug = 'bakery')     as c_bakery,
    (select id from categories where slug = 'dairy-eggs') as c_dairy,
    (select id from categories where slug = 'pantry')     as c_pantry,
    (select id from categories where slug = 'coffee-tea') as c_coffee,
    (select id from categories where slug = 'household')  as c_house,
    (select id from suppliers where name = 'Fraser Valley Growers Co-op') as s_fv,
    (select id from suppliers where name = 'Boundary Bay Bakehouse')      as s_bb,
    (select id from suppliers where name = 'Kootenay Creamery')           as s_kc,
    (select id from suppliers where name = 'Pacific Dry Goods')           as s_pd,
    (select id from suppliers where name = 'Ironwood Coffee Roasters')    as s_ic
)
insert into products (
  sku, barcode, name, slug, description, category_id, supplier_id, manufacturer,
  cost_cents, price_cents, compare_at_cents, quantity, min_quantity, max_quantity, unit,
  storage_location, shelf, bin, batch_number, expiry_date,
  status, is_featured, is_new, tags
)
select * from (
  select
    v.sku, v.barcode, v.name, v.slug, v.description,
    case v.cat when 'produce' then s.c_produce when 'bakery' then s.c_bakery
               when 'dairy' then s.c_dairy when 'pantry' then s.c_pantry
               when 'coffee' then s.c_coffee else s.c_house end,
    case v.sup when 'fv' then s.s_fv when 'bb' then s.s_bb when 'kc' then s.s_kc
               when 'ic' then s.s_ic else s.s_pd end,
    v.manufacturer, v.cost, v.price, v.compare_at, v.qty, v.minq, v.maxq, v.unit,
    v.loc, v.shelf, v.bin, v.batch,
    case when v.expiry_days is null then null else current_date + v.expiry_days end,
    'active'::product_status, v.featured, v.is_new, v.tags
  from s, (values
    ('PRD-1001','0627843001001','Ambrosia Apples, 2 lb','ambrosia-apples-2lb','Crisp, low-acid, and grown in Cawston. Good keepers.','produce','fv','Fraser Valley Growers',280,549,null,140,20,400,'bag','Cooler 1','C1','A3','FV-2609',14,true,false,array['fresh','local','bc-grown']),
    ('PRD-1002','0627843001018','Rainbow Carrots, bunch','rainbow-carrots','Purple, yellow, and orange. Tops still on.','produce','fv','Fraser Valley Growers',190,399,null,86,15,300,'bunch','Cooler 1','C1','A4','FV-2609',10,false,true,array['fresh','local']),
    ('PRD-1003','0627843001025','Avocados, 4 pack','avocados-4pk','Ripened to eat within two days.','produce','fv','Fraser Valley Growers',420,799,899,64,15,250,'pack','Cooler 1','C1','A5','IMP-1188',5,true,false,array['fresh','sale']),
    ('PRD-1004','0627843001032','Baby Spinach, 312 g','baby-spinach','Triple-washed and ready to use.','produce','fv','Fraser Valley Growers',330,599,null,9,12,200,'clamshell','Cooler 1','C2','B1','FV-2610',6,false,false,array['fresh','salad']),
    ('PRD-1005','0627843001049','Roma Tomatoes, 1 lb','roma-tomatoes','Greenhouse grown in Delta year-round.','produce','fv','Fraser Valley Growers',210,429,null,120,18,300,'lb','Cooler 1','C2','B2','FV-2610',9,false,false,array['fresh','local']),
    ('PRD-1006','0627843001056','Yellow Onions, 3 lb','yellow-onions-3lb','The workhorse. Stores for weeks.','produce','fv','Fraser Valley Growers',240,449,null,175,20,400,'bag','Dry Store','D1','A1','FV-2601',60,false,false,array['staple']),
    ('PRD-2001','0627843002015','Sourdough Loaf','sourdough-loaf','48-hour ferment, baked at 5am.','bakery','bb','Boundary Bay Bakehouse',290,699,null,42,10,120,'loaf','Bread Rack','B1','A1','BB-0812',3,true,false,array['bakery','fresh']),
    ('PRD-2002','0627843002022','Butter Croissants, 4 pack','butter-croissants-4pk','Laminated with Kootenay butter.','bakery','bb','Boundary Bay Bakehouse',380,899,null,28,10,100,'pack','Bread Rack','B1','A2','BB-0812',3,true,true,array['bakery','fresh']),
    ('PRD-2003','0627843002039','Seeded Rye Loaf','seeded-rye-loaf','Caraway, flax, and sunflower.','bakery','bb','Boundary Bay Bakehouse',310,749,null,0,10,100,'loaf','Bread Rack','B2','A1','BB-0811',3,false,false,array['bakery']),
    ('PRD-2004','0627843002046','Cinnamon Morning Buns, 6 pack','cinnamon-morning-buns','Best warmed for four minutes.','bakery','bb','Boundary Bay Bakehouse',520,1149,1299,19,8,80,'pack','Bread Rack','B2','A2','BB-0812',3,false,false,array['bakery','sale']),
    ('PRD-3001','0627843003012','Whole Milk, 2 L','whole-milk-2l','Non-homogenized, glass returnable.','dairy','kc','Kootenay Creamery',310,649,null,88,15,240,'bottle','Cooler 2','C3','A1','KC-4401',12,false,false,array['dairy','staple']),
    ('PRD-3002','0627843003029','Salted Butter, 454 g','salted-butter','Churned in small batches.','dairy','kc','Kootenay Creamery',480,899,null,64,12,200,'block','Cooler 2','C3','A2','KC-4401',45,true,false,array['dairy','staple']),
    ('PRD-3003','0627843003036','Free Run Eggs, dozen','free-run-eggs','Large, from Abbotsford flocks.','dairy','fv','Fraser Valley Growers',420,749,null,110,20,300,'dozen','Cooler 2','C4','A1','FV-2611',21,true,false,array['dairy','staple','local']),
    ('PRD-3004','0627843003043','Aged White Cheddar, 250 g','aged-white-cheddar','Two years. Sharp and crumbly.','dairy','kc','Kootenay Creamery',690,1349,null,7,10,120,'wedge','Cooler 2','C4','A2','KC-4390',90,false,true,array['dairy','cheese']),
    ('PRD-3005','0627843003050','Plain Whole Yogurt, 750 g','plain-whole-yogurt','No thickeners, no sugar.','dairy','kc','Kootenay Creamery',390,749,null,52,12,180,'tub','Cooler 2','C5','A1','KC-4402',18,false,false,array['dairy']),
    ('PRD-4001','0627843004019','Cold Pressed Olive Oil, 750 ml','olive-oil-750ml','Single estate, harvested last November.','pantry','pd','Pacific Dry Goods',1180,2299,2599,74,10,200,'bottle','Dry Store','D2','A1','PD-7712',540,true,false,array['pantry','sale']),
    ('PRD-4002','0627843004026','Sea Salt Flakes, 250 g','sea-salt-flakes','Harvested off Vancouver Island.','pantry','pd','Pacific Dry Goods',430,899,null,96,12,240,'tin','Dry Store','D2','A2','PD-7712',1080,false,false,array['pantry','staple']),
    ('PRD-4003','0627843004033','Bronze Cut Spaghetti, 500 g','bronze-cut-spaghetti','Rough surface, holds sauce.','pantry','pd','Pacific Dry Goods',260,499,null,210,25,500,'box','Dry Store','D3','A1','PD-7705',720,false,false,array['pantry','staple']),
    ('PRD-4004','0627843004040','San Marzano Tomatoes, 796 ml','san-marzano-tomatoes','DOP certified, whole peeled.','pantry','pd','Pacific Dry Goods',340,679,null,168,20,400,'tin','Dry Store','D3','A2','PD-7705',900,false,false,array['pantry','staple']),
    ('PRD-4005','0627843004057','Wildflower Honey, 500 g','wildflower-honey','Unpasteurized, from Chilliwack hives.','pantry','fv','Fraser Valley Growers',720,1399,null,44,10,150,'jar','Dry Store','D4','A1','FV-2588',720,true,true,array['pantry','local']),
    ('PRD-4006','0627843004064','Basmati Rice, 4 kg','basmati-rice-4kg','Aged twelve months before milling.','pantry','pd','Pacific Dry Goods',1490,2699,null,58,10,180,'bag','Dry Store','D4','A2','PD-7699',540,false,false,array['pantry','staple']),
    ('PRD-4007','0627843004071','Chickpeas, 540 ml','chickpeas-540','No salt added.','pantry','pd','Pacific Dry Goods',130,249,null,240,30,600,'tin','Dry Store','D5','A1','PD-7699',900,false,false,array['pantry','staple']),
    ('PRD-4008','0627843004088','Dark Maple Syrup, 500 ml','dark-maple-syrup','Grade A, very dark, strong taste.','pantry','pd','Pacific Dry Goods',940,1799,null,3,8,120,'bottle','Dry Store','D5','A2','PD-7690',720,false,false,array['pantry']),
    ('PRD-5001','0627843005016','Ironwood Espresso, 340 g','ironwood-espresso','Chocolate and stone fruit. Roasted Tuesdays.','coffee','ic','Ironwood Coffee Roasters',920,1899,null,66,12,200,'bag','Dry Store','D6','A1','IC-3301',35,true,false,array['coffee','local']),
    ('PRD-5002','0627843005023','Filter Roast, 340 g','filter-roast','Bright, washed Ethiopian.','coffee','ic','Ironwood Coffee Roasters',980,1999,null,41,12,200,'bag','Dry Store','D6','A2','IC-3301',35,false,true,array['coffee','local']),
    ('PRD-5003','0627843005030','Decaf Swiss Water, 340 g','decaf-swiss-water','Chemical free decaffeination.','coffee','ic','Ironwood Coffee Roasters',960,1949,null,22,10,150,'bag','Dry Store','D6','A3','IC-3299',30,false,false,array['coffee']),
    ('PRD-5004','0627843005047','Assam Breakfast Tea, 100 g','assam-breakfast-tea','Loose leaf, malty, takes milk well.','coffee','pd','Pacific Dry Goods',540,1099,null,78,12,200,'tin','Dry Store','D7','A1','PD-7688',540,false,false,array['tea']),
    ('PRD-6001','0627843006013','Dish Soap Refill, 1 L','dish-soap-refill','Bring back the jug for a credit.','house','pd','Pacific Dry Goods',420,849,null,92,12,240,'bottle','Dry Store','D8','A1','PD-7680',900,false,false,array['household','refill']),
    ('PRD-6002','0627843006020','Compostable Bin Liners, 30 pack','compostable-bin-liners','Certified BPI, fits 13 gallon bins.','house','pd','Pacific Dry Goods',380,749,null,134,15,300,'pack','Dry Store','D8','A2','PD-7680',null,false,false,array['household']),
    ('PRD-6003','0627843006037','Cotton Dish Cloths, 3 pack','cotton-dish-cloths','Unbleached, machine washable.','house','pd','Pacific Dry Goods',450,899,null,61,10,200,'pack','Dry Store','D9','A1','PD-7675',null,false,false,array['household'])
  ) as v(sku, barcode, name, slug, description, cat, sup, manufacturer, cost, price, compare_at,
         qty, minq, maxq, unit, loc, shelf, bin, batch, expiry_days, featured, is_new, tags)
) as rows
on conflict (slug) do nothing;

-- Opening stock counts, so the ledger is not empty on day one.
insert into inventory_movements (product_id, type, quantity_before, quantity_change, quantity_after, reason, performed_label)
select id, 'receiving', 0, quantity, quantity, 'Opening inventory', 'seed'
from products
where not exists (select 1 from inventory_movements m where m.product_id = products.id);

select refresh_product_alerts(id) from products;
