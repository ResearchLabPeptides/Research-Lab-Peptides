import { Storefront } from '@/components/storefront/storefront';
import {
  getCategories,
  getContent,
  getPublicSettings,
  getStorefrontProducts,
  text,
} from '@/lib/queries/storefront';

export default async function HomePage() {
  const [products, categories, settings, content] = await Promise.all([
    getStorefrontProducts(),
    getCategories(),
    getPublicSettings(),
    getContent(),
  ]);

  // Every string here is editable in Content → Wording. The literals are the
  // fallback for a field that has been blanked out, so a cleared heading never
  // renders as an empty <h1>.
  return (
    <main id="main">
      <section className="border-b border-border bg-card">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:py-14">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
            {text(content, 'home.eyebrow', 'Delivering across your area')}
          </p>
          <h1 className="mt-3 max-w-2xl font-display text-3xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
            {text(content, 'home.heading', 'Order in two minutes. No account, no app.')}
          </h1>
          <p className="mt-4 max-w-xl text-base text-muted-foreground">
            {text(
              content,
              'home.subheading',
              'Add what you need, tell us where to bring it, and send an Interac e-Transfer when you are ready.',
            )}
          </p>
        </div>
      </section>

      <Storefront
        products={products}
        categories={categories}
        settings={settings}
        content={content}
      />
    </main>
  );
}
