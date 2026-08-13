import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DeliveryRuleForm } from '@/components/admin/delivery-rule-form';
import { DeliveryPricingForm } from '@/components/admin/delivery-pricing-form';
import { requireStaff } from '@/lib/auth';
import { getDeliveryConfig, getDeliveryPricing } from '@/lib/queries/admin';
import { formatMoney } from '@/lib/format';

export const metadata = { title: 'Delivery' };
export const dynamic = 'force-dynamic';

const MATCH_LABELS: Record<string, string> = {
  postal_prefix: 'Postal starts with',
  postal_exact: 'Exact postal',
  city: 'City',
};

export default async function DeliveryPage() {
  await requireStaff('manager');
  const [{ zones, rules }, { pricing, modifiers }] = await Promise.all([
    getDeliveryConfig(),
    getDeliveryPricing(),
  ]);

  // Postal rules only matter when they decide something: either they pick the
  // zone, or they gate who can order at all.
  const showAreas = pricing?.delivery_mode === 'zones' || pricing?.delivery_restrict_area === true;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Delivery</h1>
        <p className="text-sm text-muted-foreground">
          What delivery costs, who gets it free, and where you deliver. Changes apply to the next
          order immediately — no deploy needed.
        </p>
      </div>

      {pricing ? <DeliveryPricingForm pricing={pricing} modifiers={modifiers} /> : null}

      {showAreas ? (
        <>
          <div>
            <h2 className="font-display text-lg font-semibold tracking-tight">Where you deliver</h2>
            <p className="text-sm text-muted-foreground">
              {pricing?.delivery_mode === 'zones'
                ? 'Each zone carries its own price. Rules decide which addresses land in which zone.'
                : 'Everyone pays the same flat charge above. These rules decide which addresses you accept at all.'}
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {zones.map((zone) => {
              const zoneRules = rules.filter((r) => r.zone_id === zone.id);
              return (
                <Card key={zone.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle>{zone.name}</CardTitle>
                      <Badge tone={zone.is_active ? 'green' : 'slate'}>
                        {zone.is_active ? 'Active' : 'Paused'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <dl className="space-y-1 text-sm">
                      <Row label="Shipping fee" value={formatMoney(zone.fee_cents)} />
                      <Row
                        label="Free over"
                        value={
                          zone.free_delivery_threshold_cents
                            ? formatMoney(zone.free_delivery_threshold_cents)
                            : 'Never'
                        }
                      />
                      <Row label="Minimum order" value={formatMoney(zone.minimum_order_cents)} />
                      <Row
                        label="Estimated time"
                        value={`${zone.estimated_minutes_min}–${zone.estimated_minutes_max} min`}
                      />
                      {zone.max_distance_km ? (
                        <Row label="Max distance" value={`${zone.max_distance_km} km`} />
                      ) : null}
                    </dl>

                    <div>
                      <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {zoneRules.length} {zoneRules.length === 1 ? 'rule' : 'rules'}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {zoneRules.slice(0, 24).map((rule) => (
                          <span
                            key={rule.id}
                            title={MATCH_LABELS[rule.match_type]}
                            className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] uppercase"
                          >
                            {rule.match_value}
                          </span>
                        ))}
                        {zoneRules.length > 24 ? (
                          <span className="text-[11px] text-muted-foreground">
                            +{zoneRules.length - 24} more
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="max-w-xl">
            <CardHeader>
              <CardTitle>Add a postal code or city</CardTitle>
            </CardHeader>
            <CardContent>
              <DeliveryRuleForm zones={zones.map((z) => ({ id: z.id, name: z.name }))} />
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          You are delivering everywhere at one flat rate. Turn on the area restriction above to
          limit which postal codes can order.
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular font-medium">{value}</dd>
    </div>
  );
}
