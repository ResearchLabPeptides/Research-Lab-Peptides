'use client';

import * as React from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  saveAcknowledgement,
  saveGateSettings,
  setAcknowledgementActive,
} from '@/lib/actions/settings';

export interface AcknowledgementRow {
  id: string;
  key: string;
  label: string;
  body: string;
  link_url: string | null;
  link_label: string;
  is_required: boolean;
  sort_order: number;
  is_active: boolean;
}

export interface GateSettingsValues {
  gateEnabled: boolean;
  gateTitle: string;
  gateIntro: string;
  gateConfirmLabel: string;
  gateDeclineLabel: string;
  gateDeclineUrl: string;
  gateOptionalLabel: string;
  gateRemainingLabel: string;
  gateDoneLabel: string;
  gatePendingLabel: string;
  gateLinkLabel: string;
}

type Feedback = { ok: boolean; message: string } | null;

function Note({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return (
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
  );
}

export function GateManager({
  settings,
  acknowledgements,
}: {
  settings: GateSettingsValues;
  acknowledgements: AcknowledgementRow[];
}) {
  return (
    <div className="space-y-4">
      <GateSettingsCard initial={settings} />
      <AcknowledgementList rows={acknowledgements} />
      <NewAcknowledgementCard nextSortOrder={(acknowledgements.at(-1)?.sort_order ?? 0) + 10} />
    </div>
  );
}

function GateSettingsCard({ initial }: { initial: GateSettingsValues }) {
  const [values, setValues] = React.useState(initial);
  const [feedback, setFeedback] = React.useState<Feedback>(null);
  const [pending, startTransition] = React.useTransition();

  function set<K extends keyof GateSettingsValues>(key: K, value: GateSettingsValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entry gate</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => setFeedback(await saveGateSettings(values)));
          }}
          className="max-w-xl space-y-4"
        >
          <label className="flex items-start gap-3 rounded-lg border border-border p-3">
            <input
              type="checkbox"
              checked={values.gateEnabled}
              onChange={(e) => set('gateEnabled', e.target.checked)}
              className="mt-0.5 size-5 accent-[var(--primary)]"
            />
            <span>
              <span className="text-sm font-medium">Require confirmation before ordering</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Off means the shop is open to everyone. Checkout stops enforcing the
                acknowledgements too.
              </span>
            </span>
          </label>

          <Field id="g-title" label="Heading" required>
            <Input value={values.gateTitle} onChange={(e) => set('gateTitle', e.target.value)} />
          </Field>

          <Field id="g-intro" label="Introduction">
            <Textarea
              rows={2}
              value={values.gateIntro}
              onChange={(e) => set('gateIntro', e.target.value)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="g-confirm" label="Confirm button" required>
              <Input
                value={values.gateConfirmLabel}
                onChange={(e) => set('gateConfirmLabel', e.target.value)}
              />
            </Field>
            <Field id="g-decline" label="Leave link" required>
              <Input
                value={values.gateDeclineLabel}
                onChange={(e) => set('gateDeclineLabel', e.target.value)}
              />
            </Field>
          </div>

          <Field
            id="g-decline-url"
            label="Where the leave link goes"
            hint="Anyone who does not confirm is sent here"
            required
          >
            <Input
              type="url"
              value={values.gateDeclineUrl}
              onChange={(e) => set('gateDeclineUrl', e.target.value)}
            />
          </Field>

          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
              The smaller wording
            </summary>
            <div className="space-y-4 border-t border-border p-3">
              <p className="text-xs text-muted-foreground">
                Every remaining word on the gate. Nothing here is fixed in code.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="g-remaining"
                  label="While boxes are unticked"
                  hint="{n} becomes the number still outstanding"
                  required
                >
                  <Input
                    value={values.gateRemainingLabel}
                    onChange={(e) => set('gateRemainingLabel', e.target.value)}
                  />
                </Field>
                <Field id="g-done" label="Once everything is ticked">
                  <Input
                    value={values.gateDoneLabel}
                    onChange={(e) => set('gateDoneLabel', e.target.value)}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="g-optional"
                  label="Tag on optional items"
                  hint="Beside anything a visitor does not have to tick"
                >
                  <Input
                    value={values.gateOptionalLabel}
                    onChange={(e) => set('gateOptionalLabel', e.target.value)}
                  />
                </Field>
                <Field
                  id="g-pending"
                  label="Button while it saves"
                  hint="Shown for the moment after they press confirm"
                  required
                >
                  <Input
                    value={values.gatePendingLabel}
                    onChange={(e) => set('gatePendingLabel', e.target.value)}
                  />
                </Field>
              </div>

              <Field
                id="g-linklabel"
                label="Default link text"
                hint="Used when an item has a URL but no link text of its own"
              >
                <Input
                  value={values.gateLinkLabel}
                  onChange={(e) => set('gateLinkLabel', e.target.value)}
                />
              </Field>
            </div>
          </details>

          <Note feedback={feedback} />

          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? 'Saving' : 'Save gate'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AcknowledgementList({ rows }: { rows: AcknowledgementRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Acknowledgements</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Shown in this order. Editing any wording asks every visitor to confirm again, and past
          orders keep the wording they were shown at the time.
        </p>

        {rows.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Nothing to confirm yet, so the gate stays down. Add one below.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <AcknowledgementRowItem key={row.id} row={row} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AcknowledgementRowItem({ row }: { row: AcknowledgementRow }) {
  const [editing, setEditing] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [feedback, setFeedback] = React.useState<Feedback>(null);

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{row.label}</p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">{row.key}</p>
          {row.body ? <p className="mt-1 text-xs text-muted-foreground">{row.body}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge tone={row.is_required ? 'green' : 'slate'}>
            {row.is_required ? 'Required' : 'Optional'}
          </Badge>
          {row.is_active ? null : <Badge tone="slate">Retired</Badge>}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Cancel' : 'Edit'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () =>
              setFeedback(await setAcknowledgementActive(row.id, !row.is_active)),
            )
          }
        >
          {row.is_active ? 'Retire' : 'Bring back'}
        </Button>
      </div>

      {feedback ? (
        <div className="mt-2">
          <Note feedback={feedback} />
        </div>
      ) : null}

      {editing ? (
        <div className="mt-3">
          <AcknowledgementForm
            initial={row}
            acknowledgementId={row.id}
            onSaved={() => setEditing(false)}
          />
        </div>
      ) : null}
    </li>
  );
}

function NewAcknowledgementCard({ nextSortOrder }: { nextSortOrder: number }) {
  const [open, setOpen] = React.useState(false);

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        Add an acknowledgement
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New acknowledgement</CardTitle>
      </CardHeader>
      <CardContent>
        <AcknowledgementForm
          initial={{
            key: '',
            label: '',
            body: '',
            link_url: '',
            link_label: '',
            is_required: true,
            sort_order: nextSortOrder,
            is_active: true,
          }}
          onSaved={() => setOpen(false)}
        />
      </CardContent>
    </Card>
  );
}

function AcknowledgementForm({
  initial,
  acknowledgementId,
  onSaved,
}: {
  initial: Omit<AcknowledgementRow, 'id'> & { link_url: string | null };
  acknowledgementId?: string;
  onSaved: () => void;
}) {
  const [values, setValues] = React.useState({
    key: initial.key,
    label: initial.label,
    body: initial.body,
    linkUrl: initial.link_url ?? '',
    linkLabel: initial.link_label,
    isRequired: initial.is_required,
    sortOrder: initial.sort_order,
    isActive: initial.is_active,
  });
  const [feedback, setFeedback] = React.useState<Feedback>(null);
  const [pending, startTransition] = React.useTransition();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await saveAcknowledgement(values, acknowledgementId);
          setFeedback(result);
          if (result.ok) onSaved();
        });
      }}
      className="space-y-3"
    >
      <Field
        id={`ack-key-${acknowledgementId ?? 'new'}`}
        label="Key"
        hint="Stored on every order. Do not change it once orders exist."
        required
      >
        <Input
          value={values.key}
          disabled={Boolean(acknowledgementId)}
          onChange={(e) => setValues((p) => ({ ...p, key: e.target.value }))}
          placeholder="age_of_majority"
          className="font-mono"
        />
      </Field>

      <Field
        id={`ack-label-${acknowledgementId ?? 'new'}`}
        label="Checkbox text"
        hint="Write it as the customer would say it: “I am 19 or older”"
        required
      >
        <Input
          value={values.label}
          onChange={(e) => setValues((p) => ({ ...p, label: e.target.value }))}
        />
      </Field>

      <Field id={`ack-body-${acknowledgementId ?? 'new'}`} label="Supporting detail">
        <Textarea
          rows={2}
          value={values.body}
          onChange={(e) => setValues((p) => ({ ...p, body: e.target.value }))}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`ack-url-${acknowledgementId ?? 'new'}`} label="Link URL">
          <Input
            type="url"
            value={values.linkUrl}
            onChange={(e) => setValues((p) => ({ ...p, linkUrl: e.target.value }))}
          />
        </Field>
        <Field id={`ack-linklabel-${acknowledgementId ?? 'new'}`} label="Link text">
          <Input
            value={values.linkLabel}
            onChange={(e) => setValues((p) => ({ ...p, linkLabel: e.target.value }))}
            placeholder="Read the policy"
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={values.isRequired}
            onChange={(e) => setValues((p) => ({ ...p, isRequired: e.target.checked }))}
            className="size-4 accent-[var(--primary)]"
          />
          Must be ticked to order
        </label>
        <Field id={`ack-sort-${acknowledgementId ?? 'new'}`} label="Position">
          <Input
            type="number"
            className="tabular"
            value={values.sortOrder}
            onChange={(e) => setValues((p) => ({ ...p, sortOrder: Number(e.target.value) }))}
          />
        </Field>
      </div>

      <Note feedback={feedback} />

      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {pending ? 'Saving' : acknowledgementId ? 'Save changes' : 'Add acknowledgement'}
      </Button>
    </form>
  );
}
