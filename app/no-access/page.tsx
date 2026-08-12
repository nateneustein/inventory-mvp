import Link from 'next/link'
import { getPermissions } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const FRIENDLY: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/reports': 'Reports',
  '/usage': 'Usage and history',
  '/predictions': 'Prediction',
  '/predictions/basic': 'Basic prediction',
  '/predictions/advanced': 'Advanced prediction',
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

  /* This list used to be hard-coded, so it went on offering the dashboard,
     damage and usage to people who cannot open any of them - a locked door
     with a welcome mat. It is now built from the same permissions the pages
     themselves check, so it can only ever offer doors that open. */
  const doors: Array<[string, string]> = []
  if (perms.canViewDashboard) doors.push(['Dashboard', '/dashboard'])
  doors.push(['Parts / Supplies', '/parts'])
  doors.push(['Report zero / running low', '/zero'])
  doors.push(['Receiving', '/receiving'])
  if (perms.canViewShipments) doors.push(['Shipments / Purchases', '/shipments'])
  doors.push(['Reorder list', '/reorder'])
  if (perms.canViewReports) doors.push(['Reports', '/reports'])
  if (perms.canViewUsageHistory) doors.push(['Usage & History', '/usage'])

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
        <h2>Where you can go instead</h2>
        <div className="action-row">
          {doors.map(([label, href], i) => (
            <Link key={href} className={i === 0 ? 'button' : 'button secondary'} href={href}>{label}</Link>
          ))}
        </div>
      </div>
    </>
  )
}
