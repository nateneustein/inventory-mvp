import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Keeps people out of screens their role cannot use.
 *
 * This is a courtesy, not the security boundary. The real enforcement is
 * row-level security in Postgres, which applies no matter how a request
 * arrives. That matters here, because this check DELIBERATELY FAILS OPEN: if
 * the role lookup errors for any reason, the request is allowed through rather
 * than blocked. A blocked request would lock the whole team out of the app over
 * a transient database hiccup, whereas letting it through only means someone
 * briefly sees a page whose buttons the database will refuse anyway.
 */

const MANAGER_PATHS = [
  '/counts',
  '/adjustments',
  '/uploads',
  '/imported-orders',
  '/mapping-rules',
  '/boms',
  '/products',
  '/suppliers',
  '/shipments',
  '/purchase-orders',
]

const ADMIN_PATHS = ['/slack', '/users']

function requiredRole(pathname: string): 'admin' | 'manager' | null {
  if (ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return 'admin'
  if (MANAGER_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return 'manager'
  return null
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request })
  const needed = requiredRole(request.nextUrl.pathname)
  if (!needed) return response

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return response // not signed in -- the page itself redirects to /login

    const { data, error } = await supabase
      .from('profiles')
      .select('role, active')
      .eq('id', user.id)
      .maybeSingle()

    if (error || !data) return response // fail open, see note above

    const role = data.active ? data.role : 'none'
    const allowed = needed === 'admin'
      ? role === 'admin'
      : role === 'admin' || role === 'manager'

    if (allowed) return response

    const url = request.nextUrl.clone()
    url.pathname = '/no-access'
    url.search = `?from=${encodeURIComponent(request.nextUrl.pathname)}&role=${encodeURIComponent(role)}`
    return NextResponse.redirect(url)
  } catch {
    return response // fail open
  }
}

export const config = {
  matcher: [
    // Everything except Next internals, the auth routes and static files.
    '/((?!_next/static|_next/image|favicon.ico|login|auth|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
