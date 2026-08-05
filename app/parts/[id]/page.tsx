import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { createManualAdjustment, reportZeroStock, reportDamage, archivePart, createSupplier, setPartIgnoreAlerts } from '@/lib/actions'
import {
  setPartReorderHorizon, setPartOrderMonths, updatePartDetails,
  savePartSupplier, deletePartSupplier,
  savePartLink, deletePartLink,
  uploadPartFile, deletePartFile,
} from '@/lib/part-detail-actions'
import { date, num, supplierHint, today } from '@/lib/format'
import { SearchSelect } from '@/components/search-select'
import { StickySelect } from '@/components/sticky-select'
import { ReorderWindowHistory } from '@/components/reorder-window-history'
import { OrderMonthsHistory } from '@/components/order-months-history'
import { ActionButton } from '@/components/action-button'
import { PhotoInput } from '@/components/photo-input'

/** Defaults to today, but the box exists so a movement can be back-dated into
 *  the week it really happened - the weekly sheets are read as history. */

// The prediction sheet's own windows, so the reorder trigger is set in the same
// language the sheet speaks rather than in raw days.
const HORIZON_PRESETS = [
  { days: 35, label: '5 weeks' },
  { days: 61, label: '2 months' },
  { days: 76, label: '2.5 months' },
  { days: 90, label: '3 months' },
  { days: 122, label: '4 months' },
]

const DAMAGE_REASONS = [
  ['supplier_damaged', 'Supplier damaged'],
  ['production_damaged', 'Production damaged'],
  ['wrong_cut', 'Wrong cut'],
  ['broken_in_shipping', 'Broken in shipping'],
  ['testing_sample', 'Testing/sample'],
  ['missing', 'Missing'],
  ['unknown', 'Unknown'],
]

/**
 * One supplier's terms for this part.
 *
 * Part number, unit, usual price and minimum order belong to the SUPPLIER, not
 * to the part — a backup sells the same thing under its own code, in its own
 * box size, at its own price. Price and minimum order are free text on purpose:
 * "36.31 a box" and "500, or 250 if they split the run" are the real answers.
 */
function SupplierRow({
  partId, row, supplier, supplierOptions, isPrimary,
}: {
  partId: string
  row: any | null
  supplier: any | null
  supplierOptions: { value: string, label: string, hint?: string }[]
  isPrimary: boolean
}) {
  return (
    <div className="supplier-row" data-confirm-label={supplier?.name || 'this supplier'}>
      <form className="stack" action={savePartSupplier}>
        <input type="hidden" name="part_id" value={partId} />
        {row && <input type="hidden" name="row_id" value={row.id} />}

        <div className="form-row">
          <label>{isPrimary ? 'Supplier' : 'Backup supplier'}
            <SearchSelect
              name="supplier_id"
              defaultValue={row?.supplier_id || ''}
              placeholder="No supplier"
              options={supplierOptions}
              actionOption={{ label: '+ Add a new supplier', targetId: 'new-supplier-panel' }}
            />
          </label>
          <label>Supplier part number or name
            <input name="supplier_part_number" defaultValue={row?.supplier_part_number || ''} />
          </label>
          <label>Unit
            <input name="unit" defaultValue={row?.unit || ''} placeholder="Box of 250 pcs" />
          </label>
        </div>

        <div className="form-row">
          <label>Usual unit price
            <input name="unit_price" defaultValue={row?.unit_price || ''} placeholder="36.31 a box" />
          </label>
          <label>Min order quantity
            <input name="moq" defaultValue={row?.moq || ''} placeholder="500, or 250 if they split it" />
          </label>
          <div className="supplier-contact">
            {supplier ? (
              <>
                <span className="row-name">{supplier.contact_name || supplier.name}</span>
                <span className="muted small">
                  {[supplier.email, supplier.phone].filter(Boolean).join(' · ') || 'No contact details on file'}
                </span>
                {supplier.website && (
                  <a className="link small" href={supplier.website} target="_blank" rel="noreferrer">{supplier.website}</a>
                )}
                <Link className="link small" href={'/suppliers/' + supplier.id}>Open supplier page</Link>
              </>
            ) : (
              <span className="muted small">Pick a supplier and their contact details show here.</span>
            )}
          </div>
        </div>

        <div className="action-row">
          <ActionButton className="small-btn" busyLabel="Saving…" doneLabel="Saved">
            {row ? 'Save supplier' : 'Add supplier'}
          </ActionButton>
        </div>
      </form>

      {row && (
        <form className="inline-form supplier-remove" action={deletePartSupplier}>
          <input type="hidden" name="part_id" value={partId} />
          <input type="hidden" name="row_id" value={row.id} />
          <ActionButton className="small-btn danger" busyLabel="…" doneLabel="Removed">Remove supplier</ActionButton>
        </form>
      )}
    </div>
  )
}

