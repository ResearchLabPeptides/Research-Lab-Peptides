/**
 * Editable copy, shared between server and client components.
 *
 * `queries/storefront.ts` is server-only because it touches cookies, so the map
 * type and the lookup helper live here where a Client Component can import them.
 */
export type ContentMap = Record<string, string>;

/**
 * Reads one key.
 *
 * A field that has been deliberately cleared stays cleared. Emptying a line is
 * a real editorial choice — plenty of shops want no tagline, or no footer note
 * — and silently refilling it with the shipped wording made that impossible to
 * express: the field would look saved and the old text would still be on the
 * site.
 *
 * The fallback still applies to a key that has never been set, which is what it
 * is actually for: a fresh install, or a key added by an upgrade before anyone
 * has written copy for it. The distinction is between "blank on purpose" and
 * "no value yet", and only the second one wants a default.
 */
export function text(map: ContentMap, key: string, fallback: string): string {
  const value = map[key];
  return value === undefined || value === null ? fallback : value;
}
