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
                <Link href="/parts">Parts</Link>
                <Link href="/suppliers">Suppliers</Link>
                <Link href="/products">Products</Link>
                <Link href="/boms">BOMs</Link>
                <Link href="/purchase-orders">POs</Link>
                <Link href="/receiving">Receiving</Link>
                <Link href="/damage">Damage</Link>
                <Link href="/replacements">Replacements</Link>
                <Link href="/counts">Counts</Link>
                <Link href="/reports">Reports</Link>
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
