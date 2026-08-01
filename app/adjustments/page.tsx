import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { createManualAdjustment, createInventorySwitch } from '@/lib/actions'
import { updateInventoryMovement, archiveInventoryMovement, deleteInventoryMovement } from '@/lib/record-actions'
import { date, num } from '@/lib/format'
import { ActionButton } from '@/components/action-button'
import { SearchSelect } from '@/components/search-select'
import { rowMatches } from '@/lib/search'

export default async function AdjustmentsPage({ searchParams }: { searchParams?: Promise<{ error?: string, notice?: string, q?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = params.q || ''
  const { supabase } = await requireUser()
  const { data: parts } = await supabase.from('parts').select('id, name, sku').order('sort_order', { ascending: true, nullsFirst: false }).order('name')
  const { data: movements } = await supabase.from('inventory_movements').select('*, parts(name, sku)').is('archived_at', null).order('created_at', { ascending: false }).limit(50)
  const { data: switches } = await supabase.from('inventory_switches').select('*, to_part:parts!inventory_switches_to_part_id_fkey(name, sku), from_part:parts!inventory_switches_from_part_id_fkey(name, sku)').order('created_at', { ascending: false }).limit(30)

  const shownMovements = (movements || []).filter((m: any) =>
    rowMatches(q, m.parts?.sku, m.parts?.name, m.movement_type, m.reason, m.notes))
  const shownSwitches = (switches || []).filter((s: any) =>
    rowMatches(q, s.from_part?.sku, s.from_part?.name, s.to_part?.sku, s.to_part?.name, s.change_type, s.order_reference, s.notes))

  return (
    <>
      <h1>Manual Adjustments / Switches</h1>
      <p className="muted">Use this when inventory needs to be corrected, or when an order switches from one item/color to another.</p>
      {params.error && <div className="card danger-soft"><strong>Change failed:</strong> {params.error}</div>}
      {params.notice && <div className="card success-soft"><strong>{params.notice}</strong></div>}

      <div className="card">
        <form className="filter-bar" action="/adjustments">
          <label>Search movements and switches<input name="q" defaultValue={q} placeholder="Part, SKU, type, reason, order or notes" /></label>
          <button type="submit">Search</button>
          <Link className="button ghost" href="/adjustments">Clear</Link>
        </form>
      </div>

      <div className="grid">
        <div className="card"><h2>Manual inventory adjustment</h2><form className="stack" action={createManualAdjustment}><label>Part<SearchSelect name="part_id" required placeholder="Type a part name or SKU" options={(parts || []).map((p: any) => ({ value: p.id, label: p.name, hint: p.sku }))} /></label><label>Quantity change<input name="quantity_change" type="number" step="0.01" required placeholder="-5 or 12" /></label><label>Reason<input name="reason" placeholder="Count correction, missing, sample, etc." /></label><label>Notes<textarea name="notes" /></label><ActionButton confirm="Confirm this stock adjustment?" busyLabel="Saving…" doneLabel="Adjusted">Save adjustment</ActionButton></form></div>
        <div className="card"><h2>Inventory switch</h2><form className="stack" action={createInventorySwitch}><label>Original part demanded, optional<SearchSelect name="from_part_id" placeholder="Type the original part" options={(parts || []).map((p: any) => ({ value: p.id, label: p.name, hint: p.sku }))} /></label><label>Actual part used<SearchSelect name="to_part_id" required placeholder="Type the part actually used" options={(parts || []).map((p: any) => ({ value: p.id, label: p.name, hint: p.sku }))} /></label><div className="form-row"><label>Quantity<input name="quantity" type="number" step="0.01" required /></label><label>Order reference<input name="order_reference" /></label></div><label>Change type<select name="change_type" required><option value="voluntary_customer_change">Voluntary customer change</option><option value="forced_due_to_stockout">Forced because we ran out</option></select></label><label>Notes<textarea name="notes" /></label><ActionButton confirm="Confirm this inventory switch?" busyLabel="Saving…" doneLabel="Saved">Save switch</ActionButton></form></div>
      </div>

      <div className="card table-card"><div className="table-head"><h2>Recent switches</h2><span className="badge info">{shownSwitches.length} shown</span></div><table><thead><tr><th>Date</th><th>Original demand</th><th>Actual used</th><th>Qty</th><th>Type</th><th>Order</th><th>Notes</th></tr></thead><tbody>{shownSwitches.map((s: any) => <tr key={s.id}><td>{date(s.created_at)}</td><td>{s.from_part?.sku} {s.from_part?.name}</td><td>{s.to_part?.sku} {s.to_part?.name}</td><td>{num(s.quantity)}</td><td>{s.change_type}</td><td>{s.order_reference}</td><td>{s.notes}</td></tr>)}{shownSwitches.length === 0 && <tr><td colSpan={7}><div className="empty-state">{q ? 'No switches match that search.' : 'No switches yet.'}</div></td></tr>}</tbody></table></div>

      <div className="card table-card"><div className="table-head"><h2>Recent inventory movements</h2><span className="badge info">{shownMovements.length} shown</span></div><div className="wide-table"><table><thead><tr><th>Date</th><th>Part</th><th>Type</th><th>Qty</th><th>Reason</th><th>Notes</th><th>Actions</th></tr></thead><tbody>{shownMovements.map((m: any) => <tr key={m.id}><td>{date(m.movement_date || m.created_at)}</td><td className="name-cell">{m.parts?.name}<span className="sku-under">{m.parts?.sku}</span></td><td>{m.movement_type}</td><td>{num(m.quantity)}</td><td>{m.reason}</td><td>{m.notes}</td><td><details><summary className="button small-btn secondary">Edit</summary><form className="stack card flat" action={updateInventoryMovement}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="redirect_to" value="/adjustments" /><input type="hidden" name="movement_type" value={m.movement_type} /><div className="form-row"><label>Part<SearchSelect name="part_id" defaultValue={m.part_id} required placeholder="Type a part name or SKU" options={(parts || []).map((p: any) => ({ value: p.id, label: p.name, hint: p.sku }))} /></label><label>Quantity<input name="quantity" type="number" step="0.01" defaultValue={m.quantity} required /></label><label>Date<input name="movement_date" type="date" defaultValue={(m.movement_date || m.created_at || '').slice(0,10)} /></label></div><label>Reason<input name="reason" defaultValue={m.reason || ''} /></label><label>Notes<textarea name="notes" defaultValue={m.notes || ''} /></label><div className="action-row"><ActionButton busyLabel="Saving…" doneLabel="Saved">Save edit</ActionButton><button type="button" className="button secondary cancel-btn">Cancel</button></div></form><div className="action-row"><form action={archiveInventoryMovement}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="redirect_to" value="/adjustments" /><div className="action-row"><ActionButton className="small-btn ghost" confirm="Archive this movement?" busyLabel="…" doneLabel="Archived">Archive</ActionButton></div></form><form action={deleteInventoryMovement}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="redirect_to" value="/adjustments" /><div className="action-row"><ActionButton className="small-btn danger" confirm="Permanently remove this movement?" busyLabel="…" doneLabel="Removed">Remove</ActionButton></div></form></div></details></td></tr>)}{shownMovements.length === 0 && <tr><td colSpan={7}><div className="empty-state">{q ? 'No movements match that search.' : 'No movements yet.'}</div></td></tr>}</tbody></table></div></div>
    </>
  )
}
