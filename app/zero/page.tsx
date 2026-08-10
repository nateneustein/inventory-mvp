import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { reportZeroStock, reportUnlistedSupply } from '@/lib/actions'
import { deleteZeroStockReport } from '@/lib/record-actions'
import { date, num } from '@/lib/format'
import { SearchSelect } from '@/components/search-select'
import { ActionButton } from '@/components/action-button'
import { ShipmentComing, ShipmentWaiting, AlreadyOrdered, NeedsOrdering, Alarm } from '@/components/shipment-coming'
import { rowMatches } from '@/lib/search'

/**
 * Alarms, not tasks.
 *
 * Everything here is a TRACKED part - one the app is supposed to be predicting
 * and reordering on time. A report on one of these means the forecast was
 * wrong, so the page reads as a list of failures worth understanding, not a
 * to-do list. Reports on untracked parts are a different animal entirely and
 * live on the reorder page.
 */
export default async function ZeroPage({ searchParams }: { searchParams?: Promise<{ q?: string; unlisted?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = params.q || ''
  const { supabase } = await requireUser()

  const { data: parts } = await supabase.from('parts').select('id, name, sku, tracked').eq('active', true).order('name')
  const { data: rows } = await supabase.from('stock_report_board').select('*').order('created_at', { ascending: false }).limit(200)

  const tracked = (rows || []).filter((r: any) => r.tracked)
  const shown = tracked.filter((r: any) => rowMatches(q, r.part_name, r.part_sku, r.notes, r.order_reference))
  const zeros = shown.filter((r: any) => r.report_type === 'zero')
  const lows = shown.filter((r: any) => r.report_type === 'running_low')
  const untrackedCount = (rows || []).filter((r: any) => !r.tracked && !r.is_done).length
  const untracked = (rows || [])
    .filter((r: any) => !r.tracked)
    .filter((r: any) => rowMatches(q, r.part_name, r.part_sku, r.notes, r.order_reference))

  const partOptions = (parts || []).map((p: any) => ({
    value: p.id,
    label: p.name,
    hint: [p.sku, p.tracked ? 'tracked' : 'not tracked - goes to the reorder list'].filter(Boolean).join(' · '),
  }))

  function Row({ r }: { r: any }) {
    return (
      <tr className={r.covered_by_incoming || r.awaiting_receipt ? 'covered-row' : 'alarm-row'}>
        <td>{date(r.created_at)}</td>
        <td className="name-cell">
          <Link className="link" href={'/parts/' + r.part_id}>{r.part_name}</Link>
          <span className="sku-under">{r.part_sku}</span>
        </td>
        <td>
          <span className={'badge ' + (r.report_type === 'zero' ? 'out' : 'warning')}>
            {r.report_type === 'zero' ? 'at zero' : 'running low'}
          </span>
        </td>
        <td>{num(r.system_quantity_at_report)}</td>
        <td>
          {r.awaiting_receipt ? (
            <ShipmentWaiting
              poNumber={r.awaiting_po_number}
              expectedDate={r.awaiting_expected_date}
              quantity={r.awaiting_qty}
              daysLate={r.awaiting_days_late}
              carrierDelivered={r.awaiting_carrier_delivered}
            />
          ) : r.covered_by_incoming ? (
            <ShipmentComing poNumber={r.po_number} expectedDate={r.incoming_expected_date} />
          ) : (
            <Alarm
              atZero={r.report_type === 'zero'}
              poNumber={r.purchase_order_id ? r.po_number : null}
              expectedDate={r.incoming_expected_date}
              awaitingPo={r.awaiting_po_number}
              awaitingQty={r.awaiting_qty}
              awaitingExpected={r.awaiting_expected_date}
              awaitingDaysLate={r.awaiting_days_late}
              awaitingDelivered={r.awaiting_carrier_delivered}
            />
          )}
        </td>
        <td style={{ whiteSpace: 'normal' }}>{r.notes}</td>
        <td className="ap-reporter">{r.reporter_name}</td>
        <td className="actions-cell" data-confirm-label={r.part_name}>
          <form className="inline-form" action={deleteZeroStockReport}>
            <input type="hidden" name="id" value={r.id} />
            <ActionButton className="small-btn danger" busyLabel="…" doneLabel="Deleted">Delete</ActionButton>
          </form>
        </td>
      </tr>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Report Zero and Running Low</h1>
          <p className="muted">
            Warehouse reports on <strong>tracked</strong> parts. These are alarms: the app is meant to
            order these before they run out, so a report here means the forecast missed.
          </p>
        </div>
        <Link className="button secondary" href="/reorder">Reorder list ({untrackedCount})</Link>
      </div>

      <div className="grid">
        <div className="card kpi-card"><div className="muted">At zero</div><div className="kpi">{zeros.length}</div></div>
        <div className="card kpi-card"><div className="muted">Running low</div><div className="kpi">{lows.length}</div></div>
        <div className="card kpi-card"><div className="muted">Covered by a shipment</div><div className="kpi">{shown.filter((r: any) => r.covered_by_incoming || r.awaiting_receipt).length}</div></div>
      </div>

      <div className="card">
        <details className="add-panel"><summary className="button">+ Report zero or running low</summary></details>
        <p className="muted small">
          Pick the part and say whether there are none left or it is getting low. If the part is not
          tracked the report goes to the reorder list instead of here, because for those a report is
          how ordering starts rather than a sign anything went wrong.
        </p>
        <form className="stack" action={reportZeroStock}>
          <label>Part<SearchSelect name="part_id" required placeholder="Type a part name or SKU" options={partOptions} /></label>
          <div className="form-row">
            <label>What is the situation?
              <select name="report_type" defaultValue="zero">
                <option value="zero">There are none left</option>
                <option value="running_low">Running low - order more</option>
              </select>
            </label>
            <label>Roughly how many are actually there?<input name="warehouse_quantity_reported" type="number" step="0.01" placeholder="Leave blank if you did not count" /></label>
            <label>Order reference, optional<input name="order_reference" placeholder="Etsy #12345" /></label>
          </div>
          <label>Notes<textarea name="notes" placeholder="Checked both shelves and the overflow rack." /></label>
          <div className="action-row">
            <ActionButton busyLabel="Reporting…" doneLabel="Reported">Send report</ActionButton>
            <button type="button" className="button secondary cancel-btn">Cancel</button>
          </div>
        </form>
        <details className="add-panel ap-unlisted"><summary className="button secondary">Can’t find the part? Report an unlisted supply</summary>
          <p className="muted small">Use this if the supply is not in the list at all. It files a report for the team to check — it does not create a part or change stock.</p>
          <form className="stack" action={reportUnlistedSupply}>
            <label>Supply name<input name="supply_name" required placeholder="e.g. 4x6 thank-you cards" /></label>
            <label>What is going on?<textarea name="note" placeholder="Can’t find it in the app, at zero, running low, etc." /></label>
            <ActionButton busyLabel="Filing…" doneLabel="Filed">File unlisted report</ActionButton>
          </form>
        </details>
      </div>

      {params.unlisted === '1' && <div className="card success-soft"><strong>Thanks — your unlisted supply report was filed. The team will check on it.</strong></div>}
      {params.unlisted === 'need_name' && <div className="card danger-soft"><strong>Please enter the supply name before filing the report.</strong></div>}

      <div className="card table-card">
        <div className="table-head">
          <div>
            <h2>At zero</h2>
            <p className="muted small">A tracked part reaching zero stays an alarm even with a shipment on the water - it means we ordered too late.</p>
          </div>
          <span className="badge out">{zeros.length}</span>
        </div>
        <div className="wide-table"><table>
          <thead><tr><th>Reported</th><th>Part</th><th>Type</th><th>System said</th><th>Incoming</th><th>Notes</th><th>Reported by</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {zeros.map((r: any) => <Row key={r.id} r={r} />)}
            {zeros.length === 0 && <tr><td colSpan={7}><div className="empty-state">Nothing has been reported at zero.</div></td></tr>}
          </tbody>
        </table></div>
      </div>

      <div className="card table-card">
        <div className="table-head">
          <div>
            <h2>Running low</h2>
            <p className="muted small">Marked in blue where a shipment was already on its way when the report was made - going low with stock inbound is normal, and those must not be ordered again.</p>
          </div>
          <span className="badge warning">{lows.length}</span>
        </div>
        <div className="table-tools">
          <form className="filter-bar" action="/zero">
            <input name="q" defaultValue={q} placeholder="Search part or notes" aria-label="Search list" />
            <button className="small-btn" type="submit">Search</button>
          </form>
        </div>
        <div className="wide-table"><table>
          <thead><tr><th>Reported</th><th>Part</th><th>Type</th><th>System said</th><th>Incoming</th><th>Notes</th><th>Reported by</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {lows.map((r: any) => <Row key={r.id} r={r} />)}
            {lows.length === 0 && <tr><td colSpan={7}><div className="empty-state">Nothing reported as running low.</div></td></tr>}
          </tbody>
        </table></div>
      </div>

      {/* Untracked parts raise no alarm - a report on one becomes a job on the
          reorder list instead. It is repeated here because this is the only page
          the warehouse reports from, and a report that disappears off the page it
          was filed on reads as a report that did not save. Read-only: whoever does
          the ordering works from the reorder list. */}
      <div className="card table-card">
        <div className="table-head">
          <div>
            <h2>Untracked parts - passed to the reorder list</h2>
            <p className="muted small">
              Nothing here means anything went wrong. These parts are not counted, so asking for them
              is simply how they get ordered. Shown so you can see the report went through.
            </p>
          </div>
          <span className="badge info">{untracked.length}</span>
        </div>
        <div className="wide-table"><table>
          <thead><tr><th>Reported</th><th>Part</th><th>Type</th><th>Where it stands</th><th>Notes</th></tr></thead>
          <tbody>
            {untracked.map((r: any) => (
              <tr key={r.id} className={r.is_done ? 'done-row' : r.covered_by_incoming || r.awaiting_receipt ? 'covered-row' : 'todo-row'}>
                <td>{date(r.created_at)}</td>
                <td className="name-cell">
                  <Link className="link" href={'/parts/' + r.part_id}>{r.part_name}</Link>
                  <span className="sku-under">{r.part_sku}</span>
                </td>
                <td>
                  <span className={'badge ' + (r.report_type === 'zero' ? 'out' : 'warning')}>
                    {r.report_type === 'zero' ? 'none left' : 'running low'}
                  </span>
                </td>
                <td className="small" style={{ whiteSpace: 'normal' }}>
                  {r.is_done ? (
                    <AlreadyOrdered when={r.resolved_at} note={r.resolution_note} />
                  ) : r.awaiting_receipt ? (
                    <ShipmentWaiting
                      poNumber={r.awaiting_po_number}
                      expectedDate={r.awaiting_expected_date}
                      quantity={r.awaiting_qty}
                      daysLate={r.awaiting_days_late}
                      carrierDelivered={r.awaiting_carrier_delivered}
                    />
                  ) : r.covered_by_incoming ? (
                    <ShipmentComing poNumber={r.po_number} expectedDate={r.incoming_expected_date} />
                  ) : (
                    <NeedsOrdering />
                  )}
                </td>
                <td style={{ whiteSpace: 'normal' }}>{r.notes}</td>
              </tr>
            ))}
            {untracked.length === 0 && (
              <tr><td colSpan={5}><div className="empty-state">Nothing has been reported on an untracked part.</div></td></tr>
            )}
          </tbody>
        </table></div>
        <div className="action-row">
          <Link className="button secondary" href="/reorder">Open the reorder list</Link>
        </div>
      </div>
    </>
  )
}
