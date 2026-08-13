'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Check, Download, Loader2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatMoney } from '@/lib/format';
import { importProducts, type ImportResult } from '@/lib/actions/products';
import {
  IMPORT_FIELDS,
  TEMPLATE_CSV,
  guessMapping,
  parseCsv,
  prepareRows,
  type CsvRow,
  type ImportField,
  type PreparedRow,
} from '@/lib/csv';
import { cn } from '@/lib/utils';

const NONE = '__none__';
const MAX_PREVIEW = 12;

/**
 * Upload, map, check, import — in that order, because the expensive mistake is
 * committing a file whose columns landed in the wrong fields. Nothing is
 * written until the person has seen what will happen.
 */
export function ProductImport() {
  const router = useRouter();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = React.useState('');
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<CsvRow[]>([]);
  const [mapping, setMapping] = React.useState<Partial<Record<ImportField, string>>>({});
  const [mode, setMode] = React.useState<'update' | 'skip'>('update');
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [result, setResult] = React.useState<ImportResult | null>(null);
  const [pending, startTransition] = React.useTransition();

  const prepared: PreparedRow[] = React.useMemo(
    () => (rows.length ? prepareRows(rows, mapping) : []),
    [rows, mapping],
  );

  const valid = prepared.filter((r) => r.errors.length === 0);
  const broken = prepared.filter((r) => r.errors.length > 0);
  const warned = prepared.filter((r) => r.errors.length === 0 && r.warnings.length > 0);

  function loadText(text: string, name: string) {
    setParseError(null);
    setResult(null);

    try {
      const parsed = parseCsv(text);

      if (parsed.headers.length === 0) {
        setParseError('That file has no header row. The first line should name the columns.');
        return;
      }
      if (parsed.rows.length === 0) {
        setParseError('That file has headers but no products under them.');
        return;
      }

      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setMapping(guessMapping(parsed.headers));
      setFileName(name);
    } catch {
      setParseError('That file could not be read as a spreadsheet.');
    }
  }

  function loadFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      setParseError('That file is over 5 MB. Split it and import in two passes.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => loadText(String(reader.result ?? ''), file.name);
    reader.onerror = () => setParseError('That file could not be read.');
    reader.readAsText(file);
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'product-import-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  function runImport() {
    startTransition(async () => {
      const payload = valid.map((r) => r.values);
      const outcome = await importProducts(payload, mode);
      setResult(outcome);
      if (outcome.ok) router.refresh();
    });
  }

  // --- after a successful import ---------------------------------------------
  if (result?.ok) {
    return (
      <Card>
        <CardContent className="space-y-4 p-6 text-center">
          <div className="mx-auto grid size-10 place-items-center rounded-full bg-accent">
            <Check className="size-5 text-primary" aria-hidden />
          </div>
          <div>
            <p className="font-display text-lg font-semibold">{result.message}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Imported products start hidden from customers only if you set them that way — check
              the list and set prices before you go live.
            </p>
          </div>

          {result.rowErrors && result.rowErrors.length > 0 ? (
            <div className="mx-auto max-w-md rounded-md bg-[var(--warning)]/12 px-3 py-2 text-left text-xs text-[var(--warning)]">
              <p className="font-medium">{result.rowErrors.length} rows were skipped:</p>
              <ul className="mt-1 space-y-0.5">
                {result.rowErrors.slice(0, 5).map((e) => (
                  <li key={e.row}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/admin/products">See the catalog</Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setRows([]);
                setHeaders([]);
                setFileName('');
                setResult(null);
              }}
            >
              Import another file
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- step 1: choose a file --------------------------------------------------
  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-0">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) loadFile(file);
              }}
              className={cn(
                'rounded-xl border border-dashed p-10 text-center transition-colors',
                dragging ? 'border-primary bg-accent' : 'border-border',
              )}
            >
              <Upload className="mx-auto size-7 text-muted-foreground" aria-hidden />
              <p className="mt-3 font-display text-base font-semibold">
                Drop your spreadsheet here
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                A CSV file. In Excel or Google Sheets choose <strong>File → Download → CSV</strong>{' '}
                first. Only a product name column is required.
              </p>

              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="sr-only"
                onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0]!)}
              />

              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button onClick={() => fileRef.current?.click()}>Choose a file</Button>
                <Button variant="outline" onClick={downloadTemplate}>
                  <Download className="size-4" aria-hidden />
                  Download a template
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {parseError ? (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {parseError}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>What the file can contain</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              Column names are matched automatically, and you can correct any of them on the next
              screen. Anything you leave out can be filled in afterwards in the product editor.
            </p>
            <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
              {IMPORT_FIELDS.map((field) => (
                <li key={field.key} className="flex items-baseline gap-2">
                  <span className="font-medium">{field.label}</span>
                  {field.required ? <Badge tone="green">Required</Badge> : null}
                  {field.hint ? (
                    <span className="text-xs text-muted-foreground">{field.hint}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- step 2: map, check, import ---------------------------------------------
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <p className="text-sm">
          <span className="font-medium">{fileName}</span>
          <span className="text-muted-foreground">
            {' '}
            — {rows.length} {rows.length === 1 ? 'row' : 'rows'}
          </span>
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setRows([]);
            setHeaders([]);
            setFileName('');
          }}
        >
          Choose a different file
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Match up the columns</CardTitle>
          <p className="text-sm text-muted-foreground">
            Guessed from your headers. Change anything that landed in the wrong place.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {IMPORT_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <label htmlFor={`map-${field.key}`} className="text-sm font-medium">
                {field.label}
                {field.required ? <span className="ml-0.5 text-destructive">*</span> : null}
              </label>
              <Select
                value={mapping[field.key] ?? NONE}
                onValueChange={(v) =>
                  setMapping((prev) => ({ ...prev, [field.key]: v === NONE ? undefined : v }))
                }
              >
                <SelectTrigger id={`map-${field.key}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not in my file</SelectItem>
                  {headers.map((header) => (
                    <SelectItem key={header} value={header}>
                      {header}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {field.hint ? <p className="text-xs text-muted-foreground">{field.hint}</p> : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Check it before you commit</CardTitle>
          <p className="text-sm text-muted-foreground">
            The first {Math.min(MAX_PREVIEW, prepared.length)} rows, read exactly as they will be
            imported.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge tone="green">{valid.length} ready</Badge>
            {warned.length > 0 ? <Badge tone="amber">{warned.length} with warnings</Badge> : null}
            {broken.length > 0 ? <Badge tone="red">{broken.length} will be skipped</Badge> : null}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">SKU</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {prepared.slice(0, MAX_PREVIEW).map((row) => {
                  const price = row.values.price;
                  const qty = row.values.quantity;
                  return (
                    <tr key={row.index} className={cn(row.errors.length > 0 && 'opacity-60')}>
                      <td className="tabular px-3 py-2 text-muted-foreground">{row.index}</td>
                      <td className="px-3 py-2 font-medium">{row.name || '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {typeof row.values.sku === 'string' ? row.values.sku : 'auto'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {typeof row.values.category === 'string' ? row.values.category : '—'}
                      </td>
                      <td className="tabular px-3 py-2 text-right">
                        {typeof price === 'number' ? formatMoney(price) : '—'}
                      </td>
                      <td className="tabular px-3 py-2 text-right">
                        {typeof qty === 'number' ? qty : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {row.errors.map((e) => (
                          <span key={e} className="block font-medium text-destructive">
                            {e}
                          </span>
                        ))}
                        {row.warnings.map((w) => (
                          <span key={w} className="block text-[var(--warning)]">
                            {w}
                          </span>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {prepared.length > MAX_PREVIEW ? (
            <p className="text-xs text-muted-foreground">
              …and {prepared.length - MAX_PREVIEW} more rows.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Products that already exist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Matched on SKU. A row whose SKU is already in your catalog can either update that
            product or be left alone.
          </p>
          <Select value={mode} onValueChange={(v) => setMode(v as 'update' | 'skip')}>
            <SelectTrigger className="max-w-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="update">Update them with what is in the file</SelectItem>
              <SelectItem value="skip">Leave them exactly as they are</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Updating only touches columns your file actually has, so details you typed in by hand
            are not blanked out. Existing stock counts are never changed by an import — only new
            products get their opening count from the file.
          </p>
        </CardContent>
      </Card>

      {result && !result.ok ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {result.message}
        </p>
      ) : null}

      {broken.length > 0 ? (
        <p className="flex items-start gap-2 rounded-md bg-[var(--warning)]/12 px-3 py-2 text-sm font-medium text-[var(--warning)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {broken.length} {broken.length === 1 ? 'row has' : 'rows have'} no product name and will
          be left out. Everything else still imports.
        </p>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Button onClick={runImport} disabled={pending || valid.length === 0}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {pending
            ? 'Importing'
            : `Import ${valid.length} ${valid.length === 1 ? 'product' : 'products'}`}
        </Button>
        <Button variant="outline" asChild>
          <Link href="/admin/products">
            <ArrowLeft className="size-4" aria-hidden />
            Cancel
          </Link>
        </Button>
        <p className="text-xs text-muted-foreground">
          All or nothing — if anything fails, your catalog is left exactly as it is.
        </p>
      </div>
    </div>
  );
}
