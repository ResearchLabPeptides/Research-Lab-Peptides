import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { UserRole } from '@/lib/types';
import { hasMinRole } from '@/lib/auth-shared';

export { hasMinRole };

export interface StaffProfile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
}

/**
 * The signed-in staff member, or null. Mirrors has_min_role() in the database
 * so the UI can hide controls the policies would reject anyway — the check here
 * is for clarity, the one in Postgres is for safety.
 */
export async function getStaffProfile(): Promise<StaffProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, is_active')
    .eq('id', user.id)
    .single();

  if (!data || !data.is_active) return null;
  return data as StaffProfile;
}

export async function requireStaff(minimum: UserRole = 'read_only'): Promise<StaffProfile> {
  const profile = await getStaffProfile();
  if (!profile) redirect('/admin/login');
  if (!hasMinRole(profile.role, minimum)) redirect('/admin?denied=1');
  return profile;
}
