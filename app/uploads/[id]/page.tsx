import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { deleteUploadBatch } from '@/lib/actions'
import { date, num } from '@/lib/format'

export default async function UploadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireUser()
  const { data: batch } = await supabase.from('upload_batches').select('*').eq('id', id).single()
  const { data: rows } = await supabase.from('imported_order_rows').select('*').eq('upload_batch_id', id).order('source_row_number').limit(300)
  if (!batch) return <div className="card"><h1>Upload not found</h1><Link className="button" href="/uploads">Back</Link></div>

  const duplicateRows = (rows || []).filter((r:any) => r.dedupe_status === 'duplicate').length
  const newRows = (rows || []).length - duplicateRows

  return (
    <>
      <div className="page-head"><div><h1>{batch.file_name}</h1><p className="muted">{batch.platform} · {batch.account_name} · uploaded {date(batch.created_at)}</p></div><div className="action-row"><Link className="button secondary" href="/uploads">Back</Link><form action={deleteUploadBatch}><input type="hidden" name="id" value={id}/><button className="danger" type="submit">Delete upload</button></form></div></div>
      <div className="grid"><div className="card kpi-card"><div className="muted">Rows</div><div className="kpi">{batch.row_count}</div></div><div className="card kpi-card"><div className="muted">New order lines</div><div className="kpi">{newRows}</div></div><div className="card kpi-card"><div className="muted">Duplicates skipped</div><div className="kpi">{duplicateRows}</div></div><div className="card kpi-card"><div className="muted">Status</div><div className="kpi"><span className="badge info">{batch.status}</span></div></div></div>
      <div className="card table-card"><div className="table-head"><h2>Rows from this upload</h2><Link className="button small-btn secondary" href="/imported-orders">All imported rows</Link></div><div className="wide-table"><table><thead><tr><th>#</th><th>Import status</th><th>Order</th><th>Line key</th><th>SKU</th><th>Qty</th><th>Item</th><th>Variation</th><th>Mapping</th><th></th></tr></thead><tbody>{(rows || []).map((r:any)=><tr key={r.id} className={r.dedupe_status === 'duplicate' ? 'muted-row' : ''}><td>{r.source_row_number}</td><td><span className={`badge ${r.dedupe_status === 'duplicate' ? 'ignored' : 'ok'}`}>{r.dedupe_status || 'new'}</span></td><td><Link className="link" href={`/imported-orders/${r.id}`}>{r.platform_order_id}</Link></td><td><span className="small muted">{r.external_line_key}</span></td><td>{r.platform_sku}</td><td>{num(r.quantity)}</td><td>{r.item_name}</td><td>{r.variation_text}</td><td><span className={`badge ${r.mapping_status}`}>{r.mapping_status}</span></td><td><Link className="button small-btn secondary" href={`/imported-orders/${r.id}`}>Open</Link></td></tr>)}{(rows || []).length === 0 && <tr><td colSpan={10}><div className="empty-state">No rows found for this upload.</div></td></tr>}</tbody></table></div></div>
    </>
  )
}
