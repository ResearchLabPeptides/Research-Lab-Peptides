import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getStaffProfile } from '@/lib/auth';

/**
 * The staff manual, served only to signed-in staff.
 *
 * The obvious place for a PDF is `public/`, but everything in there is served
 * to anyone who knows the URL — no session, no check. The manual describes how
 * payments are confirmed, how the entry gate works and where the back office
 * lives, which is not information to hand to whoever guesses the filename.
 *
 * So the file sits outside `public/` and is read here after the session is
 * checked. next.config.ts tells the build to include it in the deployment
 * bundle; without that entry the file is not uploaded and this route returns a
 * 404 in production while working perfectly on a developer's machine.
 */
export const dynamic = 'force-dynamic';

const MANUAL_PATH = path.join(process.cwd(), 'private', 'user-manual.pdf');

export async function GET() {
  // Deliberately not requireStaff(): that redirects, which is right for a page
  // and wrong for a file. A browser following a redirect to the login page and
  // saving it as "user-manual.pdf" is a confusing way to be told to sign in.
  const profile = await getStaffProfile();

  if (!profile) {
    return NextResponse.json(
      { error: 'The staff manual is for signed-in staff. Sign in and try again.' },
      { status: 401 },
    );
  }

  try {
    const file = await readFile(MANUAL_PATH);

    return new NextResponse(new Uint8Array(file), {
      headers: {
        'Content-Type': 'application/pdf',
        // inline, not attachment: it opens in the browser's PDF viewer, and the
        // viewer's own download button is right there for anyone who wants a
        // copy. Forcing a download on someone who wanted to check one page is
        // the more annoying default.
        'Content-Disposition': 'inline; filename="futurelite-staff-manual.pdf"',
        // Private: a shared or proxy cache must never hold this, and a browser
        // should re-check that the person is still signed in.
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          'The manual file is missing from the deployment. It should be at private/user-manual.pdf.',
      },
      { status: 404 },
    );
  }
}
