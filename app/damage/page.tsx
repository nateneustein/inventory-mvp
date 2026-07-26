import { requireUser } from '@/lib/require-user'
import { reportDamage } from '@/lib/actions'
import { updateDamageReport, deleteDamageReport } from '@/lib/record-actions'
import { date, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

const REASONS = [
  ['supplier_damaged', 'Supplier damaged'],
  ['production_damaged', 'Production damaged'],
  ['wrong_cut', 'Wrong cut'],
  ['broken_in_shipping', 'Broken in shipping'],
  ['testing_sample', 'Testing / sample'],
  ['missing', 'Missing'],
  ['unknown', 'Unknown'],
]

export default async function DamagePage({ searchParams }: { searchParams?: Promise<{ error?: string, notice?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const { supabase } = await requireUser()
  const { data: parts } = await supabase.from('parts').select('id, name, sku').order('sort_order', { ascending: true, nullsFirst: false }).order('name')
  const { data: reports } = await supabase
    .from('damage_reports')
    .select('*, parts(name, sku)')
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <>
      <h1>Damage / Scrap</h1>
      <p className="muted">Fast form for supplier damage, production damage, wrong cuts, missing pieces, samples, and unknown shrinkage.</p>
      {params.error && <div className="card danger-soft"><strong>Damage report change failed:</strong> {params.error}</div>}
      {params.notice && <div className="card success-soft"><strong>{params.notice}</strong></div>}

      <div className="card">
        <h2>Report damaged inventory</h2>
        <form className="stack" action={reportDamage}>
          <div className="form-row">
            <label>Part
              <select name="part_id" required>
                <option value="">Choose part</option>
                {(parts || []).map((p: any) => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
              </select>
            </label>
            <label>Qty damaged / removed<input name="quantity" type="number" step="0.01" required /></label>
            <label>Reason
              <select name="reason" required>
                {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
          <label>Order reference, optional<input name="order_reference" placeholder="Etsy #12345, Amazon order, etc." /></label>
          <label>Notes<textarea name="notes" /></label>
          <button type="submit">Remove from inventory</button>
        </form>
      </div>

      <div className="card table-card">
        <div className="table-head">
          <div>
            <h2>Recent damage</h2>
            <p className="muted small">
              <strong>Stock removed</strong> means these units were in stock and have been taken out.
              <strong> Never in stock</strong> means the damage was found while receiving a shipment — those
              units were never counted in, so reporting them again here would remove stock you still have.
            </p>
          </div>
        </div>
        <div className="wide-table"><table>
          <thead><tr><th>Date</th><th>Part</th><th>Qty</th><th>Effect on stock</th><th>Reason</th><th>Order ref</th><th>Notes</th><th>Actions</th></tr></thead>
          <tbody>
            {(reports || []).map((r: any) => (
              <tr key={r.id}>
                <td>{date(r.created_at)}</td>
                <td>{r.parts?.sku} - {r.parts?.name}</td>
                <td>{num(r.quantity)}</td>
                <td>
                  {r.reduced_stock
                    ? <span className="badge urgent">stock removed</span>
                    : <span className="badge info">never in stock · found at receiving</span>}
                </td>
                <td>{r.reason}</td>
                <td>{r.order_reference}</td>
                <td>{r.notes}</td>
                <td>
                  <details>
                    <summary className="button small-btn secondary">Edit</summary>
                    <form className="stack card flat" action={updateDamageReport}>
                      <input type="hidden" name="id" value={r.id} />
                      <label>Qty damaged<input name="quantity" type="number" step="0.01" defaultValue={r.quantity} /></label>
                      <label>Reason
                        <select name="reason" defaultValue={r.reason}>
                          {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </label>
                      <label>Order reference<input name="order_reference" defaultValue={r.order_reference || ''} /></label>
                      <label>Notes<textarea name="notes" defaultValue={r.notes || ''} /></label>
                      <p className="muted small">
                        {r.reduced_stock
                          ? 'Changing the quantity will add a correction line so stock and this report stay in step.'
                          : 'This damage never came out of stock, so changing it will not move any inventory.'}
                      </p>
                      <button type="submit">Save</button>
                    </form>
                    <form action={deleteDamageReport}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="danger small-btn" type="submit">Delete report</button>
                    </form>
                  </details>
                </td>
              </tr>
            ))}
            {(reports || []).length === 0 && <tr><td colSpan={8}><div className="empty-state">No damage reports yet.</div></td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
