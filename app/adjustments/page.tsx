import { requireUser } from '@/lib/require-user'
import { createManualAdjustment, createInventorySwitch } from '@/lib/actions'
import { updateInventoryMovement, archiveInventoryMovement, deleteInventoryMovement } from '@/lib/record-actions'
import { date, num } from '@/lib/format'

export default async function AdjustmentsPage({ searchParams }: { searchParams?: Promise<{ error?: string, notice?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const { supabase } = await requireUser()
  const { data: parts } = await supabase.from('parts').select('id, name, sku').order('name')
  const { data: movements } = await supabase.from('inventory_movements').select('*, parts(name, sku)').is('archived_at', null).order('created_at', { ascending: false }).limit(50)
  const { data: switches } = await supabase.from('inventory_switches').select('*, to_part:parts!inventory_switches_to_part_id_fkey(name, sku), from_part:parts!inventory_switches_from_part_id_fkey(name, sku)').order('created_at', { ascending: false }).limit(30)

  return (
    <>
      <h1>Manual Adjustments / Switches</h1>
      <p className="muted">Use this when inventory needs to be corrected, or when an order switches from one item/color to another.</p>
      {params.error && <div className="card danger-soft"><strong>Change failed:</strong> {params.error}</div>}
      {params.notice && <div className="card success-soft"><strong>{params.notice}</strong></div>}

      <div className="grid">
        <div className="card"><h2>Manual inventory adjustment</h2><form className="stack" action={createManualAdjustment}><label>Part<select name="part_id" required><option value="">Choose part</option>{(parts || []).map((p: any) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></label><label>Quantity change<input name="quantity_change" type="number" step="0.01" required placeholder="-5 or 12" /></label><label>Reason<input name="reason" placeholder="Count correction, missing, sample, etc." /></label><label>Notes<textarea name="notes" /></label><button type="submit">Save adjustment</button></form></div>
        <div className="card"><h2>Inventory switch</h2><form className="stack" action={createInventorySwitch}><label>Original part demanded, optional<select name="from_part_id"><option value="">Choose original part</option>{(parts || []).map((p: any) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></label><label>Actual part used<select name="to_part_id" required><option value="">Choose actual part used</option>{(parts || []).map((p: any) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></label><div className="form-row"><label>Quantity<input name="quantity" type="number" step="0.01" required /></label><label>Order reference<input name="order_reference" /></label></div><label>Change type<select name="change_type" required><option value="voluntary_customer_change">Voluntary customer change</option><option value="forced_due_to_stockout">Forced because we ran out</option></select></label><label>Notes<textarea name="notes" /></label><button type="submit">Save switch</button></form></div>
      </div>

      <div className="card"><h2>Recent switches</h2><table><thead><tr><th>Date</th><th>Original demand</th><th>Actual used</th><th>Qty</th><th>Type</th><th>Order</th><th>Notes</th></tr></thead><tbody>{(switches || []).map((s: any) => <tr key={s.id}><td>{date(s.created_at)}</td><td>{s.from_part?.sku} {s.from_part?.name}</td><td>{s.to_part?.sku} {s.to_part?.name}</td><td>{num(s.quantity)}</td><td>{s.change_type}</td><td>{s.order_reference}</td><td>{s.notes}</td></tr>)}{(switches || []).length === 0 && <tr><td colSpan={7}>No switches yet.</td></tr>}</tbody></table></div>

      <div className="card wide-table"><h2>Recent inventory movements</h2><table><thead><tr><th>Date</th><th>Part</th><th>Type</th><th>Qty</th><th>Reason</th><th>Notes</th><th>Actions</th></tr></thead><tbody>{(movements || []).map((m: any) => <tr key={m.id}><td>{date(m.movement_date || m.created_at)}</td><td>{m.parts?.sku} · {m.parts?.name}</td><td>{m.movement_type}</td><td>{num(m.quantity)}</td><td>{m.reason}</td><td>{m.notes}</td><td><details><summary className="button small-btn secondary">Edit</summary><form className="stack card flat" action={updateInventoryMovement}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="redirect_to" value="/adjustments" /><input type="hidden" name="movement_type" value={m.movement_type} /><div className="form-row"><label>Part<select name="part_id" defaultValue={m.part_id} required>{(parts || []).map((p:any)=><option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></label><label>Quantity<input name="quantity" type="number" step="0.01" defaultValue={m.quantity} required /></label><label>Date<input name="movement_date" type="date" defaultValue={(m.movement_date || m.created_at || '').slice(0,10)} /></label></div><label>Reason<input name="reason" defaultValue={m.reason || ''} /></label><label>Notes<textarea name="notes" defaultValue={m.notes || ''} /></label><button type="submit">Save edit</button></form><div className="action-row"><form action={archiveInventoryMovement}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="redirect_to" value="/adjustments" /><button className="small-btn ghost" type="submit">Archive</button></form><form action={deleteInventoryMovement}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="redirect_to" value="/adjustments" /><button className="small-btn danger" type="submit">Remove</button></form></div></details></td></tr>)}{(movements || []).length === 0 && <tr><td colSpan={7}>No movements yet.</td></tr>}</tbody></table></div>
    </>
  )
}
