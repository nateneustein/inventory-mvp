import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { createManualAdjustment, createInventorySwitch } from '@/lib/actions'
import { updateInventoryMovement, archiveInventoryMovement, deleteInventoryMovement } from '@/lib/record-actions'
import { date, num, today } from '@/lib/format'
import { ActionButton } from '@/components/action-button'
import { SearchSelect } from '@/components/search-select'
import { rowMatches } from '@/lib/search'

/** Defaults to today, but the box exists so a movement can be back-dated into
 *  the week it really happened - the weekly sheets are read as history. */

export default async function AdjustmentsPage({ searchParams }: { searchParams?: Promise<{ error?: string, notice?: string, q?: string, all?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = params.q || ''
  /* The list normally shows the newest 50 because that is what anyone needs on a
     normal day, and pulling the whole ledger on every visit would be slow. But
     the older ones still exist and sometimes have to be looked at - and the
     search box can only find what was actually fetched - so there is a button
     that re-loads the page with the whole history instead of a slice. */
  const showAll = params.all === '1'
  const MOVEMENT_PAGE = 50
  const { supabase } = await requireUser()
  const { data: parts } = await supabase.from('parts').select('id, name, sku').order('sort_order', { ascending: true, nullsFirst: false }).order('name')
  const { data: movements } = await supabase.from('inventory_movements').select('*, parts(name, sku)').is('archived_at', null).order('created_at', { ascending: false }).limit(showAll ? 20000 : MOVEMENT_PAGE)
  const { data: switches } = await supabase.from('inventory_switches').select('*, to_part:parts!inventory_switches_to_part_id_fkey(name, sku), from_part:parts!inventory_switches_from_part_id_fkey(name, sku)').order('created_at', { ascending: false }).limit(30)

  /* How many there are in total, so the button can say what it will show and
     the page can stay quiet when there is nothing more to see. */
  const { count: movementTotal } = await supabase.from('inventory_movements').select('id', { count: 'exact', head: true }).is('archived_at', null)
  const totalMovements = movementTotal ?? (movements || []).length
  const moreToShow = !showAll && totalMovements > (movements || []).length

  const shownMovements = (movements || []).filter((m: any) =>
    rowMatches(q, m.parts?.sku, m.parts?.name, m.movement_type, m.reason, m.notes))
  /* Every row carries a full edit form with a searchable part picker, and each
     of those is a live React component. Fifty of them is fine; seven thousand
     would lock the browser up. So the whole history is readable, but only the
     first fifty rows on screen are editable - narrow the list with the search
     box and whatever you are looking for becomes editable again. */
  const EDITABLE_ROWS = 50

  const shownSwitches = (switches || []).filter((s: any) =>
    rowMatches(q, s.from_part?.sku, s.from_part?.name, s.to_part?.sku, s.to_part?.name, s.change_type, s.order_reference, s.notes))

  const editable = new Set<string>(shownMovements.slice(0, EDITABLE_ROWS).map((m: any) => m.id as string))

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
        <div className="card"><h2>Manual inventory adjustment</h2><form className="stack" action={createManualAdjustment}><label>Part<SearchSelect name="part_id" required placeholder="Type a part name or SKU" options={(parts || []).map((p: any) => ({ value: p.id, label: p.name, hint: p.sku }))} /></label><div className="form-row"><label>Quantity change<input name="quantity_change" type="number" step="0.01" required placeholder="-5 or 12" /></label><label>Date it happened<input name="movement_date" type="date" defaultValue={today()} /></label></div><label>Reason<input name="reason" placeholder="Count correction, missing, sample, etc." /></label><label>Notes<textarea name="notes" /></label><ActionButton confirm="Confirm this stock adjustment?" busyLabel="Saving…" doneLabel="Adjusted">Save adjustment</ActionButton></form></div>
        <div className="card"><h2>Inventory switch</h2><form className="stack" action={createInventorySwitch}><label>Original part demanded, optional<SearchSelect name="from_part_id" placeholder="Type the original part" options={(parts || []).map((p: any) => ({ value: p.id, label: p.name, hint: p.sku }))} /></label><label>Actual part used<SearchSelect name="to_part_id" required placeholder="Type the part actually used" options={(parts || []).map((p: any) => ({ value: p.id, label: p.name, hint: p.sku }))} /></label><div className="form-row"><label>Quantity<input name="quantity" type="number" step="0.01" required /></label><label>Order reference<input name="order_reference" /></label><label>Date it happened<input name="movement_date" type="date" defaultValue={today()} /></label></div><label>Change type<select name="change_type" required><option value="voluntary_customer_change">Voluntary customer change</option><option value="forced_due_to_stockout">Forced because we ran out</option></select></label><label>Notes<textarea name="notes" /></label><ActionButton confirm="Confirm this inventory switch?" busyLabel="Saving…" doneLabel="Saved">Save switch</ActionButton></form></div>
      </div>

      <div className="card table-card"><div className="table-head"><h2>Recent switches</h2><span className="badge info">{shownSwitches.length} shown</span></div><table><thead><tr><th>Date</th><th>Original demand</th><th>Actual used</th><th>Qty</th><th>Type</th><th>Order</th><th>Notes</th></tr></thead><tbody>{shownSwitches.map((s: any) => <tr key={s.id}><td>{date(s.created_at)}</td><td>{s.from_part?.sku} {s.from_part?.name}</td><td>{s.to_part?.sku} {s.to_part?.name}</td><td>{num(s.quantity)}</td><td>{s.change_type}</td><td>{s.order_reference}</td><td>{s.notes}</td></tr>)}{shownSwitches.length === 0 && <tr><td colSpan={7}><div className="empty-state">{q ? 'No switches match that search.' : 'No switches yet.'}</div></td></tr>}</tbody></table></div>

      <div className="card table-card"><div className="table-head"><div><h2>{showAll ? 'All inventory movements' : 'Recent inventory movements'}</h2><p className="muted small">{showAll ? 'The whole history - ' + num(totalMovements) + ' movements. The newest ' + EDITABLE_ROWS + ' on screen keep their Edit button; search to bring an older one into that top ' + EDITABLE_ROWS + '.' : 'Showing the newest ' + num(Math.min(MOVEMENT_PAGE, totalMovements)) + ' of ' + num(totalMovements) + '. The search box only looks at what is loaded, so open the full history to search all of it.'}</p></div><div className="action-row">{moreToShow && <Link className="button secondary small-btn" href={q ? '/adjustments?all=1&q=' + encodeURIComponent(q) : '/adjustments?all=1'}>Show all {num(totalMovements)} movements</Link>}{showAll && <Link className="button secondary small-btn" href={q ? '/adjustments?q=' + encodeURIComponent(q) : '/adjustments'}>Show recent only</Link>}<span className="badge info">{shownMovements.length} shown</span></div></div><div className="wide-table"><table><thead><tr><th>Date</th><th>Part</th><th>Type</th><th>Qty</th><th>Reason</th><th>Notes</th><th>Actions</th></tr></thead><tbody>{shownMovements.map((m: any) => <tr key={m.id}><td>{date(m.movement_date || m.created_at)}</td><td className="name-cell">{m.parts?.name}<span className="sku-under">{m.parts?.sku}</span></td><td>{m.movement_type}</td><td>{num(m.quantity)}</td><td>{m.reason}</td><td>{m.notes}</td><td>{!editable.has(m.id) ? <span className="muted small">search to edit</span> : <details><summary className="button small-btn secondary">Edit</summary><form className="stack card flat" action={updateInventoryMovement}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="redirect_to" value="/adjustments" /><input type="hidden" name="movement_type" value={m.movement_type} /><div className="form-row"><label>Part<SearchSelect name="part_id" defaultValue={m.part_id} required placeholder="Type a part name or SKU" options={(parts || []).map((p: any) => ({ value: p.id, label: p.name, hint: p.sku }))} /></label><label>Quantity<input name="quantity" type="number" step="0.01" defaultValue={m.quantity} required /></label><label>Date<input name="movement_date" type="date" defaultValue={(m.movement_date || m.created_at || '').slice(0,10)} /></label></div><label>Reason<input name="reason" defaultValue={m.reason || ''} /></label><label>Notes<textarea name="notes" defaultValue={m.notes || ''} /></label><div className="action-row"><ActionButton busyLabel="Saving…" doneLabel="Saved">Save edit</ActionButton><button type="button" className="button secondary cancel-btn">Cancel</button></div></form><div className="action-row"><form action={archiveInventoryMovement}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="redirect_to" value="/adjustments" /><div className="action-row"><ActionButton className="small-btn ghost" confirm="Archive this movement?" busyLabel="…" doneLabel="Archived">Archive</ActionButton></div></form><form action={deleteInventoryMovement}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="redirect_to" value="/adjustments" /><div className="action-row"><ActionButton className="small-btn danger" confirm="Permanently remove this movement?" busyLabel="…" doneLabel="Removed">Remove</ActionButton></div></form></div></details>}</td></tr>)}{shownMovements.length === 0 && <tr><td colSpan={7}><div className="empty-state">{q ? 'No movements match that search.' : 'No movements yet.'}</div></td></tr>}</tbody></table></div></div>
    </>
  )
}
