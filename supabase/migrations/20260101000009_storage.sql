-- =============================================================================
-- 0009  Storage buckets
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-images', 'product-images', true,  5 * 1024 * 1024,
    array['image/jpeg','image/png','image/webp','image/avif']),
  ('product-documents', 'product-documents', false, 25 * 1024 * 1024, null),
  ('supplier-documents', 'supplier-documents', false, 25 * 1024 * 1024, null),
  ('branding', 'branding', true, 2 * 1024 * 1024,
    array['image/jpeg','image/png','image/webp','image/svg+xml'])
on conflict (id) do nothing;

-- Product images and branding are world-readable; everything else is staff-only.

create policy "public read product images" on storage.objects
  for select using (bucket_id in ('product-images', 'branding'));

create policy "managers write product images" on storage.objects
  for all to authenticated
  using (bucket_id in ('product-images', 'branding') and has_min_role('manager'))
  with check (bucket_id in ('product-images', 'branding') and has_min_role('manager'));

create policy "staff read private documents" on storage.objects
  for select to authenticated
  using (bucket_id in ('product-documents', 'supplier-documents') and is_staff());

create policy "managers write private documents" on storage.objects
  for all to authenticated
  using (bucket_id in ('product-documents', 'supplier-documents') and has_min_role('manager'))
  with check (bucket_id in ('product-documents', 'supplier-documents') and has_min_role('manager'));
