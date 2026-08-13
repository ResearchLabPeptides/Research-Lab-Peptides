import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getStaffProfile } from '@/lib/auth';
import { findReport, isRangeKey, resolveRange, type RangeKey } from '@/lib/reports';

/**
 * Downloads a report as CSV.
 *
 * Every report is a database view or table, so this route is a thin serializer.
 * It runs under the caller's own session, which means Row Level Security
 * decides what they can export — a download is not a way around a policy.
 *
 * CSV opens directly in Excel, Numbers, and Google Sheets. For a true .xlsx or
 * PDF, pipe this output through the generator of your choice; the data is the
 * same either way.
 */
const MAX_ROWS = 20_000;

export async function GET(request: Request) {
  const profile = await getStaffProfile();
  if (!profile) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const report = findReport(params.get('report') ?? '');

  if (!report) {
    return NextResponse.json({ error: 'Unknown report.' }, { status: 400 });
  }

  // Narrow on a plain value so the type guard actually applies to `range`.
  const rangeParam = params.get('range') ?? undefined;
  const range: RangeKey = isRangeKey(rangeParam) ? rangeParam : 'all';

  const supabase = await createClient();
  let query = supabase.from(report.source).select('*').limit(MAX_ROWS);

  if (report.dateColumn) {
    const { from, to } = resolveRange(range);
    if (from) query = query.gte(report.dateColumn, from.toISOString());
    if (to) query = query.lt(report.dateColumn, to.toISOString());
    query = query.order(report.orderBy ?? report.dateColumn, { ascending: false });
  }

  const { data, error } = await query;

  if (error) {
    console.error('[export] failed', report.key, error);
    return NextResponse.json({ error: 'Could not build that report.' }, { status: 502 });
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const stamp = new Date().toISOString().slice(0, 10);
  const suffix = report.dateColumn && range !== 'all' ? `-${range}` : '';

  return new NextResponse(toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${report.filename}${suffix}-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);

  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    // Quote anything containing a delimiter, quote, or newline; double inner quotes.
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  // \r\n is what Excel expects; Numbers and Sheets accept it too.
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ].join('\r\n');
}
