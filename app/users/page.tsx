import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { getPermissions, ROLE_LABELS } from '@/lib/permissions'
import { updateUserRole, setUserActive } from '@/lib/record-actions'
import { ZONE, date } from '@/lib/format'

export const dynamic = 'force-dynamic'

const ROLE_NOTES: Record<string, string> = {
  admin: 'Everything, including managing these users.',
  manager: 'Everything except managing users.',
  production_associate: 'Receiving, damage reports and reporting zero stock. Can fix their own entries on the same day.',
}

/* Table names are how the database thinks; these are how a person thinks. */
const ENTITY_LABELS: Record<string, string> = {
  parts: 'Part',
  suppliers: 'Supplier',
  part_suppliers: 'Supplier on a part',
  part_links: 'Link on a part',
  part_custom_fields: 'Field on a part',
  purchase_orders: 'Shipment',
  purchase_order_items: 'Line on a shipment',
  purchase_order_suppliers: 'Supplier on a shipment',
  shipment_updates: 'Shipment update',
  receiving_events: 'Receiving',
  inventory_movements: 'Stock movement',
  inventory_switches: 'Inventory switch',
  cycle_counts: 'Stock count',
  damage_reports: 'Damage report',
  replacement_orders: 'Replacement order',
  zero_stock_reports: 'Zero / running low report',
  manual_units_sold: 'Manual usage entry',
  products: 'Product',
  product_variations: 'Variation',
  bom_items: 'BOM line',
  product_mapping_rules: 'Mapping rule',
  profiles: 'User',
  slack_notification_settings: 'Slack settings',
  part_reorder_horizon_history: 'Reorder window',
  part_order_months_history: 'Order months',
}

const ACTION_LABELS: Record<string, string> = { created: 'Added', changed: 'Edited', deleted: 'Deleted' }

