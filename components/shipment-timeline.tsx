import { requireUser } from '@/lib/require-user'
import { date } from '@/lib/format'
import { ActionButton } from '@/components/action-button'
import { trackingEnabled } from '@/lib/tracking'
import { addShipmentUpdate, deleteShipmentUpdate, refreshShipmentTracking } from '@/lib/shipment-actions'

/** The things people actually report about a sea freight, in the order they happen. */
const COMMON_STAGES = [
  'Left the factory',
  'Handed to the forwarder',
  'On the ship',
  'Arrived at destination port',
  'Cleared customs',
  'With the local courier',
  'Out for delivery',
  'Delayed',
]

function when(value: string | null) {
  if (!value) return ''
  const stamp = new Date(value)
  if (Number.isNaN(stamp.getTime())) return ''
  return stamp.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

/**
 * Everything known about where one shipment is.
 *
 * Carrier events and updates typed in by hand share one list on purpose. On a
 * sea freight the courier tracking is silent for weeks and the only real news
 * comes from the supplier - "it cleared customs today" - so splitting them
 * into two lists would hide the half that matters most.
 */
export async function ShipmentTimeline({ po }: { po: any }) {
  const { supabase } = await requireUser()
  const { data: rows } = await supabase
    .from('shipment_updates')
    .select('*')
    .eq('purchase_order_id', po.id)
    .order('happened_at', { ascending: false })
    .limit(200)

  const updates = rows || []
  const enabled = trackingEnabled()
  const hasNumber = Boolean(String(po.tracking_number || '').trim())

  return (
    <div className="card table-card">
      <div className="table-head">
        <h2>Where this shipment is</h2>
        <span className="badge info">{updates.length} update(s)</span>
      </div>

      <div className="tracking-summary">
        <dl className="detail-list">
          <div><dt>Tracking number</dt><dd>{hasNumber ? po.tracking_number : <span className="muted">None yet</span>}</dd></div>
          <div><dt>Carrier</dt><dd>{po.carrier_name || <span className="muted">Not identified yet</span>}</dd></div>
          <div><dt>Carrier status</dt><dd>{po.tracking_status ? po.tracking_status + (po.tracking_substatus ? ' · ' + po.tracking_substatus : '') : <span className="muted">Nothing reported yet</span>}</dd></div>
          <div><dt>Last carrier event</dt><dd>{po.tracking_last_event ? po.tracking_last_event + (po.tracking_last_location ? ' — ' + po.tracking_last_location : '') : <span className="muted">None</span>}<br />{po.tracking_last_event_at && <span className="muted small">{when(po.tracking_last_event_at)}</span>}</dd></div>
          <div><dt>Carrier estimate</dt><dd>{po.tracking_eta ? date(po.tracking_eta) : <span className="muted">Not given yet</span>}</dd></div>
          <div><dt>Expected date</dt><dd>{po.expected_date ? date(po.expected_date) : <span className="muted">Not set</span>}</dd></div>
          <div><dt>Last checked</dt><dd>{po.tracking_checked_at ? when(po.tracking_checked_at) : <span className="muted">Never</span>}</dd></div>
        </dl>

        {po.tracking_error && (
          <p className="ignored-note"><strong>Carrier check:</strong> {po.tracking_error}</p>
        )}
        {!enabled && (
          <p className="muted small">
            Carrier lookups are switched off until a 17TRACK key is added as TRACK17_API_KEY in the
            Vercel project settings. Updates typed in below work either way.
          </p>
        )}

        <div className="action-row wrap">
          {hasNumber && (
            <form className="inline-form" action={refreshShipmentTracking}>
              <input type="hidden" name="purchase_order_id" value={po.id} />
              <ActionButton className="small-btn" busyLabel="Checking…" doneLabel="Checked">Check the carrier now</ActionButton>
            </form>
          )}

          <details className="mini-add">
            <summary className="button small-btn secondary">+ Add an update</summary>
            <form className="stack card flat" action={addShipmentUpdate}>
              <input type="hidden" name="purchase_order_id" value={po.id} />
              <div className="form-row">
                <label>What happened
                  <input name="status" list="shipment-stages" placeholder="Cleared customs" required />
                </label>
                <label>Where<input name="location" placeholder="Ningbo port" /></label>
                <label>When<input name="happened_at" type="datetime-local" /></label>
              </div>
              <label>Anything else worth knowing<textarea name="note" placeholder="Annie said it is on the next vessel, leaving Friday." /></label>
              <div className="action-row">
                <ActionButton className="small-btn" busyLabel="Saving…" doneLabel="Added">Add update</ActionButton>
                <button type="button" className="button secondary cancel-btn">Cancel</button>
              </div>
            </form>
          </details>
        </div>

        <datalist id="shipment-stages">
          {COMMON_STAGES.map((stage) => <option key={stage} value={stage} />)}
        </datalist>
      </div>

      <div className="wide-table"><table>
        <thead><tr><th>When</th><th>What</th><th>Where</th><th>Detail</th><th>From</th><th className="actions-cell">Actions</th></tr></thead>
        <tbody>
          {updates.map((u: any) => (
            <tr key={u.id} className={u.source === 'manual' ? 'manual-update' : undefined} data-confirm-label={u.status || u.note || 'this update'}>
              <td>{when(u.happened_at)}</td>
              <td><strong>{u.status || '—'}</strong></td>
              <td>{u.location}</td>
              <td style={{ whiteSpace: 'normal' }}>{u.note}</td>
              <td><span className={'badge ' + (u.source === 'manual' ? 'info' : 'ok')}>{u.source === 'manual' ? 'typed in' : 'carrier'}</span></td>
              <td className="actions-cell">
                {u.source === 'manual' && (
                  <form className="inline-form" action={deleteShipmentUpdate}>
                    <input type="hidden" name="purchase_order_id" value={po.id} />
                    <input type="hidden" name="update_id" value={u.id} />
                    <ActionButton className="small-btn danger" busyLabel="…" doneLabel="Removed">Remove</ActionButton>
                  </form>
                )}
              </td>
            </tr>
          ))}
          {updates.length === 0 && (
            <tr><td colSpan={6}><div className="empty-state">Nothing recorded yet. Add what the supplier told you, or check the carrier.</div></td></tr>
          )}
        </tbody>
      </table></div>
    </div>
  )
}
