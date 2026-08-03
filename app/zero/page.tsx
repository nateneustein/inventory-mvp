import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { reportZeroStock, deleteZeroStockReport } from '@/lib/actions'
import { date, num } from '@/lib/format'
import { SearchSelect } from '@/components/search-select'
import { ActionButton } from '@/components/action-button'
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
export default async function ZeroPage({ searchParams }: { searchParams?: Promise<{ q?: string }> }) {
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

  const partOptions = (parts || []).map((p: any) => ({
    value: p.id,
    label: p.name,
    hint: [p.sku, p.tracked ? 'tracked' : 'not tracked - goes to the reorder list'].filter(Boolean).join(' · '),
  }))

  function Row({ r }: { r: any }) {
    return (
      <tr className={r.covered_by_incoming ? 'covered-row' : undefined}>
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
          {r.covered_by_incoming ? (
            <span className="muted small">
              Covered - {r.po_number} was due {date(r.incoming_expected_date)}
            </span>
          ) : r.purchase_order_id ? (
            <span className="small">
              {r.po_number} due {date(r.incoming_expected_date)} - still an alarm
            </span>
          ) : (
            <span className="muted small">Nothing on the way</span>
          )}
        </td>
        <td style={{ whiteSpace: 'normal' }}>{r.notes}</td>
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
        <div className="card kpi-card"><div className="muted">At zero</div><div className="kpi">{zeros.filter((r: any) => !r.covered_by_incoming).length}</div></div>
        <div className="card kpi-card"><div className="muted">Running low</div><div className="kpi">{lows.filter((r: any) => !r.covered_by_incoming).length}</div></div>
        <div className="card kpi-card"><div className="muted">Covered by a shipment</div><div className="kpi">{shown.filter((r: any) => r.covered_by_incoming).length}</div></div>
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
            <label>How many are actually there?<input name="warehouse_quantity_reported" type="number" step="0.01" defaultValue="0" /></label>
            <label>Order reference, optional<input name="order_reference" placeholder="Etsy #12345" /></label>
          </div>
          <label>Notes<textarea name="notes" placeholder="Checked both shelves and the overflow rack." /></label>
          <div className="action-row">
            <ActionButton busyLabel="Reporting…" doneLabel="Reported">Send report</ActionButton>
            <button type="button" className="button secondary cancel-btn">Cancel</button>
          </div>
        </form>
      </div>

      <div className="card table-card">
        <div className="table-head">
          <div>
            <h2>At zero</h2>
            <p className="muted small">A tracked part reaching zero stays an alarm even with a shipment on the water - it means we ordered too late.</p>
          </div>
          <span className="badge out">{zeros.length}</span>
        </div>
        <div className="wide-table"><table>
          <thead><tr><th>Reported</th><th>Part</th><th>Type</th><th>System said</th><th>Incoming</th><th>Notes</th><th className="actions-cell">Actions</th></tr></thead>
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
            <p className="muted small">Greyed out where a shipment was already on its way when the report was made - going low with stock inbound is normal.</p>
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
          <thead><tr><th>Reported</th><th>Part</th><th>Type</th><th>System said</th><th>Incoming</th><th>Notes</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {lows.map((r: any) => <Row key={r.id} r={r} />)}
            {lows.length === 0 && <tr><td colSpan={7}><div className="empty-state">Nothing reported as running low.</div></td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
