import './globals.css'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getPermissions } from '@/lib/permissions'
import { NavLink } from '@/components/nav-link'
import { TopbarTitle } from '@/components/topbar-title'
import { FormGuard } from '@/components/form-guard'
import { PermissionBanner } from '@/components/permission-banner'
import { Suspense } from 'react'

export const metadata = {
  title: 'EO Inventory Management',
  description: 'Engraving One - stock, ordering and prediction',
  icons: { icon: '/icon.svg' }
}

// 'needs' names the permission a link requires. Anything without one is
// visible to every signed-in role.
const navGroups = [
  {
    title: 'Control',
    links: [
      ['Dashboard', '/dashboard'],
      ['Uploads / Connections', '/uploads', 'canUploadOrders'],
      ['Imported Orders', '/imported-orders', 'canUploadOrders'],
      ['Reports', '/reports'],
    ]
  },
  {
    title: 'Inventory',
    links: [
      ['Parts / Supplies', '/parts'],
      ['Shipments / Purchases', '/shipments', 'canViewShipments'],
      ['Receiving', '/receiving'],
      ['Adjustments / Switches', '/adjustments', 'canAdjustStock'],
      ['Report Zero / Running Low', '/zero'],
      /* Hidden from the menu on purpose, not deleted: nobody is reporting damage
         or replacements right now, and counting happens on the Adjustments page.
         The pages and all their records still exist at /damage, /replacements and
         /counts - put a line back here to bring one into the menu again. */
      ['Reorder List', '/reorder'],
    ]
  },
  {
    title: 'Products',
    links: [
      ['Finished Products', '/products', 'canManageMasterData'],
      ['BOM / Master File', '/boms', 'canManageMasterData'],
      ['Mapping Rules', '/mapping-rules', 'canUploadOrders'],
      ['Usage & History', '/usage'],
    ]
  },
  {
    title: 'Planning',
    links: [
      ['Basic Prediction', '/predictions/basic'],
      ['Advanced Prediction', '/predictions/advanced'],
      ['Suppliers', '/suppliers', 'canManageMasterData'],
    ]
  },
  {
    title: 'Admin',
    links: [
      ['Users and roles', '/users', 'canManageUsers'],
      ['Slack Alerts', '/slack', 'canManageIntegrations'],
    ]
  }
]

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const perms = await getPermissions()
  const allowed = (needs?: string) => !needs || Boolean((perms as any)[needs])

  return (
    <html lang="en">
      <body>
        {/* One listener for the whole app: confirms anything destructive and
            marks buttons busy. Covers every page, including ones added later. */}
        <FormGuard />
        <div className="app-shell">
          {user && (
            <aside className="sidebar">
              <Link className="brand-card" href="/dashboard">
                <img className="brand-icon" src="/icon.svg" alt="" width={34} height={34} />
                <span>
                  <b>EO Inventory</b>
                  <small>Engraving One</small>
                </span>
              </Link>

              <nav className="side-nav">
                {navGroups.map((group) => {
                  const links = group.links.filter(([, , needs]) => allowed(needs as string | undefined))
                  if (links.length === 0) return null
                  return (
                    <section key={group.title}>
                      <p className="nav-group-title">{group.title}</p>
                      {links.map(([label, href]) => (
                        <NavLink key={href as string} href={href as string}>{label}</NavLink>
                      ))}
                    </section>
                  )
                })}
              </nav>
            </aside>
          )}

          <div className="main-shell">
            <header className="topbar">
              {/* TopbarTitle now prints both lines: the section this page sits in,
                  then the page name. The old fixed "Inventory Management MVP" line
                  said the same thing on all 19 pages, which is no help to anyone. */}
              <div>
                <TopbarTitle />
              </div>
              {user ? (
                <div className="topbar-actions">
                  <span className="badge info" title={user.email || ''}>{perms.label}</span>
                  {perms.canUploadOrders && <Link className="button secondary" href="/uploads">Upload CSV</Link>}
                  <Link className="button" href="/parts">{perms.canManageMasterData ? 'Add / view parts' : 'View parts'}</Link>
                  <Link className="button ghost" href="/auth/signout">Sign out</Link>
                </div>
              ) : (
                <Link className="button" href="/login">Sign in</Link>
              )}
            </header>
            <main className="container">
              {/* Reads ?denied= so a refused change is stated rather than silent. */}
              <Suspense fallback={null}><PermissionBanner /></Suspense>
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  )
}
