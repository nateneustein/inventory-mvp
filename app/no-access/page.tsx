import Link from 'next/link'
import { getPermissions } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const FRIENDLY: Record<string, string> = {
  '/counts': 'Physical counts',
  '/adjustments': 'Adjustments and switches',
  '/uploads': 'Uploads and connections',
  '/imported-orders': 'Imported orders',
  '/mapping-rules': 'Mapping rules',
  '/boms': 'BOM / master file',
  '/products': 'Finished products',
  '/suppliers': 'Suppliers',
  '/shipments': 'Shipments and purchases',
  '/purchase-orders': 'Purchase orders',
  '/slack': 'Slack alerts',
  '/users': 'Users and roles',
}

export default async function NoAccessPage({ searchParams }: { searchParams?: Promise<{ from?: string, role?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const perms = await getPermissions()
  const from = params.from || ''
  const pageName = FRIENDLY[from] || (from ? from : 'That page')

  return (
    <>
      <div className="page-head"><div><h1>Not available for your role</h1></div></div>
      <div className="card danger-soft">
        <h2>{pageName}</h2>
        <p className="muted">
          You are signed in as <strong>{perms.label}</strong>, which does not have access to this screen.
          If you need it, ask a manager or an admin to either do it for you or change your role.
        </p>
      </div>

      <div className="card">
        <h2>What you can do</h2>
        <div className="action-row">
          <Link className="button" href="/dashboard">Dashboard</Link>
          <Link className="button secondary" href="/receiving">Receiving</Link>
          <Link className="button secondary" href="/damage">Damage / scrap</Link>
          <Link className="button secondary" href="/zero">Report zero</Link>
          <Link className="button ghost" href="/parts">View parts</Link>
          <Link className="button ghost" href="/usage">Usage</Link>
        </div>
      </div>
    </>
  )
}
