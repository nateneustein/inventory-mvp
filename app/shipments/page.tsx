import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { createPurchaseOrder, addPurchaseOrderItem, deletePurchaseOrder } from '@/lib/actions'
import { refreshAllShipmentTracking } from '@/lib/shipment-actions'
import { trackingEnabled } from '@/lib/tracking'
import { date, num, supplierHint } from '@/lib/format'
import { SearchSelect } from '@/components/search-select'
import { ActionButton } from '@/components/action-button'
import { TrackingAutoRefresh } from '@/components/tracking-auto-refresh'

/** Orders that can still move. Everything else is history and never re-checked. */
const FINISHED = ['received', 'closed', 'cancelled']

/** How old carrier information is allowed to get before the page re-checks it. */
const STALE_HOURS = 6

/** Enough to recognise the shipment; the rest are one click away. */
const ITEMS_ON_CARD = 6

function matchPo(po: any, q: string) {
  const hay = [po.po_number, po.supplier_name, po.supplier_contact, po.status, po.tracking_number, po.carrier_name, po.notes]
    .filter(Boolean).join(' ').toLowerCase()
  return hay.includes(q.toLowerCase())
}

function when(value: string | null) {
  if (!value) return ''
  const stamp = new Date(value)
  if (Number.isNaN(stamp.getTime())) return ''
  return stamp.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function hoursSince(value: string | null) {
  if (!value) return Infinity
  const stamp = new Date(value).getTime()
  if (Number.isNaN(stamp)) return Infinity
  return (Date.now() - stamp) / 3600000
}

/**
 * The one line that answers "where is it".
 *
 * Reads the carrier first, falls back to whatever a person last wrote down,
 * and says plainly when there is nothing at all - which is itself the most
 * useful thing to know about a shipment.
 */
function headline(po: any) {
  if (po.tracking_last_event) {
    return po.tracking_last_event + (po.tracking_last_location ? ' — ' + po.tracking_last_location : '')
  }
  if (po.last_update_status) {
    return po.last_update_status + (po.last_update_location ? ' — ' + po.last_update_location : '')
  }
  if (!po.tracking_number) return 'No tracking number on this shipment yet'
  if (po.tracking_error) return po.tracking_error
  return 'Nothing reported yet'
}

function riskOf(po: any) {
  if (po.is_overdue) return { label: 'overdue', tone: 'out' }
  if (po.days_until_expected != null && po.days_until_expected <= 7) return { label: 'arriving soon', tone: 'warning' }
  if (po.days_since_update != null && po.days_since_update >= 14) return { label: 'gone quiet', tone: 'warning' }
  if (po.days_since_update == null && po.tracking_number) return { label: 'nothing yet', tone: 'warning' }
  return { label: 'on track', tone: 'ok' }
}

export default async function ShipmentsPage({ searchParams }: { searchParams?: Promise<{ q?: string, status?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = params.q || ''
  const status = params.status || ''
  const { supabase } = await requireUser()

  const { data: suppliers } = await supabase.from('suppliers').select('id, name, contact_name, email, phone').order('name')
  const { data: parts } = await supabase.from('parts').select('id, name, sku').order('sort_order', { ascending: true, nullsFirst: false }).order('name')
  const { data: board } = await supabase.from('shipment_dashboard').select('*').order('expected_date', { ascending: true, nullsFirst: false })
  const { data: openItems } = await supabase.from('open_po_items').select('*').limit(100)
  const { data: overdue } = await supabase.from('overdue_open_po_items').select('*')

  const all = board || []
  const active = all.filter((po: any) => !FINISHED.includes(po.status))

  const pos = all.filter((po: any) =>
    (!q || matchPo(po, q)) &&
    (!status || (status === 'overdue' ? po.is_overdue : po.status === status)))

  const arrivingSoon = active.filter((po: any) => po.days_until_expected != null && po.days_until_expected >= 0 && po.days_until_expected <= 7)
  const overdueShipments = active.filter((po: any) => po.is_overdue)
  const untracked = active.filter((po: any) => !po.tracking_number)
  const quiet = active.filter((po: any) => po.days_since_update != null && po.days_since_update >= 14)

  // Anything on its way whose carrier information has aged out. The client
  // component below picks these up and refreshes them after the page paints.
  const stale = active.filter((po: any) => po.tracking_number && hoursSince(po.tracking_checked_at) > STALE_HOURS)
  const enabled = trackingEnabled()

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Shipments / Purchases</h1>
          <p className="muted">Where everything on its way to you actually is. Stock only increases after receiving confirms the quantity.</p>
          <TrackingAutoRefresh staleCount={stale.length} enabled={enabled} />
        </div>
        <div className="action-row">
          <Link className="button secondary" href="/receiving">Receiving screen</Link>
          <form className="inline-form" action={refreshAllShipmentTracking}>
            <ActionButton className="button" busyLabel="Checking…" doneLabel="Checked" disabled={!enabled}>Check all carriers now</ActionButton>
          </form>
        </div>
      </div>

      {!enabled && (
        <div className="card warning-soft">
          <strong>Carrier tracking is not switched on yet.</strong> Add a 17TRACK key as TRACK17_API_KEY in
          the Vercel project settings and redeploy. Everything else on this page works without it, including
          the updates you type in yourself.
        </div>
      )}

      <div className="grid">
        <div className="card kpi-card"><div className="muted">On the way</div><div className="kpi">{active.length}</div></div>
        <div className="card kpi-card"><div className="muted">Arriving within 7 days</div><div className="kpi">{arrivingSoon.length}</div></div>
        <div className="card kpi-card"><div className="muted">Overdue</div><div className="kpi">{overdueShipments.length}</div></div>
        <div className="card kpi-card"><div className="muted">No news in 2 weeks</div><div className="kpi">{quiet.length}</div></div>
      </div>

      {untracked.length > 0 && (
        <div className="card warning-soft">
          <strong>{untracked.length} shipment(s) have no tracking number.</strong> Nothing can be followed
          automatically until one is added, so those rely entirely on updates typed in by hand.
        </div>
      )}

      <div className="card table-card">
        <div className="table-head">
          <h2>On the way now</h2>
          <span className="badge info">{active.length} shipment(s)</span>
        </div>
        <div className="shipment-cards">
          {active.map((po: any) => {
            const risk = riskOf(po)
            return (
              <div key={po.id} className={'shipment-card ' + risk.tone}>
                <div className="shipment-card-head">
                  <Link className="link row-name" href={'/shipments/' + po.id}>{po.po_number}</Link>
                  <span className={'badge ' + risk.tone}>{risk.label}</span>
                </div>

                <p className="muted small">
                  {po.supplier_name}
                  {po.supplier_contact && <> · {po.supplier_contact}</>}
                  {po.supplier_phone && <> · {po.supplier_phone}</>}
                </p>

                <p className="shipment-headline">{headline(po)}</p>
                {(po.tracking_last_event_at || po.last_update_at) && (
                  <p className="muted small">{when(po.tracking_last_event_at || po.last_update_at)}
                    {po.days_since_update != null && <> · {num(po.days_since_update, 0)} day(s) ago</>}
                  </p>
                )}

                <dl className="detail-list compact-detail">
                  <div><dt>Status</dt><dd>{po.tracking_status || po.status}</dd></div>
                  <div><dt>Expected</dt><dd>{po.expected_date ? date(po.expected_date) : 'Not set'}
                    {po.days_until_expected != null && (
                      <span className="muted small"> · {po.days_until_expected < 0
                        ? num(Math.abs(po.days_until_expected), 0) + ' day(s) late'
                        : num(po.days_until_expected, 0) + ' day(s) away'}</span>
                    )}
                  </dd></div>
                  {po.tracking_eta && <div><dt>Carrier says</dt><dd>{date(po.tracking_eta)}</dd></div>}
                  <div><dt>Carrier</dt><dd>{po.carrier_name || (po.tracking_number ? 'Not identified yet' : 'No tracking number')}</dd></div>
                  <div><dt>Received</dt><dd>{num(po.qty_received)} of {num(po.qty_ordered)} · {num(po.qty_outstanding)} still to come</dd></div>
                </dl>

                {(po.items || []).length > 0 && (
                  <ul className="shipment-items">
                    {(po.items || []).slice(0, ITEMS_ON_CARD).map((item: any) => (
                      <li key={item.part_id}>
                        <span className="shipment-item-qty">{num(item.ordered)}</span>
                        <span className="shipment-item-name">{item.name || item.sku}</span>
                        {Number(item.received) > 0 && (
                          <span className="muted small">{num(item.received)} in</span>
                        )}
                      </li>
                    ))}
                    {(po.items || []).length > ITEMS_ON_CARD && (
                      <li className="muted small">and {(po.items || []).length - ITEMS_ON_CARD} more — open the shipment to see them all</li>
                    )}
                  </ul>
                )}

                <div className="action-row">
                  <Link className="button small-btn secondary" href={'/shipments/' + po.id}>Open</Link>
                </div>
              </div>
            )
          })}
          {active.length === 0 && <div className="empty-state">Nothing is on its way right now.</div>}
        </div>
      </div>

      <div className="card"><form className="filter-bar" action="/shipments"><label>Search<input name="q" defaultValue={q} placeholder="PO, supplier, contact, tracking, carrier, notes" /></label><label className="compact">Status<select name="status" defaultValue={status}><option value="">All</option><option value="overdue">Overdue</option><option value="ordered">Ordered</option><option value="in_production">In production</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option><option value="receiving_check">Receiving check</option><option value="partially_received">Partially received</option><option value="received">Received</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option></select></label><button type="submit">Filter</button><Link className="button ghost" href="/shipments">Clear</Link></form></div>

      <div className="grid two">
        <div className="card"><details className="add-panel"><summary className="button">+ Create shipment / PO</summary></details><form className="stack" action={createPurchaseOrder}><label>PO / shipment number<input name="po_number" required placeholder="PO-1001" /></label><label>Supplier<SearchSelect name="supplier_id" required placeholder="Type a supplier or contact name" options={(suppliers || []).map((s: any) => ({ value: s.id, label: s.name, hint: supplierHint(s) }))} /></label><div className="form-row"><label>Order date<input name="order_date" type="date" /></label><label>Expected arrival<input name="expected_date" type="date" /></label></div><label>Status<select name="status"><option value="ordered">Ordered</option><option value="in_production">In production</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option></select></label><label>Tracking number<input name="tracking_number" /></label><label>Notes<textarea name="notes" /></label><div className="action-row"><button type="submit">Create shipment</button><button type="button" className="button secondary cancel-btn">Cancel</button></div></form></div>
        <div className="card"><details className="add-panel"><summary className="button">+ Add item to shipment</summary></details><form className="stack" action={addPurchaseOrderItem}><label>Shipment / PO<SearchSelect name="purchase_order_id" required placeholder="Type a PO number or supplier" options={all.map((po: any) => ({ value: po.id, label: po.po_number, hint: po.supplier_name }))} /></label><label>Part<SearchSelect name="part_id" required placeholder="Type a part name or SKU" options={(parts || []).map((p: any) => ({ value: p.id, label: p.name, hint: p.sku }))} /></label><div className="form-row"><label>Qty ordered<input name="quantity_ordered" type="number" step="0.01" required /></label><label>Unit cost<input name="unit_cost" type="number" step="0.01" defaultValue="0" /></label></div><label>Notes<textarea name="notes" /></label><div className="action-row"><button type="submit">Add shipment item</button><button type="button" className="button secondary cancel-btn">Cancel</button></div></form></div>
      </div>

      <div className="card table-card"><div className="table-head"><h2>All shipments</h2><span className="badge info">{pos.length} shown</span></div><div className="wide-table"><table><thead><tr><th>PO</th><th>Supplier</th><th>Status</th><th>Carrier</th><th>Last heard</th><th>Order date</th><th>Expected</th><th>Tracking</th><th>Actions</th></tr></thead><tbody>{pos.map((po: any) => <tr key={po.id}><td className="name-cell"><Link className="link" href={'/shipments/' + po.id}>{po.po_number}</Link></td><td>{po.supplier_name}<span className="sku-under">{po.supplier_contact}</span></td><td><span className="badge info">{po.status}</span></td><td>{po.carrier_name}<span className="sku-under">{po.tracking_status}</span></td><td>{when(po.tracking_last_event_at || po.last_update_at)}</td><td>{date(po.order_date)}</td><td>{date(po.expected_date)}</td><td>{po.tracking_number}</td><td><div className="action-row"><Link className="button small-btn secondary" href={'/shipments/' + po.id}>Open</Link><form action={deletePurchaseOrder}><input type="hidden" name="id" value={po.id} /><button className="small-btn danger" type="submit">Delete</button></form></div></td></tr>)}{pos.length === 0 && <tr><td colSpan={9}><div className="empty-state">No shipments match this filter.</div></td></tr>}</tbody></table></div></div>

      <div className="card table-card"><div className="table-head"><h2>Open shipment items</h2><span className="badge info">{(overdue || []).length} overdue line(s)</span></div><div className="wide-table"><table><thead><tr><th>PO</th><th>Supplier</th><th>Part</th><th>Expected</th><th>Ordered</th><th>Received</th><th>Remaining</th><th>Tracking</th><th></th></tr></thead><tbody>{(openItems || []).map((r: any) => <tr key={r.purchase_order_item_id}><td><Link className="link" href={'/shipments/' + r.purchase_order_id}>{r.po_number}</Link></td><td>{r.supplier_name}</td><td className="name-cell"><Link className="link" href={'/parts/' + r.part_id}>{r.part_name}</Link><span className="sku-under">{r.part_sku}</span></td><td>{date(r.expected_date)}</td><td>{num(r.quantity_ordered)}</td><td>{num(r.quantity_received)}</td><td>{num(r.remaining_qty)}</td><td>{r.tracking_number}</td><td><Link className="button small-btn secondary" href={'/shipments/' + r.purchase_order_id}>Receive</Link></td></tr>)}{(openItems || []).length === 0 && <tr><td colSpan={9}><div className="empty-state">No open shipment items.</div></td></tr>}</tbody></table></div></div>
    </>
  )
}
