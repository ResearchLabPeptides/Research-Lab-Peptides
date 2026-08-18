'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  FileText,
  Mail,
  LayoutDashboard,
  Package,
  Palette,
  FileSpreadsheet,
  Receipt,
  Settings,
  Wallet,
  Tag,
  Users,
  Truck,
  BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/lib/types';
import { hasMinRole } from '@/lib/auth-shared';

const LINKS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, minRole: 'read_only' },
  { href: '/admin/orders', label: 'Orders', icon: Receipt, minRole: 'read_only' },
  { href: '/admin/products', label: 'Inventory', icon: Package, minRole: 'read_only' },
  { href: '/admin/delivery', label: 'Shipping', icon: Truck, minRole: 'manager' },
  { href: '/admin/customers', label: 'Customers', icon: Users, minRole: 'read_only' },
  { href: '/admin/reports', label: 'Reports', icon: FileSpreadsheet, minRole: 'read_only' },
  { href: '/admin/coupons', label: 'Coupons', icon: Tag, minRole: 'manager' },
  { href: '/admin/payments', label: 'Payments', icon: Wallet, minRole: 'manager' },
  { href: '/admin/content', label: 'Content', icon: FileText, minRole: 'administrator' },
  { href: '/admin/emails', label: 'Emails', icon: Mail, minRole: 'administrator' },
  { href: '/admin/branding', label: 'Branding', icon: Palette, minRole: 'administrator' },
  { href: '/admin/activity', label: 'Activity', icon: Activity, minRole: 'administrator' },
  { href: '/admin/settings', label: 'Settings', icon: Settings, minRole: 'administrator' },
] as const;

export function AdminNav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const visible = LINKS.filter((l) => hasMinRole(role, l.minRole));

  return (
    <nav aria-label="Admin sections" className="flex gap-1 overflow-x-auto">
      {visible.map((link) => {
        const active =
          link.href === '/admin' ? pathname === '/admin' : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <link.icon className="size-4" aria-hidden />
            {link.label}
          </Link>
        );
      })}

      {/* The staff manual. Outside the LINKS list because it is a file rather
          than a section, and served through /admin/manual rather than from
          public/ so it is only readable by someone signed in. Opens in a new
          tab so nobody loses the page they were working on, and is available to
          every role — the people most likely to need it are the ones with the
          least access. */}
      <a
        href="/admin/manual"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <BookOpen className="size-4" aria-hidden />
        Manual
      </a>
    </nav>
  );
}
