import { createClient } from '@/lib/supabase/server';

/**
 * TEMPORARY DIAGNOSTIC — delete this file once the back office works.
 *
 * getStaffProfile() throws away the error from its profiles query, so when it
 * returns null there is nothing in any log to say why. This runs the identical
 * query and prints the result and the error, which is the difference between
 * "no row exists", "the row is keyed to a different account", and "row level
 * security refused the read".
 *
 * It shows only the signed-in account's own id and profile, and only to someone
 * who already holds a valid session, so it exposes nothing they could not
 * already see. Delete it anyway — a diagnostic left in production is a
 * diagnostic nobody remembers is there.
 */
export const dynamic = 'force-dynamic';

export default async function WhoAmIPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  // Exactly the query getStaffProfile() runs, with the error kept this time.
  const single = user
    ? await supabase
        .from('profiles')
        .select('id, email, full_name, role, is_active')
        .eq('id', user.id)
        .single()
    : null;

  // Same lookup without .single(), which errors on zero rows. If this returns a
  // row and the one above does not, the difference is the row count, not access.
  const list = user
    ? await supabase.from('profiles').select('id, email, role, is_active').eq('id', user.id)
    : null;

  // How many profile rows this session can see at all. Zero here alongside a
  // real row in the SQL editor means row level security is refusing the read,
  // because the editor bypasses RLS and this does not.
  const visible = await supabase.from('profiles').select('id', { count: 'exact', head: true });

  const box = {
    padding: '1rem',
    marginBottom: '1rem',
    border: '1px solid #ccc',
    borderRadius: '8px',
    background: '#fff',
    whiteSpace: 'pre-wrap' as const,
    fontFamily: 'ui-monospace, monospace',
    fontSize: '13px',
  };

  return (
    <main style={{ padding: '2rem', maxWidth: '52rem', margin: '0 auto', color: '#111' }}>
      <h1 style={{ fontFamily: 'system-ui', fontSize: '20px', marginBottom: '1rem' }}>
        Back-office diagnostic
      </h1>

      <h2 style={{ fontFamily: 'system-ui', fontSize: '15px' }}>1. Session</h2>
      <div style={box}>
        {JSON.stringify(
          { signed_in: !!user, auth_uid: user?.id ?? null, email: user?.email ?? null, error: userError?.message ?? null },
          null,
          2,
        )}
      </div>

      <h2 style={{ fontFamily: 'system-ui', fontSize: '15px' }}>
        2. The exact query the app runs
      </h2>
      <div style={box}>
        {JSON.stringify(
          { data: single?.data ?? null, error: single?.error?.message ?? null, code: single?.error?.code ?? null },
          null,
          2,
        )}
      </div>

      <h2 style={{ fontFamily: 'system-ui', fontSize: '15px' }}>3. Same query, without .single()</h2>
      <div style={box}>
        {JSON.stringify(
          { rows: list?.data ?? null, error: list?.error?.message ?? null },
          null,
          2,
        )}
      </div>

      <h2 style={{ fontFamily: 'system-ui', fontSize: '15px' }}>
        4. Profile rows this session can see
      </h2>
      <div style={box}>
        {JSON.stringify({ count: visible.count, error: visible.error?.message ?? null }, null, 2)}
      </div>

      <p style={{ fontFamily: 'system-ui', fontSize: '13px', color: '#555' }}>
        Delete <code>src/app/admin/whoami/page.tsx</code> once this is sorted.
      </p>
    </main>
  );
}
