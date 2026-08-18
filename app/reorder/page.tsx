import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { reportZeroStock, resolveStockReport, reopenStockReport } from '@/lib/actions'
import { deleteZeroStockReport } from '@/lib/record-actions'
import { date, num } from '@/lib/format'
import { SearchSelect } from '@/components/search-select'
import { ActionButton } from '@/components/action-button'
import { ShipmentComing, ShipmentWaiting, AlreadyOrdered, NeedsOrdering } from '@/components/shipment-coming'

/**
 * Tasks, not alarms.
 *
 * These are reports on UNTRACKED parts - boxes, tape, the small supplies nobody
 * counts. Nothing predicts them, so a warehouse report is not a sign the system
 * failed: it IS how ordering starts. Each one becomes a card somebody works
 * through and ticks off.
 *
 * Reports on tracked parts are the opposite and live on the alarm page.
 */
export default async function ReorderPage({ searchParams }: { searchParams?: Promise<{ show?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const show = params.show || 'open'
  const { supabase } = await requireUser()

  const { data: parts } = await supabase.from('parts').select('id, name, sku, tracked').eq('active', true).order('name')
  const { data: rows } = await supabase.from('stock_report_board').select('*').order('created_at', { ascending: false }).limit(300)

  const untracked = (rows || []).filter((r: any) => !r.tracked)
  const open = untracked.filter((r: any) => !r.is_done)
  const done = untracked.filter((r: any) => r.is_done)
  /* What arrived last, and how much. A shipment that landed on Tuesday and was
     not put away looks exactly like no stock at all to the person on the floor,
     so the card has to say so before anyone orders a second one. */
  const reportedPartIds = Array.from(new Set(untracked.map((r: any) => r.part_id)))
  /* Read from the stock ledger rather than the receiving screen, because most of
     the history for these parts came in from the spreadsheet and never went
     through receiving at all. Any way stock arrived, it left a movement. */
  const { data: arrivals } = reportedPartIds.length
    ? await supabase
        .from('inventory_movements')
        .select('part_id, quantity, movement_date, reason')
        .in('part_id', reportedPartIds)
        .eq('movement_type', 'supplier_received')
        .is('archived_at', null)
        .order('movement_date', { ascending: false })
    : { data: [] as any[] }

  const lastArrival = new Map<string, any>()
  for (const row of (arrivals || []) as any[]) {
    if (!lastArrival.has(row.part_id)) lastArrival.set(row.part_id, row)
  }

  function daysSince(stamp: string) {
    const then = Date.parse(stamp + 'T00:00:00Z')
    if (Number.isNaN(then)) return null
    return Math.floor((Date.now() - then) / 86400000)
  }

  /* Both kinds of cover belong in the same pile. To whoever is ordering they mean
     the same thing - the stock exists, do not buy it again - even though one is
     still moving and the other is sitting in the building waiting to be counted. */
  const covered = open.filter((r: any) => r.covered_by_incoming || r.awaiting_receipt)
  const needsOrdering = open.filter((r: any) => !r.covered_by_incoming && !r.awaiting_receipt)

  const partOptions = (parts || []).map((p: any) => ({
    value: p.id,
    label: p.name,
    hint: [p.sku, p.tracked ? 'tracked - goes to the alarm page' : 'not tracked'].filter(Boolean).join(' · '),
  }))

  function Card({ r }: { r: any }) {
    return (
      <div className={'shipment-card ' + (r.is_done ? 'ok' : (r.covered_by_incoming || r.awaiting_receipt) ? 'covered' : r.report_type === 'zero' ? 'out' : 'warning')}>
        <div className="shipment-card-head">
          {r.part_id ? <Link className="link row-name" href={'/parts/' + r.part_id}>{r.part_name}</Link> : <span className="row-name">{r.part_name}</span>}
          <span className={'badge ' + (r.report_type === 'zero' ? 'out' : 'warning')}>
            {r.report_type === 'zero' ? 'none left' : 'running low'}
          </span>
        </div>

        <p className="muted small">{r.part_sku}{r.category && <> · {r.category}</>} · reported {date(r.created_at)}{r.reporter_name && <> · by <strong>{r.reporter_name}</strong></>}</p>

        {/* What the person actually counted, next to what the app believed at
            the time. Showing only the system number hid the whole point of
            someone walking to the shelf. */}
        <p className="small">
          {r.warehouse_quantity_reported != null
            ? <>Counted on the shelf: <strong>{num(r.warehouse_quantity_reported)}</strong></>
            : <span className="muted">Not counted</span>}
          <span className="muted"> · system said {num(r.system_quantity_at_report)}</span>
        </p>

        {(() => {
          const arrival = lastArrival.get(r.part_id)
          if (!arrival) {
            return <p className="muted small">No stock of this has ever been booked in.</p>
          }
          const ago = daysSince(arrival.movement_date)
          const recent = ago !== null && ago <= 21
          return (
            <p className={recent ? 'last-arrival recent' : 'last-arrival'}>
              Last arrived: <strong>{num(arrival.quantity)}</strong> on {date(arrival.movement_date)}
              {ago !== null && <> ({ago === 0 ? 'today' : ago === 1 ? 'yesterday' : ago + ' days ago'})</>}
              {recent && <> — check the shelf before ordering again.</>}
            </p>
          )
        })()}

        {r.awaiting_receipt ? (
          <ShipmentWaiting
            poNumber={r.awaiting_po_number}
            expectedDate={r.awaiting_expected_date}
            quantity={r.awaiting_qty}
            daysLate={r.awaiting_days_late}
            carrierDelivered={r.awaiting_carrier_delivered}
          />
        ) : r.covered_by_incoming ? (
          <ShipmentComing
            poNumber={r.po_number}
            orderDate={r.incoming_order_date}
            expectedDate={r.incoming_expected_date}
          />
        ) : (
          <NeedsOrdering />
        )}

        {r.notes && <p className="small" style={{ whiteSpace: 'normal' }}>{r.notes}</p>}
        {r.resolution_note && <p className="muted small">Done: {r.resolution_note}</p>}

        <div className="action-row wrap">
          {r.is_done ? (
            <form className="inline-form" action={reopenStockReport}>
              <input type="hidden" name="report_id" value={r.id} />
              <ActionButton className="small-btn secondary" busyLabel="…" doneLabel="Reopened">Reopen</ActionButton>
            </form>
          ) : (
            <details className="mini-add">
              <summary className="button small-btn">Mark as ordered</summary>
              <form className="stack card flat" action={resolveStockReport}>
                <input type="hidden" name="report_id" value={r.id} />
                <label>What did you do?<input name="resolution_note" placeholder="Ordered 200 from B&C, due next week" /></label>
                <div className="action-row">
                  <ActionButton className="small-btn" busyLabel="Saving…" doneLabel="Done">Mark as ordered</ActionButton>
                  <button type="button" className="button secondary cancel-btn">Cancel</button>
                </div>
              </form>
            </details>
          )}
          {/* can_delete is decided by the database: a manager or admin any time, or
              the person who filed the report, on the same day. No button for anyone
              else, since it could only refuse them. */}
          {r.can_delete && (
          <div data-confirm-label={r.part_name}>
            <form className="inline-form" action={deleteZeroStockReport}>
              <input type="hidden" name="id" value={r.id} />
              <ActionButton className="small-btn danger" busyLabel="…" doneLabel="Deleted">Delete</ActionButton>
            </form>
          </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reorder — untracked and small supplies</h1>
          <p className="muted">
            Parts nobody counts. The warehouse says when they are getting low, and that request
            becomes a job on this page. Nothing here means anything went wrong.
          </p>
        </div>
        <Link className="button secondary" href="/zero">Tracked alarms</Link>
      </div>

      <div className="grid">
        <div className="card kpi-card"><div className="muted">Needs ordering</div><div className="kpi">{needsOrdering.length}</div></div>
        <div className="card kpi-card"><div className="muted">Already on order</div><div className="kpi">{covered.length}</div></div>
        <div className="card kpi-card"><div className="muted">Done</div><div className="kpi">{done.length}</div></div>
      </div>

      <div className="card">
        <details className="add-panel"><summary className="button">+ Ask for a reorder</summary></details>
        <p className="muted small">
          For untracked parts. Pick a tracked part by mistake and the report lands on the alarm page
          instead, which is where it belongs.
        </p>
        <form className="stack" action={reportZeroStock}>
          <label>Part<SearchSelect name="part_id" required placeholder="Type a part name or SKU" options={partOptions} /></label>
          <div className="form-row">
            <label>How bad is it?
              <select name="report_type" defaultValue="running_low">
                <option value="running_low">Running low - order more</option>
                <option value="zero">There are none left</option>
              </select>
            </label>
            <label>Roughly how many are left?<input name="warehouse_quantity_reported" type="number" step="0.01" defaultValue="0" /></label>
          </div>
          <label>Notes<textarea name="notes" placeholder="About a box and a half left on the rack." /></label>
          <div className="action-row">
            <ActionButton busyLabel="Sending…" doneLabel="Sent">Ask for a reorder</ActionButton>
            <button type="button" className="button secondary cancel-btn">Cancel</button>
          </div>
        </form>
      </div>

      <div className="card table-card">
        <div className="table-head">
          <div>
            <h2>To order</h2>
            <p className="muted small">Nothing on the way for these.</p>
          </div>
          <span className="badge out">{needsOrdering.length}</span>
        </div>
        <div className="shipment-cards">
          {needsOrdering.map((r: any) => <Card key={r.id} r={r} />)}
          {needsOrdering.length === 0 && <div className="empty-state">Nothing waiting to be ordered.</div>}
        </div>
      </div>

      {covered.length > 0 && (
        <div className="card table-card">
          <div className="table-head">
            <div>
              <h2>Already on order</h2>
              <p className="muted small">
                Stock for these already exists - either still in flight, or landed and waiting to be
                counted in - so the job is done. Kept here rather than hidden, so nothing disappears
                without a trace.
              </p>
            </div>
            <span className="badge info">{covered.length}</span>
          </div>
          <div className="shipment-cards">
            {covered.map((r: any) => <Card key={r.id} r={r} />)}
          </div>
        </div>
      )}

      <div className="card table-card">
        <div className="table-head">
          <div><h2>Completed</h2></div>
          <span className="badge ok">{done.length}</span>
        </div>
        {done.length === 0 ? (
          <div className="empty-state">Nothing has been marked as ordered yet.</div>
        ) : (
          <div className="wide-table"><table>
            <thead><tr><th>Reported</th><th>Part</th><th>Asked for</th><th>What was done</th><th>Marked done</th><th className="actions-cell">Actions</th></tr></thead>
            <tbody>
              {done.map((r: any) => (
                <tr key={r.id} className="done-row">
                  <td>{date(r.created_at)}</td>
                  <td className="name-cell"><Link className="link" href={'/parts/' + r.part_id}>{r.part_name}</Link><span className="sku-under">{r.part_sku}</span></td>
                  <td><span className={'badge ' + (r.report_type === 'zero' ? 'out' : 'warning')}>{r.report_type === 'zero' ? 'none left' : 'running low'}</span></td>
                  <td style={{ whiteSpace: 'normal' }}><AlreadyOrdered note={r.resolution_note} /></td>
                  <td>{date(r.resolved_at)}</td>
                  <td className="actions-cell">
                    <form className="inline-form" action={reopenStockReport}>
                      <input type="hidden" name="report_id" value={r.id} />
                      <ActionButton className="small-btn secondary" busyLabel="…" doneLabel="Reopened">Reopen</ActionButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  )
}
