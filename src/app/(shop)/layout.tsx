import { cookies } from 'next/headers';
import { SiteHeader } from '@/components/storefront/site-header';
import { SiteGate } from '@/components/storefront/site-gate';
import {
  getContent,
  getGateConfig,
  getNavPages,
  getPublicSettings,
  text,
} from '@/lib/queries/storefront';
import { GATE_COOKIE, gateSatisfied, verifyGate } from '@/lib/gate';

/**
 * Everything a customer sees lives inside this group, so the entry gate is
 * declared once here rather than remembered on each page.
 *
 * Reading the cookie makes these routes dynamic — a gated shop cannot be served
 * from the CDN as one shared document, because whether the gate shows differs
 * per visitor. Turning the gate off in Settings returns them to cacheable.
 */
export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const [settings, gate, content, pages, cookieStore] = await Promise.all([
    getPublicSettings(),
    getGateConfig(),
    getContent(),
    getNavPages(),
    cookies(),
  ]);

  const satisfied =
    !gate.enabled || gateSatisfied(verifyGate(cookieStore.get(GATE_COOKIE)?.value), gate.items);

  return (
    <>
      {/* Marked inert by <SiteGate> while the gate is up. */}
      <div id="shop-content">
        <SiteHeader
          companyName={settings.company_name}
          tagline={text(content, 'header.tagline', 'Delivery only')}
          pages={pages}
        />
        {children}
      </div>

      {satisfied ? null : <SiteGate config={gate} />}
    </>
  );
}
