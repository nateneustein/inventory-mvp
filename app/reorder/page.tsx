import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { reportZeroStock, resolveStockReport, reopenStockReport } from '@/lib/actions'
import { deleteZeroStockReport } from '@/lib/record-actions'
import { date, num } from '@/lib/format'
import { SearchSelect } from '@/components/search-select'
import { ActionButton } from '@/components/action-button'
import { ShipmentComing, AlreadyOrdered, NeedsOrdering } from '@/components/shipment-coming'

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
  const covered = open.filter((r: any) => r.covered_by_incoming)
  const needsOrdering = open.filter((r: any) => !r.covered_by_incoming)

  const partOptions = (parts || []).map((p: any) => ({
    value: p.id,
    label: p.name,
    hint: [p.sku, p.tracked ? 'tracked - goes to the alarm page' : 'not tracked'].filter(Boolean).join(' · '),
  }))

  function Card({ r }: { r: any }) {
    return (
      <div className={'shipment-card ' + (r.is_done ? 'ok' : r.covered_by_incoming ? 'covered' : r.report_type === 'zero' ? 'out' : 'warning')}>
        <div className="shipment-card-head">
          <Link className="link row-name" href={'/parts/' + r.part_id}>{r.part_name}</Link>
          <span className={'badge ' + (r.report_type === 'zero' ? 'out' : 'warning')}>
            {r.report_type === 'zero' ? 'none left' : 'running low'}
          </span>
        </div>

        <p className="muted small">{r.part_sku}{r.category && <> · {r.category}</>} · reported {date(r.created_at)}</p>

        {r.covered_by_incoming ? (
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
          <div data-confirm-label={r.part_name}>
            <form className="inline-form" action={deleteZeroStockReport}>
              <input type="hidden" name="id" value={r.id} />
              <ActionButton className="small-btn danger" busyLabel="…" doneLabel="Deleted">Delete</ActionButton>
            </form>
          </div>
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
                A shipment for these was already in flight when the request was made, so the job is
                done. Kept here rather than hidden, so nothing disappears without a trace.
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
