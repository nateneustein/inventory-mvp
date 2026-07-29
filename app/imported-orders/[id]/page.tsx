import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { updateImportedOrderRow, deleteImportedOrderRow, voidImportedOrderRow, unvoidImportedOrderRow } from '@/lib/actions'
import { date, num } from '@/lib/format'
import { ActionButton } from '@/components/action-button'
import { SearchSelect } from '@/components/search-select'
import { VOID_REASONS } from '@/lib/void-reasons'

export default async function ImportedOrderRowPage({ params, searchParams }: { params: Promise<{ id: string }>, searchParams?: Promise<{ notice?: string, error?: string }> }) {
  const { id } = await params
  const sp = searchParams ? await searchParams : {}
  const { supabase } = await requireUser()
  const { data: row } = await supabase.from('imported_order_rows').select('*, upload_batches(file_name), mapped:product_variations!imported_order_rows_mapped_variation_id_fkey(internal_sku, variation_name, products(name)), demand:product_variations!imported_order_rows_demand_variation_id_fkey(internal_sku, variation_name, products(name))').eq('id', id).single()
  const { data: variations } = await supabase.from('product_variations').select('id, internal_sku, variation_name, products(name)').order('internal_sku')

  // What this one line actually took off the shelf. Shown before voiding so it
  // is obvious what comes back, and after voiding to prove nothing is left.
  const { data: movements } = await supabase
    .from('inventory_movements')
    .select('id, quantity, movement_date, parts(name, sku)')
    .eq('source_type', 'imported_order_row')
    .eq('source_id', id)

  if (!row) return <div className="card"><h1>Imported row not found</h1><Link className="button" href="/imported-orders">Back</Link></div>
  const raw = row.raw_data || {}
  const isVoided = !!row.voided_at
  const consumed = movements || []

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Imported order row</h1>
          <p className="muted">Source row from {row.platform} · {row.account_name}</p>
        </div>
        <Link className="button secondary" href="/imported-orders">Back to imported orders</Link>
      </div>

      {sp.notice && <div className="card success-soft"><strong>{sp.notice}</strong></div>}
      {sp.error && <div className="card danger-soft"><strong>{sp.error}</strong></div>}

      {isVoided && (
        <div className="card voided-banner">
          <div>
            <span className="badge voided">voided</span>{' '}
            <strong>This line does not count as a sale.</strong>{' '}
            {row.void_reason || 'No reason given'} · voided {date(row.voided_at)}
            {row.void_note && <><br /><span className="muted">{row.void_note}</span></>}
          </div>
          <form action={unvoidImportedOrderRow}>
            <input type="hidden" name="id" value={id} />
            <ActionButton className="secondary" confirm="Put this line back in play?" busyLabel="…" doneLabel="Restored">Un-void this line</ActionButton>
          </form>
        </div>
      )}

      <div className="grid two">
        <div className="card">
          <h2>Order details</h2>
          <dl className="detail-list"><div><dt>Import status</dt><dd><span className={`badge ${row.dedupe_status === 'duplicate' ? 'ignored' : 'ok'}`}>{row.dedupe_status || 'new'}</span></dd></div><div><dt>Line key</dt><dd>{row.external_line_key}</dd></div><div><dt>Line key source</dt><dd>{row.external_line_key_source}</dd></div><div><dt>Order ID</dt><dd>{row.platform_order_id}</dd></div><div><dt>Date</dt><dd>{date(row.order_date_parsed || row.order_date)}</dd></div><div><dt>Week start</dt><dd>{date(row.week_start)}</dd></div><div><dt>SKU</dt><dd>{row.platform_sku}</dd></div><div><dt>Qty</dt><dd>{num(row.quantity)}</dd></div><div><dt>Item</dt><dd>{row.item_name}</dd></div><div><dt>Variation</dt><dd>{row.variation_text}</dd></div><div><dt>Customization</dt><dd>{row.customization_text}</dd></div><div><dt>Status</dt><dd>{row.order_status}</dd></div><div><dt>File</dt><dd>{row.upload_batches?.file_name}</dd></div></dl>
        </div>
        <div className="card">
          <h2>Mapping / review</h2>{row.dedupe_status === 'duplicate' && <div className="card alert"><strong>Duplicate line:</strong> This row came from an overlapping upload and is ignored so it does not count twice. Keep it ignored unless you are sure this is a separate real line.</div>}
          <form className="stack" action={updateImportedOrderRow}>
            <input type="hidden" name="id" value={id}/>
            <label>Mapping status<select name="mapping_status" defaultValue={row.mapping_status}><option value="unmapped">Unmapped</option><option value="mapped">Mapped</option><option value="needs_review">Needs review</option><option value="ignored">Ignored</option></select></label>
            <label>Actual variation used<SearchSelect name="mapped_variation_id" defaultValue={row.mapped_variation_id || ''} placeholder="Type a product or variation" options={(variations || []).map((v: any) => ({ value: v.id, label: `${v.variation_name || ''} · ${v.products?.name || ''}`, hint: v.internal_sku }))} /></label>
            <label>Demand variation<SearchSelect name="demand_variation_id" defaultValue={row.demand_variation_id || ''} placeholder="Same as actual" options={(variations || []).map((v: any) => ({ value: v.id, label: `${v.variation_name || ''} · ${v.products?.name || ''}`, hint: v.internal_sku }))} /></label>
            <ActionButton busyLabel="Saving…" doneLabel="Saved">Save mapping</ActionButton>
          </form>
          <form action={deleteImportedOrderRow}><input type="hidden" name="id" value={id}/><ActionButton className="danger" confirm="Permanently delete this source row?" busyLabel="Deleting…" doneLabel="Deleted">Delete imported row</ActionButton></form>
        </div>
      </div>

      <div className="card">
        <h2>{isVoided ? 'Void' : 'Void this line'}</h2>
        <p className="muted">
          Use this when the line is real but should not count as a sale — a replacement you sent
          free, a refund, a sample. The line stays here with its mapping intact, stops counting as
          demand, and any parts it already used go back on the shelf. This is different from
          <strong> Delete</strong>, which throws the source row away, and from
          <strong> Ignored</strong>, which just means it was never mapped.
        </p>

        {consumed.length > 0 ? (
          <div className="wide-table"><table>
            <thead><tr><th>Part</th><th>SKU</th><th>Date</th><th>Qty taken</th></tr></thead>
            <tbody>{consumed.map((m: any) => (
              <tr key={m.id}><td>{m.parts?.name}</td><td className="sku-cell">{m.parts?.sku}</td><td>{date(m.movement_date)}</td><td>{num(m.quantity)}</td></tr>
            ))}</tbody>
          </table></div>
        ) : (
          <p className="muted small">
            {isVoided
              ? 'This line is not holding any stock. Nothing left to give back.'
              : 'This line has not consumed any stock yet, so voiding it only stops it counting later.'}
          </p>
        )}

        {!isVoided && (
          <form className="stack" action={voidImportedOrderRow}>
            <input type="hidden" name="id" value={id} />
            <div className="form-row">
              <label>Reason
                <select name="void_reason" defaultValue="Replacement sent">
                  {VOID_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label>Note (optional)<input name="void_note" placeholder="Broken in transit, resent 07/12" /></label>
            </div>
            <ActionButton className="danger" confirm="Confirm: void this line?" busyLabel="Voiding…" doneLabel="Voided">
              {consumed.length > 0 ? `Void line and put ${consumed.length} part(s) back` : 'Void this line'}
            </ActionButton>
          </form>
        )}
      </div>

      <div className="card table-card"><div className="table-head"><h2>Raw source data</h2></div><table><thead><tr><th>Column</th><th>Value</th></tr></thead><tbody>{Object.entries(raw).map(([k,v]) => <tr key={k}><td>{k}</td><td>{String(v)}</td></tr>)}</tbody></table></div>
    </>
  )
}
