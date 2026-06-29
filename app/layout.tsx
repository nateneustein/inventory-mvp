import './globals.css'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Inventory Control Center',
  description: 'Internal inventory and order data management system'
}

const navGroups = [
  {
    title: 'Control',
    links: [
      ['Dashboard', '/dashboard'],
      ['Uploads / Connections', '/uploads'],
      ['Imported Orders', '/imported-orders'],
      ['Reports', '/reports'],
    ]
  },
  {
    title: 'Inventory',
    links: [
      ['Parts / Supplies', '/parts'],
      ['Shipments / Purchases', '/shipments'],
      ['Receiving', '/receiving'],
      ['Adjustments / Switches', '/adjustments'],
      ['Report Zero', '/zero'],
      ['Scanner / QR', '/scanner'],
    ]
  },
  {
    title: 'Products',
    links: [
      ['Finished Products', '/products'],
      ['BOM / Master File', '/boms'],
      ['Mapping Rules', '/mapping-rules'],
      ['Usage', '/usage'],
    ]
  },
  {
    title: 'Planning',
    links: [
      ['Basic Prediction', '/predictions/basic'],
      ['Advanced Prediction', '/predictions/advanced'],
      ['Slack Alerts', '/slack'],
      ['Suppliers', '/suppliers'],
    ]
  }
]

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

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
                {navGroups.map((group) => (
                  <section key={group.title}>
                    <p className="nav-group-title">{group.title}</p>
                    {group.links.map(([label, href]) => (
                      <Link key={href} href={href}>{label}</Link>
                    ))}
                  </section>
                ))}
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
                  <Link className="button secondary" href="/uploads">Upload CSV</Link>
                  <Link className="button" href="/parts">Add / view parts</Link>
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
