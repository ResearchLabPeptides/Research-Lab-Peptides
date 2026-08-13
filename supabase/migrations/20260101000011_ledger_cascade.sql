-- =============================================================================
-- 0011  Let referential cascades through the inventory ledger
-- =============================================================================
-- The immutability trigger on `inventory_movements` was doing its job too well.
-- It blocked two writes that the database itself issues on our behalf:
--
--   1. `products.id` cascades a DELETE into the ledger. Deleting a product that
--      had ever moved stock therefore failed outright.
--   2. `orders.id` is ON DELETE SET NULL, so removing an order UPDATEs the
--      ledger's `order_id`. That failed too.
--
-- Both are the database enforcing referential integrity, not a person editing
-- history, so both are allowed now. Everything else still raises.
--
-- The tell is that a cascade runs *after* the parent row is gone: inside this
-- trigger the parent no longer exists. A hand-written DELETE or UPDATE against
-- a live product or order still finds its parent, and is still refused.

create or replace function forbid_ledger_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    -- Cascade from a deleted product: the product row is already gone.
    if not exists (select 1 from products where id = old.product_id) then
      return old;
    end if;

    raise exception
      'Inventory history cannot be deleted. Record a correcting adjustment instead.'
      using errcode = 'check_violation';
  end if;

  -- ON DELETE SET NULL from a removed order: the only permitted update, and
  -- only the order_id column may differ.
  if new.order_id is null
     and old.order_id is not null
     and not exists (select 1 from orders where id = old.order_id)
     and new.product_id      is not distinct from old.product_id
     and new.type            is not distinct from old.type
     and new.quantity_before is not distinct from old.quantity_before
     and new.quantity_change is not distinct from old.quantity_change
     and new.quantity_after  is not distinct from old.quantity_after
     and new.created_at      is not distinct from old.created_at
  then
    return new;
  end if;

  raise exception
    'Inventory history cannot be changed. Record a correcting adjustment instead.'
    using errcode = 'check_violation';
end;
$$;

-- The old trigger fired per row for both operations; keep that, but the
-- function now distinguishes between them.
drop trigger if exists inventory_movements_immutable on inventory_movements;

create trigger inventory_movements_immutable
  before update or delete on inventory_movements
  for each row execute function forbid_ledger_mutation();