function when(value: string) {
  const stamp = new Date(value)
  if (Number.isNaN(stamp.getTime())) return ''
  return stamp.toLocaleString('en-US', { timeZone: ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function short(value: any) {
  if (value === null || value === undefined || value === '') return 'empty'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  const text = String(value)
  return text.length > 44 ? text.slice(0, 44) + '…' : text
}

/* An edit is only useful if you can see what actually moved, so the field is
   named and the old value is kept beside the new one. Four is enough to read at
   a glance; a bulk save that touched twenty says so rather than filling the row. */
function changeDetail(row: any) {
  const fields = (row.changed_fields || []) as string[]
  if (row.action !== 'changed' || fields.length === 0) return <span className="muted small">—</span>
  const shown = fields.slice(0, 4)
  return (
    <span className="change-list">
      {shown.map((field) => (
        <span key={field} className="change-line">
          <strong>{field.replace(/_/g, ' ')}</strong>{' '}
          <span className="muted">{short(row.before?.[field])}</span>{' → '}
          {short(row.after?.[field])}
        </span>
      ))}
      {fields.length > shown.length && (
        <span className="muted small">and {fields.length - shown.length} more field(s)</span>
      )}
    </span>
  )
}

export default async function UsersPage({ searchParams }: { searchParams?: Promise<{ error?: string, notice?: string, who?: string, what?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const { supabase, user } = await requireUser()
  const perms = await getPermissions()

  if (!perms.canManageUsers) {
    return (
      <>
        <h1>Users and roles</h1>
        <div className="card danger-soft">
          <strong>Admins only.</strong> You are signed in as {perms.label}. Ask an admin if you need someone&apos;s role changed.
        </div>
      </>
    )
  }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, active, created_at')
    .order('created_at')

  /* Every change anyone made, newest first. Two hundred is about a fortnight of
     real use - enough to answer "what happened to this" without loading a year. */
  const who = params.who || ''
  const what = params.what || ''
  let historyQuery = supabase
    .from('activity_log')
    .select('id, happened_at, actor_id, action, entity, record_id, summary, changed_fields, before, after')
    .order('happened_at', { ascending: false })
    .limit(200)
  if (who) historyQuery = historyQuery.eq('actor_id', who)
  if (what) historyQuery = historyQuery.eq('entity', what)
  const { data: history } = await historyQuery

  const personFor = new Map((profiles || []).map((p: any) => [p.id, p.full_name || p.email]))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Users and roles</h1>
          <p className="muted">Who can do what. Changes take effect the next time that person loads a page.</p>
        </div>
      </div>
      {params.error && <div className="card danger-soft"><strong>Could not save:</strong> {params.error}</div>}
      {params.notice && <div className="card success-soft"><strong>{params.notice}</strong></div>}

      <div className="card alert">
        <strong>Adding someone new:</strong> create their login in Supabase under Authentication → Users
        (turn on &ldquo;Auto Confirm User&rdquo;). They appear here automatically as a Production Associate,
        and you set their role below. Account creation cannot be done from this app — it needs a secret
        key that must never be exposed in a browser.
      </div>

      <div className="card table-card">
        <div className="table-head"><h2>People</h2><span className="badge info">{(profiles || []).length} users</span></div>
        <div className="wide-table"><table>
          <thead><tr><th>Email</th><th>Name</th><th>Role</th><th>What that allows</th><th>Status</th><th>Added</th><th>Actions</th></tr></thead>
          <tbody>
            {(profiles || []).map((p: any) => {
              const isSelf = p.id === user.id
              return (
                <tr key={p.id}>
                  <td>{p.email}{isSelf && <span className="badge info" style={{ marginLeft: 8 }}>you</span>}</td>
                  <td>{p.full_name || '—'}</td>
                  {/* A role is an identity, not a stock status — the red/amber/green
                      badges made "Admin" read like an alert. Neutral chip, real word. */}
                  <td><span className={`badge ${p.role === 'admin' ? 'info' : ''}`}>{ROLE_LABELS[p.role] || p.role}</span></td>
                  <td className="muted small">{ROLE_NOTES[p.role]}</td>
                  <td>{p.active ? <span className="badge ok">active</span> : <span className="badge archived">disabled</span>}</td>
                  <td>{date(p.created_at)}</td>
                  <td>
                    {isSelf ? (
                      <span className="muted small">You cannot change your own role. Another admin must do it.</span>
                    ) : (
                      <details>
                        <summary className="button small-btn secondary">Change</summary>
                        <form className="stack card flat" action={updateUserRole}>
                          <input type="hidden" name="id" value={p.id} />
                          <label>Full name<input name="full_name" defaultValue={p.full_name || ''} placeholder="Optional" /></label>
                          <label>Role
                            <select name="role" defaultValue={p.role}>
                              <option value="production_associate">Production Associate</option>
                              <option value="manager">Manager</option>
                              <option value="admin">Admin</option>
                            </select>
                          </label>
                          <div className="action-row"><button type="submit">Save role</button><button type="button" className="button secondary cancel-btn">Cancel</button></div>
                        </form>
                        <form action={setUserActive}>
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="active" value={p.active ? 'false' : 'true'} />
                          <button className={p.active ? 'danger small-btn' : 'small-btn'} type="submit">
                            {p.active ? 'Disable access' : 'Re-enable access'}
                          </button>
                        </form>
                      </details>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table></div>
      </div>

      <div className="card table-card">
        <div className="table-head"><h2>What each role can do</h2></div>
        <div className="wide-table"><table>
          <thead><tr><th>Action</th><th>Admin</th><th>Manager</th><th>Production Associate</th></tr></thead>
          <tbody>
            {[
              ['Report zero / out of stock', 1, 1, 1],
              ['Receive shipments', 1, 1, 1],
              ['Report damage / scrap', 1, 1, 1],
              ['Manual units produced / sold', 1, 1, 0],
              ['Inventory switches', 1, 1, 0],
              ['Cycle / physical counts', 1, 1, 0],
              ['Edit own entries', 1, 1, 2],
              ['Edit anyone’s entries', 1, 1, 0],
              ['Delete anything that moved stock', 1, 1, 0],
              ['Parts, products, BOMs, suppliers', 1, 1, 0],
              ['Upload order CSVs, mapping rules', 1, 1, 0],
              ['View dashboard, usage, predictions', 1, 1, 1],
              ['Manage users and roles', 1, 0, 0],
            ].map((row: any) => (
              <tr key={row[0]}>
                <td>{row[0]}</td>
                {[1, 2, 3].map((i) => (
                  <td key={i}>{row[i] === 1 ? 'Yes' : row[i] === 2 ? 'Same day only' : '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      <div className="card table-card">
        <div className="table-head">
          <div>
            <h2>History — everything anyone changed</h2>
            <p className="muted small">
              Written by the database itself, so it catches every change however it was made — through a
              screen, a bulk action, or straight against the data. Newest 200 shown.
            </p>
          </div>
          <span className="badge info">{(history || []).length}</span>
        </div>
        <div className="table-tools">
          <form className="filter-bar" action="/users">
            <label className="compact">Who
              <select name="who" defaultValue={who}>
                <option value="">Anyone</option>
                {(profiles || []).map((p: any) => (
                  <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
                ))}
              </select>
            </label>
            <label className="compact">What
              <select name="what" defaultValue={what}>
                <option value="">Everything</option>
                {Object.keys(ENTITY_LABELS).map((key) => (
                  <option key={key} value={key}>{ENTITY_LABELS[key]}</option>
                ))}
              </select>
            </label>
            <button className="small-btn" type="submit">Filter</button>
            {(who || what) && <Link className="button small-btn secondary" href="/users">Clear</Link>}
          </form>
        </div>
        <div className="wide-table"><table>
          <thead><tr><th>When</th><th>Who</th><th>Did what</th><th>To what</th><th>What changed</th></tr></thead>
          <tbody>
            {(history || []).map((row: any) => (
              <tr key={row.id}>
                <td>{when(row.happened_at)}</td>
                <td>{personFor.get(row.actor_id) || <span className="muted">Automatic / import</span>}</td>
                <td>
                  <span className={'badge ' + (row.action === 'deleted' ? 'out' : row.action === 'created' ? 'ok' : 'info')}>
                    {ACTION_LABELS[row.action] || row.action}
                  </span>
                </td>
                <td className="name-cell">
                  {row.summary || <span className="muted">—</span>}
                  <span className="sku-under">{ENTITY_LABELS[row.entity] || row.entity}</span>
                </td>
                <td style={{ whiteSpace: 'normal' }}>{changeDetail(row)}</td>
              </tr>
            ))}
            {(history || []).length === 0 && (
              <tr><td colSpan={5}><div className="empty-state">Nothing recorded yet under this filter.</div></td></tr>
            )}
          </tbody>
        </table></div>
      </div>

      <p className="muted small">
        These rules are enforced by the database itself, not just by hiding buttons — so they hold even
        if someone bypasses the screen. <Link className="link" href="/dashboard">Back to dashboard</Link>
      </p>
    </>
  )
}
