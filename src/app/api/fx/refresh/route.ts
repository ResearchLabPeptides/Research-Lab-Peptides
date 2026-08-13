import { NextResponse } from 'next/server';
import { refreshCachedRate } from '@/lib/fx';

/**
 * Called on a schedule by Vercel Cron (see vercel.json) to keep the CAD/USDC
 * rate current.
 *
 * Vercel signs cron requests with CRON_SECRET. Checking it matters because this
 * endpoint reaches an external service and writes the number every customer is
 * quoted from — it is not something an anonymous caller should be able to
 * trigger at will.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
    }
  }

  const result = await refreshCachedRate();

  if (!result.ok) {
    // 200 on purpose. The refresh failed but the previous rate is still in
    // place and still being served, so this is not an outage and should not
    // page anyone. The message is recorded for the admin screen.
    return NextResponse.json({ ok: false, message: result.message }, { status: 200 });
  }

  return NextResponse.json({ ok: true, rate: result.rate, source: result.source });
}
