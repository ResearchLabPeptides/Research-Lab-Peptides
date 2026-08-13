import { CalendarRange, Download, FileSpreadsheet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReportRange } from '@/components/admin/report-range';
import { requireStaff } from '@/lib/auth';
import { getReportCounts } from '@/lib/queries/admin';
import { REPORTS, REPORT_GROUPS, isRangeKey, rangeLabel, type RangeKey } from '@/lib/reports';

export const metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  await requireStaff();

  const { range: rawRange } = await searchParams;
  const range: RangeKey = isRangeKey(rawRange) ? rawRange : '30d';
  const counts = await getReportCounts(range);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Download any of these as a spreadsheet. Opens in Excel, Numbers, and Google Sheets.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <CalendarRange className="size-4 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">Period</p>
        </div>
        <ReportRange value={range} />
      </div>

      {REPORT_GROUPS.map((group) => {
        const items = REPORTS.filter((r) => r.group === group);
        return (
          <section key={group} className="space-y-3">
            <h2 className="font-display text-lg font-semibold tracking-tight">{group}</h2>

            <div className="grid gap-3 md:grid-cols-2">
              {items.map((report) => {
                const count = counts[report.key];
                const unavailable = count === null;
                const empty = count === 0;

                return (
                  <Card key={report.key} className="flex flex-col">
                    <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                      <div className="min-w-0">
                        <CardTitle className="text-base">{report.title}</CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">{report.description}</p>
                      </div>
                      <FileSpreadsheet
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    </CardHeader>

                    <CardContent className="mt-auto flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs text-muted-foreground">
                        {unavailable ? (
                          <Badge tone="slate">Not available to your role</Badge>
                        ) : (
                          <>
                            <span className="tabular font-medium text-foreground">{count}</span>{' '}
                            {count === 1 ? 'row' : 'rows'}
                            <span className="ml-1">
                              {report.dateColumn
                                ? `· ${rangeLabel(range)}`
                                : `· ${report.rangeNote}`}
                            </span>
                          </>
                        )}
                      </div>

                      {/* A plain link, so the browser downloads it rather than
                          navigating. No JavaScript involved in the download. */}
                      {unavailable || empty ? (
                        <span className="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-muted-foreground">
                          {empty ? 'Nothing to download' : 'Unavailable'}
                        </span>
                      ) : (
                        <a
                          href={`/api/admin/export?report=${report.key}&range=${range}`}
                          download
                          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                        >
                          <Download className="size-3.5" aria-hidden />
                          Download CSV
                          <span className="sr-only">
                            {' '}
                            — {report.title},{' '}
                            {report.dateColumn ? rangeLabel(range) : report.rangeNote}
                          </span>
                        </a>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}

      <p className="text-xs text-muted-foreground">
        Each download is capped at 20,000 rows. Narrow the period if a report is bigger than that.
      </p>
    </div>
  );
}
