import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { getPermissions, ROLE_LABELS } from '@/lib/permissions'
import { updateUserRole, setUserActive } from '@/lib/record-actions'
import { date } from '@/lib/format'

export const dynamic = 'force-dynamic'

const ROLE_NOTES: Record<string, string> = {
  admin: 'Everything, including managing these users.',
  manager: 'Everything except managing users.',
  production_associate: 'Receiving, damage reports and reporting zero stock. Can fix their own entries on the same day.',
}

export default async function UsersPage({ searchParams }: { searchParams?: Promise<{ error?: string, notice?: string }> }) {
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

      <p className="muted small">
        These rules are enforced by the database itself, not just by hiding buttons — so they hold even
        if someone bypasses the screen. <Link className="link" href="/dashboard">Back to dashboard</Link>
      </p>
    </>
  )
}
