import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refreshes the staff session on every request and keeps unauthenticated
 * visitors out of /admin. This is a first gate, not the security boundary —
 * Row Level Security is what actually protects the data. Someone who bypasses
 * this middleware still cannot read an order.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  /**
   * Redirect while keeping the session.
   *
   * getUser() can rotate the access token, and @supabase/ssr writes the new
   * cookies onto `response` via setAll above. Returning a fresh
   * NextResponse.redirect() would discard them, so the browser would keep a
   * token that has already been rotated server-side — every later request looks
   * signed out, which shows up as an endless bounce between /admin and
   * /admin/login. Copying the cookies across is what makes the redirect safe.
   */
  const redirectKeepingSession = (url: URL) => {
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isLogin = pathname === '/admin/login';

  if (pathname.startsWith('/admin') && !user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = '/admin/login';
    url.searchParams.set('next', pathname);
    return redirectKeepingSession(url);
  }

  if (isLogin && user) {
    // Only bounce a signed-in visitor to the dashboard if they can actually use
    // it. A valid session with no staff profile — an account created before the
    // schema existed, or one that has been deactivated — used to ping-pong
    // between here and /admin until the browser gave up with "redirected you
    // too many times", which tells the person nothing about what is wrong.
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_active')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.is_active) {
      const url = request.nextUrl.clone();
      url.pathname = '/admin';
      url.search = '';
      return redirectKeepingSession(url);
    }

    // Fall through so the login page renders and can explain itself.
    const url = request.nextUrl.clone();
    if (url.searchParams.get('no_access') !== '1') {
      url.searchParams.set('no_access', '1');
      return redirectKeepingSession(url);
    }
  }

  return response;
}

export const config = {
  matcher: ['/admin/:path*'],
};

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refreshes the staff session on every request and keeps unauthenticated
 * visitors out of /admin. This is a first gate, not the security boundary —
 * Row Level Security is what actually protects the data. Someone who bypasses
 * this middleware still cannot read an order.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isLogin = pathname === '/admin/login';

  if (pathname.startsWith('/admin') && !user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = '/admin/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (isLogin && user) {
    const url = request.nextUrl.clone();
    url.pathname = '/admin';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/admin/:path*'],
};
