import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { saveBomMatrix } from '@/lib/actions'
import { num } from '@/lib/format'

function variationLabel(v:any) {
  return `${v.products?.name || ''} · ${v.variation_name || ''} · ${v.internal_sku || ''}`
}

function zoomValue(raw?: string) {
  const allowed = ['50', '60', '70', '80', '90', '100', '125', '150']
  return allowed.includes(raw || '') ? raw || '100' : '100'
}
function bomsHref(params:any, zoom:string) {
  const query = new URLSearchParams()
  if (params.q) query.set('q', params.q)
  query.set('zoom', zoom)
  return `/boms?${query.toString()}`
}

export default async function BomsPage({ searchParams }: { searchParams?: Promise<{ q?: string, zoom?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = (params.q || '').toLowerCase()
  const zoom = zoomValue(params.zoom)
  const { supabase } = await requireUser()
  const { data: allVariations } = await supabase.from('product_variations').select('id, variation_name, internal_sku, product_id, active, products(name)').order('internal_sku')
  const { data: allParts } = await supabase.from('parts').select('id, name, sku, active').order('sku')
  const { data: allBomItems } = await supabase.from('bom_items').select('variation_id, part_id, quantity_per_unit')

  const parts = (allParts || []).filter((p:any) => p.active !== false)
  const variations = (allVariations || []).filter((v:any) => v.active !== false && (!q || variationLabel(v).toLowerCase().includes(q)))
  const bomMap = new Map<string, number>()
  for (const item of allBomItems || []) bomMap.set(`${item.variation_id}__${item.part_id}`, Number(item.quantity_per_unit || 0))

  return (
    <>
      <div className="page-head"><div><h1>BOM / Master File</h1><p className="muted">Spreadsheet-style recipe sheet. Rows are finished products/variations, columns are parts. Edit quantities and click save.</p></div><Link className="button secondary" href="/products">Products</Link></div>
      <div className="card"><form className="filter-bar" action="/boms"><label>Search finished products<input name="q" defaultValue={params.q || ''} placeholder="Product, variation, internal SKU" /></label><button type="submit">Filter</button><Link className="button ghost" href="/boms">Clear</Link></form></div>

      <form action={saveBomMatrix}>
        <div className="card table-card">
          <div className="table-head"><div><h2>Master BOM grid</h2><p className="muted small">Blank or 0 means this part is not used. Quantities can be decimals like 0.08 or 1.08.</p></div><div className="table-tools"><div className="zoom-controls"><span>Zoom</span>{['50','60','70','80','90','100','125','150'].map(z => <Link key={z} className={`button small-btn ${zoom === z ? '' : 'secondary'}`} href={bomsHref(params, z)}>{z}%</Link>)}</div><button type="submit">Save BOM sheet</button></div></div>
          <div className={`wide-table sheet-scroll sheet-sticky-head sheet-zoom-${zoom} bom-grid`}><table>
            <thead><tr><th className="sticky-col product-col">Finished product / variation</th>{parts.map((p:any)=><th key={p.id} title={`${p.sku} · ${p.name}`}>{p.name}<br/><span className="muted small">{p.sku}</span></th>)}</tr></thead>
            <tbody>
              {variations.map((v:any) => <tr key={v.id}><td className="sticky-col product-col"><Link className="link" href={`/products/${v.product_id}`}>{v.products?.name}</Link><br/><strong>{v.variation_name}</strong><br/><span className="muted small">{v.internal_sku}</span></td>{parts.map((p:any) => { const current = bomMap.get(`${v.id}__${p.id}`) || 0; return <td key={p.id}><input className="tiny-input" name={`bom__${v.id}__${p.id}`} type="number" step="0.0001" min="0" defaultValue={current ? num(current, 4) : ''} /></td> })}</tr>)}
              {variations.length === 0 && <tr><td colSpan={parts.length + 1}><div className="empty-state">No variations match this search.</div></td></tr>}
            </tbody>
          </table></div>
        </div>
      </form>
    </>
  )
}
