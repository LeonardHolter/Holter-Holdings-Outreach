import { NextResponse, type NextRequest } from 'next/server'

// Everything is gated behind the session cookie except the login page, the auth
// endpoints, and Next.js internals/static assets. Without this, page routes were
// open and users never obtained the cookie — so auth-checked APIs (recordings,
// session/claim) returned 401.
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/signout']

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const authed = request.cookies.get('session')?.value === 'authenticated'

  if (authed || PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next({ request })
  }

  // Unauthenticated API calls get a clean 401; page requests go to /login.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = request.nextUrl.clone()
  url.pathname = '/login'
  return NextResponse.redirect(url)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)',
  ],
}
