import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { AdminNav } from '@/components/admin/admin-nav';
import { getStaffProfile } from '@/lib/auth';
import { signOut } from '@/lib/actions/auth';
import { ROLE_LABELS } from '@/lib/constants';

export const metadata = { title: { default: 'Admin', template: '%s · Admin' } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await getStaffProfile();

  // The login page renders inside this layout too, so a missing profile is a
  // normal state here rather than an error.
  if (!profile) return <>{children}</>;

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/admin" className="font-display text-base font-bold tracking-tight">
            Back office
          </Link>
          <div className="flex items-center gap-2">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">
                {profile.full_name || profile.email}
              </p>
              <p className="text-xs text-muted-foreground">{ROLE_LABELS[profile.role]}</p>
            </div>
            <ThemeToggle />
            <form action={signOut}>
              <Button variant="ghost" size="icon" type="submit" aria-label="Sign out">
                <LogOut className="size-4" />
              </Button>
            </form>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 pb-2">
          <AdminNav role={profile.role} />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-6">
        {children}
      </main>
    </div>
  );
}
