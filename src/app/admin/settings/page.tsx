import { SettingsForm } from '@/components/admin/settings-form';
import { GateManager } from '@/components/admin/gate-manager';
import { requireStaff } from '@/lib/auth';
import { getAcknowledgements, getSettings } from '@/lib/queries/admin';

export const metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  await requireStaff('administrator');
  const [settings, acknowledgements] = await Promise.all([getSettings(), getAcknowledgements()]);

  if (!settings) {
    return (
      <p className="text-sm text-muted-foreground">
        Settings could not be loaded. Check that migration 0002 has been applied.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Business details, tax, and payment. Shipping pricing lives under Delivery.
        </p>
      </div>

      <SettingsForm
        initial={{
          companyName: settings.company_name,
          currency: settings.currency,
          taxRateBps: settings.tax_rate_bps,
          paymentEmail: settings.payment_email,
          deliveryEmail: settings.delivery_email,
          supportPhone: settings.support_phone,
          orderPrefix: settings.order_prefix,
          lowStockThresholdDefault: settings.low_stock_threshold_default,
          expiryWarningDays: settings.expiry_warning_days,
        }}
      />

      <div className="border-t border-border pt-6">
        <h2 className="font-display text-xl font-bold tracking-tight">
          Before customers can order
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          What every visitor confirms on arrival. Checkout re-checks these, so an order cannot be
          written without them even if someone gets past the dialog.
        </p>

        <GateManager
          settings={{
            gateEnabled: settings.gate_enabled,
            gateTitle: settings.gate_title,
            gateIntro: settings.gate_intro,
            gateConfirmLabel: settings.gate_confirm_label,
            gateDeclineLabel: settings.gate_decline_label,
            gateDeclineUrl: settings.gate_decline_url,
            gateOptionalLabel: settings.gate_optional_label,
            gateRemainingLabel: settings.gate_remaining_label,
            gateDoneLabel: settings.gate_done_label,
            gatePendingLabel: settings.gate_pending_label,
            gateLinkLabel: settings.gate_link_label,
          }}
          acknowledgements={acknowledgements}
        />
      </div>
    </div>
  );
}
