/**
 * Product image URLs.
 *
 * `storage_path` is normally a path inside the public `product-images` bucket.
 * Absolute URLs are passed through untouched so you can point at an existing
 * CDN during a migration without touching the database.
 */
export function productImageUrl(storagePath: string | null | undefined): string | null {
  if (!storagePath) return null;
  if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) return storagePath;

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/product-images/${storagePath.replace(/^\/+/, '')}`;
}

/**
 * Deterministic placeholder for products with no photo yet. Picks one of six
 * hues from the product name so the grid stays calm instead of turning into a
 * wall of identical grey boxes.
 */
export function placeholderHue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return [158, 200, 42, 262, 12, 186][Math.abs(hash) % 6]!;
}
