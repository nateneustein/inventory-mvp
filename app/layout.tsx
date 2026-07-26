import './globals.css'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getPermissions } from '@/lib/permissions'
import { NavLink } from '@/components/nav-link'

export const metadata = {
  title: 'Inventory Control Center',
  description: 'Internal inventory and order data management system'
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
      ['Shipments / Purchases', '/shipments', 'canManagePurchasing'],
      ['Receiving', '/receiving'],
      ['Adjustments / Switches', '/adjustments', 'canAdjustStock'],
      ['Damage / Scrap', '/damage'],
      ['Report Zero', '/zero'],
      ['Counts', '/counts', 'canRecordCycleCount'],
      ['Scanner / QR', '/scanner'],
    ]
  },
  {
    title: 'Products',
    links: [
      ['Finished Products', '/products', 'canManageMasterData'],
      ['BOM / Master File', '/boms', 'canManageMasterData'],
      ['Mapping Rules', '/mapping-rules', 'canUploadOrders'],
      ['Usage', '/usage'],
    ]
  },
  {
    title: 'Planning',
    links: [
      ['Basic Prediction', '/predictions/basic'],
      ['Advanced Prediction', '/predictions/advanced'],
      ['Slack Alerts', '/slack', 'canManageIntegrations'],
      ['Suppliers', '/suppliers', 'canManageMasterData'],
    ]
  },
  {
    title: 'Admin',
    links: [
      ['Users and roles', '/users', 'canManageUsers'],
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
        <div className="app-shell">
          {user && (
            <aside className="sidebar">
              <Link className="brand-card" href="/dashboard">
                <span className="brand-icon">IC</span>
                <span>
                  <b>Inventory Control</b>
                  <small>Blueview internal app</small>
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
              <div>
                <div className="eyebrow">Inventory Management MVP</div>
                <div className="topbar-title">Operations dashboard</div>
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
            <main className="container">{children}</main>
          </div>
        </div>
      </body>
    </html>
  )
}
