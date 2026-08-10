import { randomUUID } from 'crypto'
import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { receivePurchaseOrderItem } from '@/lib/actions'
import { receiveShipmentLines, undoReceivingEvent, editReceivingEvent, resolveMissingReceipt } from '@/lib/shipment-actions'
import { date, num, supplierHint, today } from '@/lib/format'
import { SearchSelect } from '@/components/search-select'
import { ActionButton } from '@/components/action-button'
import { rowMatches } from '@/lib/search'

/** Defaults to today, so a delivery checked in on Monday can still be booked
 *  into the week it actually landed. */

const FINISHED = ['received', 'closed', 'cancelled']

export default async function ReceivingPage({ searchParams }: { searchParams?: Promise<{ q?: string, po?: string, error?: string, notice?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = params.q || ''
  const poId = params.po || ''
  const { supabase } = await requireUser()

  // Every shipment that could still have something to receive. Oldest expected
  // arrival first, because that is the one most likely sitting on the dock.
  const { data: board } = await supabase
    .from('shipment_dashboard')
    .select('*')
    .order('expected_date', { ascending: true, nullsFirst: false })

  const shipments = (board || []).filter((po: any) => !FINISHED.includes(po.status))

  // Shipments the team should be walking to the shelf for: the carrier says it
  // landed, or its expected day has arrived, and parts are still unaccounted
  // for. This is the whole reason the page exists, so it goes at the top.
  const waiting = shipments.filter((po: any) => po.needs_receiving)
  const chosen = (board || []).find((po: any) => po.id === poId) || null

  const { data: lineRows } = poId
    ? await supabase
        .from('purchase_order_items')
        .select('*, parts(name, sku)')
        .eq('purchase_order_id', poId)
        .order('created_at')
    : { data: [] as any[] }

  const lines = (lineRows || []).map((line: any) => ({
    ...line,
    outstanding: Math.max(Number(line.quantity_ordered || 0) - Number(line.quantity_accounted || 0), 0),
  }))
  const openLines = lines.filter((line: any) => line.outstanding > 0)

  // No .limit() on the fallback picker: the Data API caps the response anyway,
  // and an arbitrary 200 meant that past 200 open lines the warehouse simply
  // could not select the item it was holding.
  const { data: openItems } = await supabase
    .from('open_po_items')
    .select('*')
    .order('expected_date', { ascending: true, nullsFirst: false })

  // One-shot token. Every line receipt derives its own key from this, so a
  // double-click or a browser-back resubmit replays the original receipt
  // instead of adding the delivery to stock a second time.
  const idempotencyKey = randomUUID()

  const { data: events } = await supabase
    .from('receiving_events')
    .select('*, parts(name, sku), purchase_orders(po_number, id)')
    .order('created_at', { ascending: false })
    .limit(50)

  const { data: missing } = await supabase.from('open_missing_followups').select('*').order('created_at', { ascending: true })

  const shown = (events || []).filter((e: any) =>
    rowMatches(q, e.purchase_orders?.po_number, e.parts?.sku, e.parts?.name, e.notes))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Receiving Check</h1>
          <p className="muted">Delivered shipments become real inventory only after the quantity is confirmed here.</p>
        </div>
        <Link className="button secondary" href="/shipments">Shipments</Link>
      </div>

      {params.error && <div className="card danger-soft"><strong>Nothing was received:</strong> {params.error}</div>}
      {params.notice && <div className="card success-soft"><strong>{params.notice}</strong></div>}

      {missing && missing.length > 0 && (
        <div className="card table-card">
          <div className="table-head">
            <h2>Missing units to follow up</h2>
            <span className="badge out">{missing.length}</span>
          </div>
          <p className="muted small">Units marked missing when a shipment was checked in. They were <strong>not</strong> added to stock and are still <strong>outstanding</strong> on the order. When they turn up, hit <strong>Receive it</strong> to open the receiving form and enter what actually arrived (received / damaged / still missing). If they will never come, mark <strong>Won’t arrive</strong> to close the line.</p>
          <table>
            <thead><tr><th>Since</th><th>PO</th><th>Supplier</th><th>Part</th><th>Missing</th><th></th></tr></thead>
            <tbody>{missing.map((m: any) => (
              <tr key={m.receiving_event_id}>
                <td>{date(m.created_at)}</td>
                <td>{m.po_number}</td>
                <td>{m.supplier_name || '—'}</td>
                <td>{m.part_sku} · {m.part_name}</td>
                <td>{num(m.quantity_missing)}</td>
                <td className="ap-missing-actions">
                  <Link className="button small-btn" href={'/receiving?po=' + m.purchase_order_id}>Receive it</Link>
                  <form action={resolveMissingReceipt}>
                    <input type="hidden" name="receiving_event_id" value={m.receiving_event_id} />
                    <input type="hidden" name="resolution" value="wont_arrive" />
                    <ActionButton busyLabel="Dismissing…" doneLabel="Dismissed">Won’t arrive</ActionButton>
                  </form>
                </td>
              </tr>))}</tbody>
          </table>
        </div>
      )}

      {waiting.length > 0 && (
        <div className="card table-card">
          <div className="table-head">
            <h2>Waiting to be checked in</h2>
            <span className="badge out">{waiting.length}</span>
          </div>
          <p className="muted small">
            The carrier says these arrived, or their expected day has come, and parts on them are
            still unaccounted for.
          </p>
          <div className="shipment-cards">
            {waiting.map((po: any) => (
              <div key={po.id} className={'shipment-card ' + (po.is_overdue ? 'out' : 'warning')}>
                <div className="shipment-card-head">
                  <Link className="link row-name" href={'/receiving?po=' + po.id}>{po.po_number}</Link>
                  <span className={'badge ' + (po.is_overdue ? 'out' : 'warning')}>
                    {po.is_overdue ? 'overdue' : 'arrived'}
                  </span>
                </div>

                <p className="muted small">
                  {(po.supplier_names || []).length > 1
                    ? (po.supplier_names || []).join(' + ')
                    : po.supplier_name}
                  {po.supplier_contact && <> · {po.supplier_contact}</>}
                </p>

                <p className="shipment-headline">
                  {po.tracking_last_event
                    || po.last_update_status
                    || (po.expected_date ? 'Expected ' + date(po.expected_date) : 'Expected date has passed')}
                </p>

                <dl className="detail-list compact-detail">
                  <div><dt>Carrier says</dt><dd>{po.tracking_status || 'Nothing reported'}</dd></div>
                  <div><dt>Expected</dt><dd>{po.expected_date ? date(po.expected_date) : 'Not set'}
                    {po.days_until_expected != null && po.days_until_expected < 0 && (
                      <span className="muted small"> · {num(Math.abs(po.days_until_expected), 0)} day(s) ago</span>
                    )}
                  </dd></div>
                  <div><dt>Still to check in</dt><dd>{num(po.qty_outstanding)} of {num(po.qty_ordered)}</dd></div>
                </dl>

                {(po.items || []).length > 0 && (
                  <ul className="shipment-items">
                    {(po.items || []).slice(0, 6).map((item: any) => (
                      <li key={item.part_id}>
                        <span className="shipment-item-qty">{num(item.ordered)}</span>
                        <span className="shipment-item-name">{item.name || item.sku}</span>
                      </li>
                    ))}
                    {(po.items || []).length > 6 && (
                      <li className="muted small">and {(po.items || []).length - 6} more</li>
                    )}
                  </ul>
                )}

                <div className="action-row">
                  <Link className="button small-btn" href={'/receiving?po=' + po.id}>Check this one in</Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2>Which shipment arrived?</h2>
        <form className="filter-bar" action="/receiving">
          <label>Shipment
            <SearchSelect
              name="po"
              defaultValue={poId}
              required
              placeholder="Type a shipment, supplier or contact name"
              options={shipments.map((po: any) => ({
                value: po.id,
                label: po.po_number,
                hint: [po.supplier_name, po.supplier_contact, po.expected_date ? 'expected ' + date(po.expected_date) : null].filter(Boolean).join(' · '),
              }))}
            />
          </label>
          <button type="submit">Show its parts</button>
          {poId && <Link className="button ghost" href="/receiving">Clear</Link>}
        </form>
      </div>

      {chosen && (
        <div className="card table-card">
          <div className="table-head">
            <div>
              <h2>{chosen.po_number}</h2>
              <p className="muted small">
                {chosen.supplier_name}
                {chosen.supplier_contact && <> · {chosen.supplier_contact}</>}
                {chosen.expected_date && <> · expected {date(chosen.expected_date)}</>}
              </p>
            </div>
            <Link className="button small-btn secondary" href={'/shipments/' + chosen.id}>Open shipment</Link>
          </div>

          {openLines.length === 0 ? (
            <div className="empty-state">Every part on this shipment has already been accounted for.</div>
          ) : (
            <form action={receiveShipmentLines}>
              <input type="hidden" name="purchase_order_id" value={chosen.id} />
              <input type="hidden" name="idempotency_key" value={idempotencyKey} />

              <p className="muted small">
                Fill in only the parts that turned up. Anything left at zero is treated as still
                outstanding. Damaged units are never added to stock - they are recorded against the
                supplier and close out the ordered quantity.
              </p>

              <div className="wide-table"><table>
                <thead><tr>
                  <th>Part</th><th>Ordered</th><th>Already in</th><th>Still to come</th>
                  <th>Good now</th><th>Damaged</th><th>Missing / short</th>
                </tr></thead>
                <tbody>
                  {openLines.map((line: any) => (
                    <tr key={line.id}>
                      <td className="name-cell">
                        <input type="hidden" name="item_id" value={line.id} />
                        <Link className="link" href={'/parts/' + line.part_id}>{line.parts?.name}</Link>
                        <span className="sku-under">{line.parts?.sku}</span>
                      </td>
                      <td>{num(line.quantity_ordered)}</td>
                      <td>{num(line.quantity_received)}</td>
                      <td><strong>{num(line.outstanding)}</strong></td>
                      <td><input className="tiny-input" name="quantity_received" type="number" step="0.01" min="0" max={line.outstanding} defaultValue="0" /></td>
                      <td><input className="tiny-input" name="quantity_damaged" type="number" step="0.01" min="0" max={line.outstanding} defaultValue="0" /></td>
                      <td><input className="tiny-input" name="quantity_missing" type="number" step="0.01" min="0" max={line.outstanding} defaultValue="0" /></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>

              <div className="form-row"><label>Date it arrived<input name="movement_date" type="date" defaultValue={today()} /></label></div><label>Notes for this delivery<textarea name="notes" placeholder="Box 3 had 5 broken sheets. Supplier shipped 492 instead of 500." /></label>
              <div className="action-row">
                <ActionButton confirm={'Add this delivery of ' + chosen.po_number + ' to stock?'} busyLabel="Receiving…" doneLabel="Received">Confirm receiving</ActionButton>
              </div>
            </form>
          )}
        </div>
      )}

      {!chosen && (
        <div className="card"><div className="empty-state">Pick a shipment above and its parts come up here with what is still outstanding.</div></div>
      )}

      <div className="card">
        <details className="mini-add">
          <summary className="button small-btn secondary">+ Receive a single line instead</summary>
          <form className="stack card flat" action={receivePurchaseOrderItem}>
            <input type="hidden" name="idempotency_key" value={idempotencyKey + ':single'} />
            <label>Open PO item
              <SearchSelect
                name="purchase_order_item_id"
                required
                placeholder="Type a PO number, supplier or part"
                options={(openItems || []).map((i: any) => ({
                  value: i.purchase_order_item_id,
                  label: i.part_name,
                  hint: [i.po_number, i.supplier_name, i.part_sku, 'remaining ' + num(i.remaining_qty)].filter(Boolean).join(' · '),
                }))}
              />
            </label>
            <div className="form-row">
              <label>Qty received usable<input name="quantity_received" type="number" step="0.01" defaultValue="0" /></label>
              <label>Qty damaged from supplier<input name="quantity_damaged" type="number" step="0.01" defaultValue="0" /></label>
              <label>Qty missing / short<input name="quantity_missing" type="number" step="0.01" defaultValue="0" /></label>
            </div>
            <label>Date it arrived<input name="movement_date" type="date" defaultValue={today()} /></label>
            <label>Notes<textarea name="notes" /></label>
            <div className="action-row">
              <button type="submit">Confirm receiving</button>
              <button type="button" className="button secondary cancel-btn">Cancel</button>
            </div>
          </form>
        </details>
      </div>

      <div className="card table-card">
        <div className="table-head">
          <h2>Recent receiving events</h2>
          <div className="table-tools">
            <form className="filter-bar" action="/receiving">
              <input name="q" defaultValue={q} placeholder="Search PO, part or notes" aria-label="Search list" />
              <button className="small-btn" type="submit">Search</button>
            </form>
            <span className="badge info">{shown.length} shown</span>
          </div>
        </div>
        <div className="wide-table"><table>
          <thead><tr><th>Date</th><th>PO</th><th>Part</th><th>Received</th><th>Damaged</th><th>Missing</th><th>Notes</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {shown.map((e: any) => (
              <tr key={e.id}>
                <td>{date(e.created_at)}</td>
                <td>{e.purchase_orders?.po_number}</td>
                <td className="name-cell">{e.parts?.name}<span className="sku-under">{e.parts?.sku}</span></td>
                <td>{num(e.quantity_received)}</td>
                <td>{num(e.quantity_damaged)}</td>
                <td>{num(e.quantity_missing)}</td>
                <td>{e.notes}</td>
                <td className="actions-cell" data-confirm-label={(e.parts?.name || 'this line') + ' on ' + (e.purchase_orders?.po_number || 'this shipment')}>
                  <div className="action-row">
                    <details className="mini-add">
                      <summary className="button small-btn secondary">Edit</summary>
                      <form className="stack card flat" action={editReceivingEvent}>
                        <input type="hidden" name="event_id" value={e.id} />
                        <input type="hidden" name="purchase_order_id" value={e.purchase_order_id} />
                        <input type="hidden" name="purchase_order_item_id" value={e.purchase_order_item_id} />
                        <p className="muted small">
                          Correcting this puts the original receipt back and books the new figures
                          in its place, so stock and the shipment line both follow.
                        </p>
                        <div className="form-row">
                          <label>Good<input name="quantity_received" type="number" step="0.01" min="0" defaultValue={e.quantity_received ?? 0} /></label>
                          <label>Damaged<input name="quantity_damaged" type="number" step="0.01" min="0" defaultValue={e.quantity_damaged ?? 0} /></label>
                          <label>Missing<input name="quantity_missing" type="number" step="0.01" min="0" defaultValue={e.quantity_missing ?? 0} /></label>
                        </div>
                        <label>Date it arrived<input name="movement_date" type="date" defaultValue={today()} /></label>
                        <label>Notes<textarea name="notes" defaultValue={e.notes || ''} /></label>
                        <div className="action-row">
                          <ActionButton className="small-btn" confirm="Replace this receiving with the new figures?" busyLabel="Saving…" doneLabel="Corrected">Save correction</ActionButton>
                          <button type="button" className="button secondary cancel-btn">Cancel</button>
                        </div>
                      </form>
                    </details>
                    <form className="inline-form" action={undoReceivingEvent}>
                      <input type="hidden" name="event_id" value={e.id} />
                      <input type="hidden" name="purchase_order_id" value={e.purchase_order_id} />
                      <ActionButton className="small-btn danger" busyLabel="Undoing…" doneLabel="Undone">Undo</ActionButton>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={8}><div className="empty-state">{q ? 'No receiving events match that search.' : 'No receiving events yet.'}</div></td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