export default async function PartDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireUser()

  const { data: part } = await supabase.from('inventory_status').select('*').eq('part_id', id).single()
  // No suppliers(...) embed here on purpose: parts has TWO foreign keys to
  // suppliers, which makes a bare embed ambiguous and once made PostgREST
  // refuse the whole query, rendering every part page as "Part not found".
  // Contact details come from the supplier list below instead.
  const { data: details } = await supabase.from('parts').select('*').eq('id', id).single()
  const { data: suppliers } = await supabase.from('suppliers').select('*').order('name')
  const { data: partSuppliers } = await supabase.from('part_suppliers').select('*').eq('part_id', id)
    .order('is_primary', { ascending: false }).order('sort_order').order('created_at')
  const { data: partLinks } = await supabase.from('part_links').select('*').eq('part_id', id)
    .order('sort_order').order('created_at')
  const { data: movements } = await supabase.from('inventory_movements').select('*').eq('part_id', id).is('archived_at', null).order('movement_date', { ascending: false }).order('created_at', { ascending: false }).limit(75)
  const { data: incoming } = await supabase.from('open_po_items').select('*').eq('part_id', id)
  const { data: zeroReports } = await supabase.from('zero_stock_reports').select('*').eq('part_id', id).order('created_at', { ascending: false }).limit(10)
  const { data: damageReports } = await supabase.from('damage_reports').select('*').eq('part_id', id).order('created_at', { ascending: false }).limit(10)
  const { data: partFiles } = await supabase.from('part_files').select('*').eq('part_id', id).order('created_at', { ascending: false })

  if (!part || !details) return <div className="card"><h1>Part not found</h1><Link className="button" href="/parts">Back to parts</Link></div>

  // The contact is often how someone remembers a supplier ("the one Sruli
  // handles"), so the picker searches and shows the contact name, email and
  // phone alongside the company name rather than the company name alone.
  const supplierOptions = (suppliers || []).map((s: any) => ({ value: s.id, label: s.name, hint: supplierHint(s) }))
  const supplierById = new Map<string, any>((suppliers || []).map((s: any) => [s.id as string, s] as [string, any]))
  const supplierRows = partSuppliers || []
  const files = partFiles || []
  const links = partLinks || []

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
            <ActionButton className="button secondary" confirm={part.ignore_alerts ? 'Alert on ' + part.name + ' again?' : 'Stop alerts for ' + part.name + '?'} busyLabel="…" doneLabel="Saved">
              {part.ignore_alerts ? 'Alerts are OFF — turn them ON' : 'Alerts are ON — turn them OFF'}
            </ActionButton>
          </form>
          <Link className="button" href={'/predictions/advanced?part_id=' + id}>Calculate reorder</Link>
        </div>
      </div>

      {/* The three things someone standing at the shelf actually does. They used
          to be buried in a card two thirds of the way down the page; now they
          are the first thing on it, each opening its own form when clicked. */}
      <div className="quick-actions">
        <details className="quick-action">
          <summary className="button">Report zero / running low</summary>
          <form className="stack card flat" action={reportZeroStock} data-confirm-label={part.name}>
            <input type="hidden" name="part_id" value={id} />
            <label>What is the situation?
              <select name="report_type" defaultValue="zero">
                <option value="zero">There are none left</option>
                <option value="running_low">Running low — order more</option>
              </select>
            </label>
            <label>Roughly how many are actually there?<input name="warehouse_quantity_reported" type="number" step="0.01" placeholder="Leave blank if you did not count" /></label>
            <label>What did you find?<textarea name="notes" placeholder="Scanned bin and there are none left" /></label>
            <div className="action-row"><ActionButton confirm={'Send a stock report for ' + part.name + '?'} busyLabel="Reporting…" doneLabel="Reported">Send report</ActionButton><button type="button" className="button secondary cancel-btn">Cancel</button></div>
          </form>
        </details>

        <details className="quick-action">
          <summary className="button">Report damage</summary>
          <form className="stack card flat" action={reportDamage} data-confirm-label={part.name}>
            <input type="hidden" name="part_id" value={id} />
            <label>Damaged qty<input name="quantity" type="number" step="0.01" required /></label>
            <label>Date it happened<input name="movement_date" type="date" defaultValue={today()} /></label>
            <label>Reason
              <select name="reason">
                {DAMAGE_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label>Notes<textarea name="notes" /></label>
            <div className="action-row"><ActionButton confirm={'Write off damaged stock on ' + part.name + '?'} busyLabel="Reporting…" doneLabel="Reported">Report damage</ActionButton><button type="button" className="button secondary cancel-btn">Cancel</button></div>
          </form>
        </details>

        <details className="quick-action">
          <summary className="button">Adjust stock</summary>
          <form className="stack card flat" action={createManualAdjustment} data-confirm-label={part.name}>
            <input type="hidden" name="part_id" value={id} />
            <input type="hidden" name="reason" value="Part page manual adjustment" />
            <label>Adjustment qty<input name="quantity_change" type="number" step="0.01" required placeholder="-3 or 10" /></label>
            <label>Date it happened<input name="movement_date" type="date" defaultValue={today()} /></label>
            <label>Notes<textarea name="notes" /></label>
            <div className="action-row"><ActionButton confirm={'Adjust the stock on ' + part.name + '?'} busyLabel="Saving…" doneLabel="Adjusted">Save adjustment</ActionButton><button type="button" className="button secondary cancel-btn">Cancel</button></div>
          </form>
        </details>
      </div>

      <div className="grid">
        <div className="card kpi-card"><div className="muted">On hand</div><div className="kpi">{num(part.on_hand)}</div></div>
        <div className="card kpi-card"><div className="muted">Incoming</div><div className="kpi">{num(part.incoming_qty)}</div></div>
        <div className="card kpi-card"><div className="muted">Projected</div><div className="kpi">{num(part.projected_qty)}</div></div>
        <div className="card kpi-card"><div className="muted">Status</div><div className="kpi"><span className={'badge ' + (part.ignore_alerts ? 'ignored-alerts' : part.stock_status)}>{part.stock_status}</span></div></div>
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
          <div><dt>Cover left</dt><dd>{part.days_of_cover == null ? 'No usage recorded — never triggers' : num(part.days_of_cover) + ' days (' + num(part.weeks_of_cover) + ' weeks)'}</dd></div>
          <div><dt>Driven by</dt><dd>{part.driving_rate || '—'}</dd></div>
          <div><dt>Runs out around</dt><dd>{part.projected_runout_date ? date(part.projected_runout_date) : '—'}</dd></div>
          <div><dt>Pace, 1 week</dt><dd>{num(part.daily_rate_7)} / day{part.days_of_cover_1wk_rate ? ' · ' + num(part.days_of_cover_1wk_rate) + ' days left' : ''}</dd></div>
          <div><dt>Pace, 4 week</dt><dd>{num(part.daily_rate_28)} / day{part.days_of_cover_4wk_rate ? ' · ' + num(part.days_of_cover_4wk_rate) + ' days left' : ''}</dd></div>
          <div><dt>Pace, 3 month</dt><dd>{num(part.daily_rate_90)} / day{part.days_of_cover_3mo_rate ? ' · ' + num(part.days_of_cover_3mo_rate) + ' days left' : ''}</dd></div>
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
              <span className="muted small">{HORIZON_PRESETS.map((h) => h.days + ' = ' + h.label).join(' · ')}</span>
            </div>
          </div>
          <label>Why are you changing it? (saved to the history below)
            <input name="reorder_note" />
          </label>
          <ActionButton busyLabel="Saving…" doneLabel="Window saved">Save reorder window</ActionButton>
        </form>
        <p className="muted small">
          Lead times and safety days are kept below as notes for whoever places
          the order. Neither of them triggers anything.
        </p>
      </div>

      <ReorderWindowHistory partId={id} />

      {/* The second lever, and it belongs next to the first one. The window
          above decides WHEN a part shouts; this decides how much to buy when it
          does. Both are what get adjusted when stock goes wrong, so both carry
          a reason and a history rather than quietly changing. */}
      <div className="card">
        <div className="table-head">
          <h2>How much should be ordered?</h2>
        </div>
        <p className="muted">
          Written in plain words rather than a fixed quantity, because the right amount
          depends on the usage the buyer is looking at when they place the order.
        </p>
        <form className="stack" action={setPartOrderMonths}>
          <input type="hidden" name="id" value={id} />
          <label>How many months of usage to order
            <textarea name="months_of_usage_to_order" rows={3}
              defaultValue={details.months_of_usage_to_order || ''} />
          </label>
          <label>Why are you changing it? (saved to the history below)
            <input name="order_months_note" />
          </label>
          <ActionButton busyLabel="Saving…" doneLabel="Saved">Save order amount</ActionButton>
        </form>
      </div>

      <OrderMonthsHistory partId={id} />

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
            <label>Lead min days<input name="lead_time_days_min" type="number" step="0.01" defaultValue={details.lead_time_days_min || 0} /></label>
            <label>Lead max days<input name="lead_time_days_max" type="number" step="0.01" defaultValue={details.lead_time_days_max || 0} /></label>
            <label>Safety days<input name="safety_stock_days" type="number" step="0.01" defaultValue={details.safety_stock_days || 0} /></label>
          </div>
          <div className="form-row">
            {/* Free text, not a number: "3 months" and "6 if they hold the
                price" are both real answers, and this is a note for whoever
                places the order rather than something that triggers. */}
          </div>
          <div className="form-row">
            {/* Dropdowns, not checkboxes: an unticked checkbox sends nothing at
                all, so archiving from this form could never actually save. */}
            <label className="compact">Is it tracked?
              {/* Tracked parts are reordered from the forecast and a zero report
                  on one is an alarm. Untracked parts are reordered when the
                  warehouse asks, and their reports are jobs, not failures. */}
              <StickySelect name="tracked" value={details.tracked === false ? 'false' : 'true'}>
                <option value="true">Tracked — reorder from the forecast</option>
                <option value="false">Not tracked — reorder when the warehouse asks</option>
              </StickySelect>
            </label>
            <label className="compact">Critical part
              <StickySelect name="critical" value={details.critical ? 'yes' : 'no'}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </StickySelect>
            </label>
            <label className="compact">Status
              <StickySelect name="active" value={details.active ? 'on' : 'off'}>
                <option value="on">Active</option>
                <option value="off">Archived</option>
              </StickySelect>
            </label>
          </div>
          <ActionButton busyLabel="Saving…" doneLabel="Saved">Save part</ActionButton>
        </form>

        <hr />

        <div className="table-head">
          <h3>Suppliers</h3>
          <span className="badge info">{supplierRows.length} on file</span>
        </div>
        <p className="muted small">
          The part number, unit, price and minimum order belong to each supplier, so a
          backup can carry its own terms.
        </p>

        {supplierRows.map((row: any) => (
          <SupplierRow
            key={row.id}
            partId={id}
            row={row}
            supplier={row.supplier_id ? supplierById.get(row.supplier_id) || null : null}
            supplierOptions={supplierOptions}
            isPrimary={row.is_primary}
          />
        ))}

        {supplierRows.length === 0 && (
          <SupplierRow partId={id} row={null} supplier={null} supplierOptions={supplierOptions} isPrimary />
        )}

        <div className="action-row wrap">
          <details className="mini-add">
            <summary className="button small-btn secondary">+ Add backup supplier</summary>
            <form className="stack card flat" action={savePartSupplier}>
              <input type="hidden" name="part_id" value={id} />
              <div className="form-row">
                <label>Supplier
                  <SearchSelect name="supplier_id" placeholder="Pick a supplier" options={supplierOptions}
                    actionOption={{ label: '+ Add a new supplier', targetId: 'new-supplier-panel' }} />
                </label>
                <label>Supplier part number or name<input name="supplier_part_number" /></label>
                <label>Unit<input name="unit" placeholder="Box of 250 pcs" /></label>
              </div>
              <div className="form-row">
                <label>Usual unit price<input name="unit_price" placeholder="36.31 a box" /></label>
                <label>Min order quantity<input name="moq" placeholder="500, or 250 if they split it" /></label>
              </div>
              <div className="action-row"><ActionButton className="small-btn" busyLabel="Adding…" doneLabel="Added">Add supplier</ActionButton><button type="button" className="button secondary cancel-btn">Cancel</button></div>
            </form>
          </details>

          {/* Opened either from this button or by picking "Add a new supplier"
              inside any of the supplier dropdowns above. */}
          <details className="mini-add" id="new-supplier-panel">
            <summary className="button small-btn secondary">+ Add a new supplier</summary>
            <form className="stack card flat" action={createSupplier}>
              <div className="form-row">
                <label>Name<input name="name" required /></label>
                <label>Contact name<input name="contact_name" /></label>
              </div>
              <div className="form-row">
                <label>Email<input name="email" /></label>
                <label>Phone<input name="phone" /></label>
                <label>Website / supplier link<input name="website" /></label>
              </div>
              <label>Notes<textarea name="notes" placeholder="MOQ, shipping rules, price notes, backup contact, prepared message, etc." /></label>
              <div className="action-row"><ActionButton className="small-btn" busyLabel="Creating…" doneLabel="Supplier created">Create supplier</ActionButton><button type="button" className="button secondary cancel-btn">Cancel</button></div>
              <p className="muted small">Once created, pick them in the supplier box above and save.</p>
            </form>
          </details>
        </div>

        <hr />

        <form className="stack" action={updatePartDetails}>
          <input type="hidden" name="id" value={id} />
          <label>Instructions and info to send to the supplier
            <textarea name="supplier_order_instructions" rows={10}
              defaultValue={details.supplier_order_instructions || ''} />
          </label>
          <ActionButton busyLabel="Saving…" doneLabel="Saved">Save instructions</ActionButton>
        </form>

        <div className="mini-sections">
          <div className="mini-section">
            <div className="table-head">
              <h3>Photos</h3>
              <span className="badge info">{files.length}</span>
            </div>
            <ul className="mini-list">
              {files.map((f: any) => (
                <li key={f.id} data-confirm-label={f.file_name}>
                  <a className="link" href={'/api/part-files/' + f.id}>{f.file_name}</a>
                  {f.caption && <span className="muted small">{f.caption}</span>}
                  {f.send_to_supplier && <span className="badge info">send to supplier</span>}
                  <form className="inline-form push-right" action={deletePartFile}>
                    <input type="hidden" name="part_id" value={id} />
                    <input type="hidden" name="file_id" value={f.id} />
                    <ActionButton className="small-btn danger" busyLabel="…" doneLabel="Removed">Remove</ActionButton>
                  </form>
                </li>
              ))}
              {files.length === 0 && <li className="muted small">Nothing uploaded yet.</li>}
            </ul>
            <details className="mini-add">
              <summary className="button small-btn secondary">+ Add photo</summary>
              <form className="stack card flat" action={uploadPartFile}>
                <input type="hidden" name="part_id" value={id} />
                <input type="hidden" name="kind" value="reference_photo" />
                <label>File<PhotoInput name="file" required /></label>
                <label>Caption<input name="caption" placeholder="Colour reference — match this exactly" /></label>
                <label className="checkbox"><input name="send_to_supplier" type="checkbox" defaultChecked />Send this one to the supplier</label>
                <div className="action-row"><ActionButton className="small-btn" busyLabel="Uploading…" doneLabel="Uploaded">Upload</ActionButton><button type="button" className="button secondary cancel-btn">Cancel</button></div>
              </form>
            </details>
          </div>

          <div className="mini-section">
            <div className="table-head">
              <h3>Links</h3>
              <span className="badge info">{links.length}</span>
            </div>
            <ul className="mini-list">
              {links.map((l: any) => (
                <li key={l.id} data-confirm-label={l.label || l.url}>
                  <a className="link" href={l.url} target="_blank" rel="noreferrer">{l.label || l.url}</a>
                  {l.label && <span className="muted small">{l.url}</span>}
                  <form className="inline-form push-right" action={deletePartLink}>
                    <input type="hidden" name="part_id" value={id} />
                    <input type="hidden" name="row_id" value={l.id} />
                    <ActionButton className="small-btn danger" busyLabel="…" doneLabel="Removed">Remove</ActionButton>
                  </form>
                </li>
              ))}
              {links.length === 0 && <li className="muted small">No links yet.</li>}
            </ul>
            <details className="mini-add">
              <summary className="button small-btn secondary">+ Add link</summary>
              <form className="stack card flat" action={savePartLink}>
                <input type="hidden" name="part_id" value={id} />
                <label>What is it?<input name="label" placeholder="Where we buy it" /></label>
                <label>Link<input name="url" required placeholder="https://..." /></label>
                <div className="action-row"><ActionButton className="small-btn" busyLabel="Adding…" doneLabel="Added">Add link</ActionButton><button type="button" className="button secondary cancel-btn">Cancel</button></div>
              </form>
            </details>
          </div>
        </div>

        <hr />
        <form action={archivePart} className="inline-form">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="active" value={details.active ? 'false' : 'true'} />
          <ActionButton className="danger" confirm={details.active ? 'Archive ' + details.name + '?' : 'Restore ' + details.name + '?'} busyLabel="…" doneLabel="Done">
            {details.active ? 'Archive part' : 'Restore part'}
          </ActionButton>
        </form>
      </div>

      <div className="card table-card">
        <div className="table-head"><h2>Incoming shipments for this part</h2><Link className="button small-btn secondary" href="/shipments">All shipments</Link></div>
        <table><thead><tr><th>PO</th><th>Supplier</th><th>Expected</th><th>Remaining</th><th>Tracking</th><th></th></tr></thead><tbody>{(incoming || []).map((i: any) => <tr key={i.purchase_order_item_id}><td><Link className="link" href={'/shipments/' + i.purchase_order_id}>{i.po_number}</Link></td><td>{i.supplier_name}</td><td>{date(i.expected_date)}</td><td>{num(i.remaining_qty)}</td><td>{i.tracking_number}</td><td><Link className="button small-btn secondary" href={'/shipments/' + i.purchase_order_id}>Open</Link></td></tr>)}{(incoming || []).length === 0 && <tr><td colSpan={6}><div className="empty-state">No incoming shipments.</div></td></tr>}</tbody></table>
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
