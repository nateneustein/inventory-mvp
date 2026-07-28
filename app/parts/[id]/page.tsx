import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { createManualAdjustment, reportZeroStock, reportDamage, archivePart, createSupplier, setPartIgnoreAlerts } from '@/lib/actions'
import {
  setPartReorderHorizon, updatePartDetails,
  savePartCustomField, deletePartCustomField,
  uploadPartFile, deletePartFile,
} from '@/lib/part-detail-actions'
import { date, num } from '@/lib/format'
import { SearchSelect } from '@/components/search-select'
import { ActionButton } from '@/components/action-button'

// The prediction sheet's own windows, so the reorder trigger is set in the same
// language the sheet speaks rather than in raw days.
const HORIZON_PRESETS = [
  { days: 35, label: '5 weeks' },
  { days: 61, label: '2 months' },
  { days: 76, label: '2.5 months' },
  { days: 90, label: '3 months' },
  { days: 122, label: '4 months' },
]

export default async function PartDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireUser()
  const { data: part } = await supabase.from('inventory_status').select('*').eq('part_id', id).single()
  // parts now has TWO foreign keys to suppliers (supplier_id and backup_supplier_id),
  // so a bare suppliers(...) embed is ambiguous and PostgREST refuses the whole
  // query -- which rendered every part page as "Part not found". Name the FK.
  const { data: details } = await supabase.from('parts').select('*, suppliers!parts_supplier_id_fkey(name, website, contact_name, email, phone)').eq('id', id).single()
  const { data: suppliers } = await supabase.from('suppliers').select('id, name').order('name')
  const { data: movements } = await supabase.from('inventory_movements').select('*').eq('part_id', id).is('archived_at', null).order('movement_date', { ascending: false }).order('created_at', { ascending: false }).limit(75)
  const { data: incoming } = await supabase.from('open_po_items').select('*').eq('part_id', id)
  const { data: zeroReports } = await supabase.from('zero_stock_reports').select('*').eq('part_id', id).order('created_at', { ascending: false }).limit(10)
  const { data: damageReports } = await supabase.from('damage_reports').select('*').eq('part_id', id).order('created_at', { ascending: false }).limit(10)
  const { data: customFields } = await supabase.from('part_custom_fields').select('*').eq('part_id', id).order('sort_order').order('created_at')
  const { data: partFiles } = await supabase.from('part_files').select('*').eq('part_id', id).order('created_at', { ascending: false })

  if (!part || !details) return <div className="card"><h1>Part not found</h1><Link className="button" href="/parts">Back to parts</Link></div>

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{part.name}</h1>
          <p className="muted">Part card page for QR scanning. URL: <code>/parts/{id}</code></p>
          {part.ignore_alerts && (
            <p className="ignored-note">
              <span className="badge ignored-alerts">alerts off</span>
              This part never counts as out of stock or reorder now. It still appears in the
              prediction sheet and usage, marked in orange.
            </p>
          )}
        </div>
        <div className="action-row">
          <Link className="button secondary" href="/parts">Back</Link>
          <form className="inline-form" action={setPartIgnoreAlerts}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="ignore_alerts" value={part.ignore_alerts ? 'false' : 'true'} />
            <ActionButton className="button secondary" confirm={part.ignore_alerts ? `Alert on ${part.name} again?` : `Stop alerts for ${part.name}?`} busyLabel="…" doneLabel="Saved">
              {part.ignore_alerts ? 'Turn alerts back on' : 'Ignore stock alerts'}
            </ActionButton>
          </form>
          <Link className="button" href={`/predictions/advanced?part_id=${id}`}>Calculate reorder</Link>
        </div>
      </div>

      <div className="grid">
        <div className="card kpi-card"><div className="muted">On hand</div><div className="kpi">{num(part.on_hand)}</div></div>
        <div className="card kpi-card"><div className="muted">Incoming</div><div className="kpi">{num(part.incoming_qty)}</div></div>
        <div className="card kpi-card"><div className="muted">Projected</div><div className="kpi">{num(part.projected_qty)}</div></div>
        <div className="card kpi-card"><div className="muted">Status</div><div className="kpi"><span className={`badge ${part.ignore_alerts ? 'ignored-alerts' : part.stock_status}`}>{part.stock_status}</span></div></div>
      </div>

      <div className="card">
        <div className="table-head">
          <h2>When should this part be reordered?</h2>
          <span className="badge info">{num(details.reorder_horizon_days || 0)} days</span>
        </div>
        <p className="muted">
          There is no fixed quantity here. The app watches the prediction sheet and asks you to
          reorder as soon as <strong>any</strong> of the three usage paces says this part runs out
          inside the window below. Fast-moving parts want a short window; slow ones can wait.
        </p>

        <dl className="detail-list">
          <div><dt>Cover left</dt><dd>{part.days_of_cover == null ? 'No usage recorded — never triggers' : `${num(part.days_of_cover)} days (${num(part.weeks_of_cover)} weeks)`}</dd></div>
          <div><dt>Driven by</dt><dd>{part.driving_rate || '—'}</dd></div>
          <div><dt>Runs out around</dt><dd>{part.projected_runout_date ? date(part.projected_runout_date) : '—'}</dd></div>
          <div><dt>Pace, 1 week</dt><dd>{num(part.daily_rate_7)} / day{part.days_of_cover_1wk_rate ? ` · ${num(part.days_of_cover_1wk_rate)} days left` : ''}</dd></div>
          <div><dt>Pace, 4 week</dt><dd>{num(part.daily_rate_28)} / day{part.days_of_cover_4wk_rate ? ` · ${num(part.days_of_cover_4wk_rate)} days left` : ''}</dd></div>
          <div><dt>Pace, 3 month</dt><dd>{num(part.daily_rate_90)} / day{part.days_of_cover_3mo_rate ? ` · ${num(part.days_of_cover_3mo_rate)} days left` : ''}</dd></div>
        </dl>

        <form className="stack" action={setPartReorderHorizon}>
          <input type="hidden" name="id" value={id} />
          <div className="form-row">
            <label>Warn me when it runs out within
              <input name="reorder_horizon_days" type="number" step="1" min="1"
                     defaultValue={details.reorder_horizon_days ?? 90} />
            </label>
            <div>
              <span className="muted small">days. Common windows:</span>
              <br />
              <span className="muted small">{HORIZON_PRESETS.map((h) => `${h.days} = ${h.label}`).join(' · ')}</span>
            </div>
          </div>
          <ActionButton busyLabel="Saving…" doneLabel="Window saved">Save reorder window</ActionButton>
        </form>
        <p className="muted small">
          Reorder point, target stock, lead times and safety days are kept below as notes for
          whoever places the order. None of them trigger anything.
        </p>
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Edit part / ordering settings</h2>
          <form className="stack" action={updatePartDetails}>
            <input type="hidden" name="id" value={id} />
            <div className="form-row">
              <label>Name<input name="name" defaultValue={details.name || ''} required /></label>
              <label>SKU<input name="sku" defaultValue={details.sku || ''} required /></label>
              <label>Category<input name="category" defaultValue={details.category || ''} /></label>
            </div>
            <div className="form-row">
              <label>Supplier<SearchSelect name="supplier_id" defaultValue={details.supplier_id || ''} placeholder="No supplier" options={(suppliers || []).map((s: any) => ({ value: s.id, label: s.name }))} /></label>
              <label>Supplier part #<input name="supplier_part_number" defaultValue={details.supplier_part_number || ''} /></label>
              <label>Unit<input name="unit" defaultValue={details.unit || 'each'} /></label>
            </div>
            <div className="form-row">
              <label>Lead min days<input name="lead_time_days_min" type="number" step="0.01" defaultValue={details.lead_time_days_min || 0} /></label>
              <label>Lead max days<input name="lead_time_days_max" type="number" step="0.01" defaultValue={details.lead_time_days_max || 0} /></label>
              <label>Safety days<input name="safety_stock_days" type="number" step="0.01" defaultValue={details.safety_stock_days || 0} /></label>
            </div>
            <div className="form-row">
              <label>Reorder point<input name="reorder_point" type="number" step="0.01" defaultValue={details.reorder_point || 0} /></label>
              <label>Target stock<input name="target_stock" type="number" step="0.01" defaultValue={details.target_stock || 0} /></label>
              <label>Default order qty<input name="default_order_quantity" type="number" step="0.01" defaultValue={details.default_order_quantity || 0} /></label>
            </div>
            <h3>What the buyer needs to order it</h3>
            <div className="form-row">
              <label>Unit price<input name="unit_price" type="number" step="0.0001" defaultValue={details.unit_price ?? ''} placeholder="Leave blank if unknown" /></label>
              <label>Currency<input name="currency" defaultValue={details.currency || 'USD'} /></label>
              <label>Min order qty (MOQ)<input name="moq" type="number" step="0.01" defaultValue={details.moq ?? ''} /></label>
            </div>
            <div className="form-row">
              <label>Order in multiples of<input name="order_multiple" type="number" step="0.01" defaultValue={details.order_multiple ?? ''} placeholder="e.g. cases of 50" /></label>
              <label>Size / dimensions<input name="size_dimensions" defaultValue={details.size_dimensions || ''} placeholder="12 x 19 in" /></label>
              <label>Colour / finish<input name="color_finish" defaultValue={details.color_finish || ''} placeholder="Pale gold mirror" /></label>
            </div>
            <label>Material / spec<input name="material_spec" defaultValue={details.material_spec || ''} placeholder="3mm cast acrylic" /></label>
            <label>Where to buy it (link)<input name="supplier_link" defaultValue={details.supplier_link || ''} placeholder="https://..." /></label>
            <label>What to tell the supplier<textarea name="supplier_order_instructions" defaultValue={details.supplier_order_instructions || ''} placeholder="Ask for the matte back, no protective film on one side. Confirm colour against the photo before they cut." /></label>
            <label>Packaging notes<textarea name="packaging_notes" defaultValue={details.packaging_notes || ''} placeholder="Ships flat between boards, 25 per box" /></label>
            <div className="form-row">
              <label>Backup supplier<SearchSelect name="backup_supplier_id" defaultValue={details.backup_supplier_id || ''} placeholder="None" options={(suppliers || []).map((s: any) => ({ value: s.id, label: s.name }))} /></label>
              <label>Backup supplier notes<input name="backup_supplier_notes" defaultValue={details.backup_supplier_notes || ''} placeholder="Slower but cheaper" /></label>
            </div>

            <div className="form-row">
              <label className="checkbox"><input name="critical" type="checkbox" defaultChecked={details.critical} />Critical part</label>
              {/* A select, not a checkbox: the action reads active !== 'off', so an
                  unchecked box would silently keep the part active forever. */}
              <label className="compact">Status<select name="active" defaultValue={details.active ? 'on' : 'off'}><option value="on">Active</option><option value="off">Archived</option></select></label>
            </div>
            <label>Notes<textarea name="notes" defaultValue={details.notes || ''} /></label>
            <ActionButton busyLabel="Saving…" doneLabel="Saved">Save part</ActionButton>
          </form>
          <form action={archivePart} className="inline-form"><input type="hidden" name="id" value={id} /><input type="hidden" name="active" value={details.active ? 'false' : 'true'} /><ActionButton className="danger" confirm={details.active ? `Archive ${details.name}?` : `Restore ${details.name}?`} busyLabel="…" doneLabel="Done">{details.active ? 'Archive part' : 'Restore part'}</ActionButton></form>
        </div>

        <div className="card">
          <h2>Supplier / order card</h2>
          <dl className="detail-list">
            <div><dt>Supplier</dt><dd>{details.suppliers?.name || 'Not set'}</dd></div>
            <div><dt>Website</dt><dd>{details.suppliers?.website ? <a className="link" href={details.suppliers.website}>{details.suppliers.website}</a> : ''}</dd></div>
            <div><dt>Contact</dt><dd>{details.suppliers?.contact_name} {details.suppliers?.email}</dd></div>
            <div><dt>Lead time</dt><dd>{num(details.lead_time_days_min)}–{num(details.lead_time_days_max)} days</dd></div>
            <div><dt>Buffer</dt><dd>{num(details.safety_stock_days)} days</dd></div>
            <div><dt>Order qty</dt><dd>{num(details.default_order_quantity)}</dd></div>
            {details.unit_price != null && <div><dt>Unit price</dt><dd>{num(details.unit_price)} {details.currency || 'USD'}</dd></div>}
            {details.moq != null && <div><dt>MOQ</dt><dd>{num(details.moq)}{details.order_multiple ? ` · in multiples of ${num(details.order_multiple)}` : ''}</dd></div>}
            {details.size_dimensions && <div><dt>Size</dt><dd>{details.size_dimensions}</dd></div>}
            {details.color_finish && <div><dt>Colour / finish</dt><dd>{details.color_finish}</dd></div>}
            {details.material_spec && <div><dt>Material</dt><dd>{details.material_spec}</dd></div>}
            {details.supplier_link && <div><dt>Where to buy</dt><dd><a className="link" href={details.supplier_link} target="_blank" rel="noreferrer">{details.supplier_link}</a></dd></div>}
            {details.packaging_notes && <div><dt>Packaging</dt><dd>{details.packaging_notes}</dd></div>}
            {details.backup_supplier_notes && <div><dt>Backup</dt><dd>{details.backup_supplier_notes}</dd></div>}
            {(customFields || []).map((f: any) => <div key={f.id}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
          </dl>
          {details.supplier_order_instructions && (
            <>
              <h3>What to tell the supplier</h3>
              <p className="ignored-note" style={{ whiteSpace: 'pre-wrap' }}>{details.supplier_order_instructions}</p>
            </>
          )}
          <details className="mini-details"><summary className="button small-btn secondary">Add a supplier</summary><form className="stack card flat" action={createSupplier}><label>Supplier name<input name="name" required /></label><div className="form-row"><label>Contact<input name="contact_name" /></label><label>Email<input name="email" /></label></div><label>Website<input name="website" /></label><label>Notes<textarea name="notes" /></label><ActionButton busyLabel="Creating…" doneLabel="Supplier created">Create supplier</ActionButton><p className="muted small">After adding, refresh/select the supplier in the edit part form and save this part.</p></form></details>
          <hr />
          <h2>Warehouse quick actions</h2>
          <form className="stack" action={reportZeroStock}>
            <input type="hidden" name="part_id" value={id} />
            <label>Zero report note<textarea name="notes" placeholder="Scanned bin and there are none left" /></label>
            <ActionButton confirm="Confirm: there are none left?" busyLabel="Reporting…" doneLabel="Reported">Report zero</ActionButton>
          </form>
          <hr />
          <form className="stack" action={reportDamage}>
            <input type="hidden" name="part_id" value={id} />
            <label>Damaged qty<input name="quantity" type="number" step="0.01" required /></label>
            <label>Reason<select name="reason"><option value="supplier_damaged">Supplier damaged</option><option value="production_damaged">Production damaged</option><option value="wrong_cut">Wrong cut</option><option value="broken_in_shipping">Broken in shipping</option><option value="testing_sample">Testing/sample</option><option value="missing">Missing</option><option value="unknown">Unknown</option></select></label>
            <label>Notes<textarea name="notes" /></label>
            <ActionButton confirm="Confirm this damage write-off?" busyLabel="Reporting…" doneLabel="Reported">Report damage</ActionButton>
          </form>
          <hr />
          <form className="stack" action={createManualAdjustment}>
            <input type="hidden" name="part_id" value={id} />
            <label>Adjustment qty<input name="quantity_change" type="number" step="0.01" required placeholder="-3 or 10" /></label>
            <input type="hidden" name="reason" value="Part page manual adjustment" />
            <label>Notes<textarea name="notes" /></label>
            <ActionButton confirm="Confirm this stock adjustment?" busyLabel="Saving…" doneLabel="Adjusted">Save adjustment</ActionButton>
          </form>
        </div>
      </div>

      <div className="grid two">
        <div className="card table-card">
          <div className="table-head">
            <h2>Extra information</h2>
            <span className="badge info">{(customFields || []).length} line(s)</span>
          </div>
          <p className="muted">
            Anything the fixed fields above do not cover. Whatever you put here shows on the
            supplier / order card, so the person ordering sees it without digging.
          </p>
          {/* deliberately NOT compact-rows: that clips cells with ellipsis, which
              would mangle the inline edit form living inside each row. */}
          <div className="wide-table"><table>
            <thead><tr><th>Label</th><th>Value</th><th className="actions-cell">Actions</th></tr></thead>
            <tbody>
              {(customFields || []).map((f: any) => (
                <tr key={f.id}>
                  <td colSpan={2}>
                    <form className="form-row" action={savePartCustomField}>
                      <input type="hidden" name="part_id" value={id} />
                      <input type="hidden" name="field_id" value={f.id} />
                      <label>Label<input name="label" defaultValue={f.label} required /></label>
                      <label>Value<input name="value" defaultValue={f.value || ''} /></label>
                      <label className="compact">Order<input name="sort_order" type="number" defaultValue={f.sort_order ?? 100} /></label>
                      <ActionButton className="small-btn" busyLabel="…" doneLabel="Saved">Save</ActionButton>
                    </form>
                  </td>
                  <td className="actions-cell">
                    <form className="inline-form" action={deletePartCustomField}>
                      <input type="hidden" name="part_id" value={id} />
                      <input type="hidden" name="field_id" value={f.id} />
                      <ActionButton className="small-btn danger" confirm={`Remove the "${f.label}" line?`} busyLabel="…" doneLabel="Removed">Remove</ActionButton>
                    </form>
                  </td>
                </tr>
              ))}
              {(customFields || []).length === 0 && <tr><td colSpan={3}><div className="empty-state">No extra lines yet.</div></td></tr>}
            </tbody>
          </table></div>
          <form className="stack" action={savePartCustomField}>
            <input type="hidden" name="part_id" value={id} />
            <div className="form-row">
              <label>New label<input name="label" placeholder="Thickness" required /></label>
              <label>Value<input name="value" placeholder="3mm" /></label>
              <label className="compact">Order<input name="sort_order" type="number" defaultValue={100} /></label>
            </div>
            <ActionButton busyLabel="Adding…" doneLabel="Added">Add line</ActionButton>
          </form>
        </div>

        <div className="card table-card">
          <div className="table-head">
            <h2>Files &amp; photos</h2>
            <span className="badge info">{(partFiles || []).length} file(s)</span>
          </div>
          <p className="muted">
            Upload the photos and spec sheets you send to the supplier. Anyone placing the order
            can download them straight from here.
          </p>
          <div className="wide-table compact-rows"><table>
            <thead><tr><th>File</th><th>Kind</th><th>Caption</th><th>Size</th><th className="actions-cell">Actions</th></tr></thead>
            <tbody>
              {(partFiles || []).map((f: any) => (
                <tr key={f.id}>
                  <td>{f.file_name}{f.send_to_supplier && <> <span className="badge info">send to supplier</span></>}</td>
                  <td>{f.kind}</td>
                  <td>{f.caption}</td>
                  <td>{f.size_bytes ? `${Math.round(Number(f.size_bytes) / 1024)} KB` : ''}</td>
                  <td className="actions-cell"><div className="action-row">
                    <a className="button small-btn secondary" href={`/api/part-files/${f.id}`}>Download</a>
                    <form className="inline-form" action={deletePartFile}>
                      <input type="hidden" name="part_id" value={id} />
                      <input type="hidden" name="file_id" value={f.id} />
                      <ActionButton className="small-btn danger" confirm={`Delete ${f.file_name}?`} busyLabel="…" doneLabel="Deleted">Remove</ActionButton>
                    </form>
                  </div></td>
                </tr>
              ))}
              {(partFiles || []).length === 0 && <tr><td colSpan={5}><div className="empty-state">Nothing uploaded for this part yet.</div></td></tr>}
            </tbody>
          </table></div>
          <form className="stack" action={uploadPartFile}>
            <input type="hidden" name="part_id" value={id} />
            <label>File<input name="file" type="file" required /></label>
            <div className="form-row">
              <label className="compact">Kind
                <select name="kind" defaultValue="supplier_spec">
                  <option value="supplier_spec">Supplier spec / photo</option>
                  <option value="reference_photo">Reference photo</option>
                  <option value="invoice">Invoice / quote</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>Caption<input name="caption" placeholder="Colour reference — match this exactly" /></label>
            </div>
            <label className="small"><span><input name="send_to_supplier" type="checkbox" defaultChecked style={{ width: 'auto', marginRight: 8 }} />This is one to send to the supplier</span></label>
            <ActionButton busyLabel="Uploading…" doneLabel="Uploaded">Upload</ActionButton>
          </form>
        </div>
      </div>

      <div className="card table-card">
        <div className="table-head"><h2>Incoming shipments for this part</h2><Link className="button small-btn secondary" href="/shipments">All shipments</Link></div>
        <table><thead><tr><th>PO</th><th>Supplier</th><th>Expected</th><th>Remaining</th><th>Tracking</th><th></th></tr></thead><tbody>{(incoming || []).map((i: any) => <tr key={i.purchase_order_item_id}><td><Link className="link" href={`/shipments/${i.purchase_order_id}`}>{i.po_number}</Link></td><td>{i.supplier_name}</td><td>{date(i.expected_date)}</td><td>{num(i.remaining_qty)}</td><td>{i.tracking_number}</td><td><Link className="button small-btn secondary" href={`/shipments/${i.purchase_order_id}`}>Open</Link></td></tr>)}{(incoming || []).length === 0 && <tr><td colSpan={6}><div className="empty-state">No incoming shipments.</div></td></tr>}</tbody></table>
      </div>

      <div className="grid two">
        <div className="card table-card"><div className="table-head"><h2>Zero reports</h2></div><table><thead><tr><th>Date</th><th>System qty</th><th>Notes</th></tr></thead><tbody>{(zeroReports || []).map((z:any) => <tr key={z.id}><td>{date(z.created_at)}</td><td>{num(z.system_quantity_at_report)}</td><td>{z.notes}</td></tr>)}{(zeroReports || []).length === 0 && <tr><td colSpan={3}><div className="empty-state">No zero reports for this part.</div></td></tr>}</tbody></table></div>
        <div className="card table-card"><div className="table-head"><h2>Damage reports</h2></div><table><thead><tr><th>Date</th><th>Qty</th><th>Reason</th><th>Notes</th></tr></thead><tbody>{(damageReports || []).map((d:any) => <tr key={d.id}><td>{date(d.created_at)}</td><td>{num(d.quantity)}</td><td>{d.reason}</td><td>{d.notes}</td></tr>)}{(damageReports || []).length === 0 && <tr><td colSpan={4}><div className="empty-state">No damage reports for this part.</div></td></tr>}</tbody></table></div>
      </div>

      <div className="card table-card">
        <div className="table-head"><h2>Recent movements</h2></div>
        <div className="wide-table"><table><thead><tr><th>Date</th><th>Type</th><th>Qty</th><th>Reason</th><th>Notes</th></tr></thead><tbody>{(movements || []).map((m: any) => <tr key={m.id}><td>{date(m.created_at)}</td><td>{m.movement_type}</td><td>{num(m.quantity)}</td><td>{m.reason}</td><td>{m.notes}</td></tr>)}{(movements || []).length === 0 && <tr><td colSpan={5}><div className="empty-state">No movement history yet.</div></td></tr>}</tbody></table></div>
      </div>
    </>
  )
}
