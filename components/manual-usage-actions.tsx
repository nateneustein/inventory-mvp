import { updateManualUnitsSold, archiveManualUnitsSold, deleteManualUnitsSold } from '@/lib/record-actions'
import { num, date } from '@/lib/format'

function variationLabel(v:any) {
  return `${v.variation_name || ''} · ${v.products?.name || ''}`
}

export function ManualUsageRows({ rows, variations }: { rows: any[], variations: any[] }) {
  return (
    <>
      {(rows || []).map((r:any)=>(
        <tr key={r.id}>
          <td>{date(r.sale_date)}</td>
          <td>{date(r.week_start)}</td>
          <td className="name-cell">{r.product_variations?.variation_name}<span className="sku-under">{r.product_variations?.products?.name} · {r.product_variations?.internal_sku}</span></td>
          <td>{num(r.quantity)}</td>
          <td>{r.order_reference}</td>
          <td>{r.reason}</td>
          <td>{r.notes}</td>
          <td>
            <details>
              <summary className="button small-btn secondary">Edit</summary>
              <form className="stack card flat" action={updateManualUnitsSold}>
                <input type="hidden" name="id" value={r.id}/>
                <input type="hidden" name="redirect_to" value="/usage"/>
                <div className="form-row">
                  <label>Variation<select name="variation_id" defaultValue={r.variation_id} required>{(variations || []).map((v:any)=><option key={v.id} value={v.id}>{variationLabel(v)}</option>)}</select></label>
                  <label>Qty<input name="quantity" type="number" step="0.01" defaultValue={r.quantity} required/></label>
                  <label>Date<input name="sale_date" type="date" defaultValue={r.sale_date} required/></label>
                </div>
                <div className="form-row">
                  <label>Reason<select name="reason" defaultValue={r.reason || 'bulk_order_manual_entry'}><option value="bulk_order_manual_entry">Bulk order/manual split</option><option value="missing_from_platform_upload">Missing from platform upload</option><option value="correction">Correction</option><option value="other">Other</option></select></label>
                  <label>Order/reference<input name="order_reference" defaultValue={r.order_reference || ''}/></label>
                </div>
                <label>Notes<textarea name="notes" defaultValue={r.notes || ''}/></label>
                <div className="action-row"><button type="submit">Save edit</button><button type="button" className="button secondary cancel-btn">Cancel</button></div>
              </form>
              <div className="action-row">
                <form action={archiveManualUnitsSold}><input type="hidden" name="id" value={r.id}/><input type="hidden" name="redirect_to" value="/usage"/><button className="small-btn ghost" type="submit">Archive</button></form>
                <form action={deleteManualUnitsSold}><input type="hidden" name="id" value={r.id}/><input type="hidden" name="redirect_to" value="/usage"/><button className="small-btn danger" type="submit">Remove</button></form>
              </div>
            </details>
          </td>
        </tr>
      ))}
    </>
  )
}
