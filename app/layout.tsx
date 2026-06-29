import './globals.css'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Inventory MVP',
  description: 'Internal inventory management system MVP'
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <div className="nav-inner">
            <Link className="brand" href="/dashboard">Inventory MVP</Link>
            {user && (
              <>
                <Link href="/dashboard">Dashboard</Link>
                <Link href="/uploads">Uploads</Link>
                <Link href="/imported-orders">Imported Orders</Link>
                <Link href="/mapping-rules">Mapping</Link>
                <Link href="/products">Finished Products</Link>
                <Link href="/boms">BOM</Link>
                <Link href="/parts">Parts</Link>
                <Link href="/shipments">Shipments</Link>
                <Link href="/adjustments">Adjustments</Link>
                <Link href="/usage">Usage</Link>
                <Link href="/predictions/basic">Basic Prediction</Link>
                <Link href="/predictions/advanced">Advanced Prediction</Link>
                <Link href="/zero">Report Zero</Link>
                <Link href="/reports">Reports</Link>
                <Link href="/scanner">Scanner</Link>
                <Link href="/slack">Slack</Link>
                <Link href="/auth/signout">Sign out</Link>
              </>
            )}
          </div>
        </nav>
        <main className="container">{children}</main>
      </body>
    </html>
  )
}
