import type { UserRole } from './types';

/**
 * Role comparison that is safe to import into a Client Component. `lib/auth.ts`
 * is server-only because it touches cookies; this is the pure part of it.
 */
const RANK: Record<UserRole, number> = {
  read_only: 1,
  employee: 2,
  manager: 3,
  administrator: 4,
};

export function hasMinRole(role: UserRole, required: UserRole): boolean {
  return RANK[role] >= RANK[required];
}
