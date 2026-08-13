import { EmailTemplateManager } from '@/components/admin/email-template-manager';
import { requireStaff } from '@/lib/auth';
import { getEmailTemplates } from '@/lib/queries/admin';

export const metadata = { title: 'Customer emails' };
export const dynamic = 'force-dynamic';

export default async function EmailsPage() {
  await requireStaff('administrator');
  const templates = await getEmailTemplates();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Customer emails</h1>
        <p className="text-sm text-muted-foreground">
          Every message the shop sends. Edit the wording, see exactly what arrives, or switch one
          off.
        </p>
      </div>

      <EmailTemplateManager templates={templates} />

      <p className="text-xs text-muted-foreground">
        Emails only send once an email provider is configured. Without one they are written to the
        server log instead, and the on-screen payment instructions still work.
      </p>
    </div>
  );
}
