'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Mail, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { saveEmailTemplate } from '@/lib/actions/emails';
import { TEMPLATE_PLACEHOLDERS, renderTemplate } from '@/lib/email-shared';
import type { EmailTemplateRow } from '@/lib/queries/admin';
import { cn } from '@/lib/utils';

/** Stand-in values, so the preview reads like a real message rather than a form. */
const SAMPLE = {
  company_name: 'Fernwood Provisions',
  customer_name: 'Priya Sandhu',
  order_number: 'ORD-2026-000148',
  subtotal: '$49.90',
  shipping: 'Free',
  discount: '-$4.99',
  tax: '$2.25',
  total: '$47.16',
  items: '  2 × Cold Pressed Olive Oil, 750 ml — $45.98\n  1 × Sourdough Loaf — $6.99',
  address: '12850 96 Avenue\nUnit 204\nSurrey, BC V3V 1Z1',
  payment_email: 'payments@fernwoodprovisions.ca',
  track_url: 'https://yourshop.ca/orders/ORD-2026-000148',
  note: 'Running about 20 minutes behind — sorry about that.',
};

export function EmailTemplateManager({ templates }: { templates: EmailTemplateRow[] }) {
  const [activeKey, setActiveKey] = React.useState(templates[0]?.key ?? '');
  const active = templates.find((t) => t.key === activeKey) ?? templates[0];

  if (!active) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        No templates found. Check that migration 0020 has been applied.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {templates.map((template) => (
          <button
            key={template.key}
            type="button"
            onClick={() => setActiveKey(template.key)}
            aria-pressed={template.key === activeKey}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              template.key === activeKey
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {template.name}
            {!template.is_active ? ' · off' : ''}
          </button>
        ))}
      </div>

      {/* Remounts when the tab changes, so switching templates cannot carry
          half-typed edits across to another one. */}
      <TemplateEditor key={active.key} template={active} />
    </div>
  );
}

function TemplateEditor({ template }: { template: EmailTemplateRow }) {
  const router = useRouter();
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  const [subject, setSubject] = React.useState(template.subject);
  const [body, setBody] = React.useState(template.body);
  const [isActive, setIsActive] = React.useState(template.is_active);
  const [feedback, setFeedback] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  const dirty =
    subject !== template.subject || body !== template.body || isActive !== template.is_active;

  /** Drops a placeholder in at the cursor rather than making people type braces. */
  function insert(token: string) {
    const el = bodyRef.current;
    if (!el) return;
    const at = el.selectionStart;
    const next = `${body.slice(0, at)}{${token}}${body.slice(el.selectionEnd)}`;
    setBody(next);
    queueMicrotask(() => {
      el.focus();
      const pos = at + token.length + 2;
      el.setSelectionRange(pos, pos);
    });
  }

  // An unknown placeholder is left in the sent email as literal braces, which
  // looks broken to the customer. Catch typos before they go out.
  const known = new Set(TEMPLATE_PLACEHOLDERS.map((p) => p.token as string));
  const unknown = [
    ...new Set([...`${subject}\n${body}`.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)),
  ].filter((token) => !known.has(token));

  function save() {
    startTransition(async () => {
      const result = await saveEmailTemplate({ key: template.key, subject, body, isActive });
      setFeedback(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{template.name}</CardTitle>
          <p className="text-sm text-muted-foreground">{template.description}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field id="tpl-subject" label="Subject line" required>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>

          <div className="space-y-1.5">
            <label htmlFor="tpl-body" className="text-sm font-medium">
              Message<span className="ml-0.5 text-destructive">*</span>
            </label>
            <textarea
              ref={bodyRef}
              id="tpl-body"
              rows={16}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm leading-relaxed shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              Plain text. A blank line starts a new paragraph, and a line in CAPITALS becomes a
              small heading.
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium">Insert a detail</p>
            <div className="flex flex-wrap gap-1">
              {TEMPLATE_PLACEHOLDERS.map((p) => (
                <button
                  key={p.token}
                  type="button"
                  onClick={() => insert(p.token)}
                  title={p.description}
                  className="rounded border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                >
                  {`{${p.token}}`}
                </button>
              ))}
            </div>
          </div>

          {unknown.length > 0 ? (
            <p className="rounded-md bg-[var(--warning)]/12 px-3 py-2 text-xs font-medium text-[var(--warning)]">
              {unknown.map((t) => `{${t}}`).join(', ')} {unknown.length === 1 ? 'is' : 'are'} not a
              detail this email knows. It would be sent to the customer exactly as written.
            </p>
          ) : null}

          <CheckboxField
            id="tpl-active"
            label="Send this email"
            description="Switch off to stop it going out without losing the wording"
            checked={isActive}
            onChange={setIsActive}
          />

          {feedback ? (
            <p
              role="status"
              className={
                feedback.ok
                  ? 'rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground'
                  : 'rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive'
              }
            >
              {feedback.message}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={save} disabled={pending || !dirty}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {pending ? 'Saving' : 'Save changes'}
            </Button>
            {dirty ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSubject(template.subject);
                  setBody(template.body);
                  setIsActive(template.is_active);
                  setFeedback(null);
                }}
              >
                <RotateCcw className="size-4" aria-hidden />
                Undo changes
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">No unsaved changes</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="lg:sticky lg:top-4 lg:self-start">
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle>What the customer gets</CardTitle>
          {!isActive ? <Badge tone="slate">Not being sent</Badge> : null}
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <p className="text-xs text-muted-foreground">Subject</p>
            <p className="mt-0.5 text-sm font-semibold">{renderTemplate(subject, SAMPLE)}</p>
          </div>

          <div className="mt-3 rounded-lg border border-border p-4">
            <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {SAMPLE.company_name}
            </p>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
              {renderTemplate(body, SAMPLE)}
            </pre>
          </div>

          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Mail className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Shown with example details filled in. Real emails use the actual order.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
