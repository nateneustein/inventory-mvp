import { requireUser } from '@/lib/require-user'
import { createReplacementOrder } from '@/lib/actions'
import { date, num } from '@/lib/format'
import { SearchSelect } from '@/components/search-select'
import { rowMatches } from '@/lib/search'

export default async function ReplacementsPage({ searchParams }: { searchParams?: Promise<{ q?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = params.q || ''
  const { supabase } = await requireUser()
  const { data: variations } = await supabase
    .from('product_variations')
    .select('id, variation_name, internal_sku, products(name)')
    .order('internal_sku')
  const { data: replacements } = await supabase
    .from('replacement_orders')
    .select('*, product_variations(internal_sku, variation_name, products(name))')
    .order('created_at', { ascending: false })
    .limit(100)

  const shown = (replacements || []).filter((r: any) =>
    rowMatches(q, r.original_order_reference, r.product_variations?.internal_sku,
      r.product_variations?.variation_name, r.product_variations?.products?.name,
      r.reason, r.approved_by, r.notes))

  return (
    <>
      <h1>Replacement Orders</h1>
      <p className="muted">Replacements consume inventory like normal orders so stock does not quietly disappear.</p>

      <div className="card">
        <details className="add-panel"><summary className="button">+ Add replacement</summary></details>
        <form className="stack" action={createReplacementOrder}>
          <div className="form-row">
            <label>Original order reference<input name="original_order_reference" placeholder="Etsy #12345" /></label>
            <label>Variation
              <SearchSelect
                name="variation_id"
                required
                placeholder="Type a product or variation"
                options={(variations || []).map((v: any) => ({
                  value: v.id,
                  label: `${v.variation_name || ''} · ${v.products?.name || ''}`,
                  hint: v.internal_sku,
                }))}
              />
            </label>
            <label>Replacement qty<input name="quantity" type="number" step="0.01" defaultValue="1" required /></label>
          </div>
          <div className="form-row">
            <label>Reason<input name="reason" required placeholder="Broken in shipping, wrong item, etc." /></label>
            <label>Approved by<input name="approved_by" placeholder="Nathan" /></label>
          </div>
          <label>Notes<textarea name="notes" /></label>
          <button type="submit">Create replacement and consume BOM parts</button><button type="button" className="button secondary cancel-btn">Cancel</button>
        </form>
      </div>

      <div className="card table-card">
        <div className="table-head">
          <h2>Recent replacements</h2>
          <div className="table-tools">
            <form className="filter-bar" action="/replacements">
              <input name="q" defaultValue={q} placeholder="Search order, product or reason" aria-label="Search replacements" />
              <button className="small-btn" type="submit">Search</button>
            </form>
            <span className="badge info">{shown.length} shown</span>
          </div>
        </div>
        <table>
          <thead><tr><th>Date</th><th>Original order</th><th>Variation</th><th>Qty</th><th>Reason</th><th>Approved by</th></tr></thead>
          <tbody>
            {shown.map((r: any) => (
              <tr key={r.id}>
                <td>{date(r.created_at)}</td><td>{r.original_order_reference}</td><td className="name-cell">{r.product_variations?.variation_name}<span className="sku-under">{r.product_variations?.internal_sku}</span></td><td>{num(r.quantity)}</td><td>{r.reason}</td><td>{r.approved_by}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6}><div className="empty-state">{q ? 'No replacements match that search.' : 'No replacements yet.'}</div></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
