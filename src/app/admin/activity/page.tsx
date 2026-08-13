import { Activity } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { requireStaff } from '@/lib/auth';
import { getActivity } from '@/lib/queries/admin';
import { formatDateTime } from '@/lib/format';

export const metadata = { title: 'Activity' };
export const dynamic = 'force-dynamic';

export default async function ActivityPage() {
  await requireStaff('administrator');
  const entries = await getActivity();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Activity</h1>
        <p className="text-sm text-muted-foreground">
          Who did what, and when. Written by the database, not by the app, so it cannot be skipped.
        </p>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="Nothing logged yet"
          description="Orders, payments, and stock movements will appear here as they happen."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  When
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Who
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Action
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Subject
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                    {formatDateTime(entry.created_at)}
                  </td>
                  <td className="px-4 py-2.5">{entry.actor_label}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{entry.action}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    {entry.entity_id ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
