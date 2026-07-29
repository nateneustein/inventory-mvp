import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { createSupplier, deleteSupplier } from '@/lib/actions'

function includesSupplier(s:any, q:string) {
  return `${s.name||''} ${s.contact_name||''} ${s.email||''} ${s.phone||''} ${s.website||''} ${s.notes||''}`.toLowerCase().includes(q.toLowerCase())
}

export default async function SuppliersPage({ searchParams }: { searchParams?: Promise<{ q?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = params.q || ''
  const { supabase } = await requireUser()
  const { data: allSuppliers } = await supabase.from('suppliers').select('*').order('name')
  const suppliers = (allSuppliers || []).filter((s:any) => !q || includesSupplier(s, q))

  return (
    <>
      <div className="page-head"><div><h1>Suppliers</h1><p className="muted">Central place for supplier contact details, ordering rules, pricing notes, and linked parts.</p></div></div>

      <div className="card"><form className="filter-bar" action="/suppliers"><label>Search suppliers<input name="q" defaultValue={q} placeholder="Supplier, email, notes, website" /></label><button type="submit">Filter</button><Link className="button ghost" href="/suppliers">Clear</Link></form></div>

      <div className="card">
        <details className="add-panel"><summary className="button">+ Add supplier</summary></details>
        <form className="stack" action={createSupplier}>
          <div className="form-row"><label>Name<input name="name" required /></label><label>Contact name<input name="contact_name" /></label></div>
          <div className="form-row"><label>Email<input name="email" /></label><label>Phone<input name="phone" /></label><label>Website / supplier link<input name="website" /></label></div>
          <label>Notes<textarea name="notes" placeholder="MOQ, shipping rules, price notes, backup contact, prepared message, etc." /></label>
          <button type="submit">Add supplier</button><button type="button" className="button secondary cancel-btn">Cancel</button>
        </form>
      </div>

      <div className="card table-card">
        <div className="table-head"><h2>Supplier list</h2><span className="badge info">{suppliers.length} shown</span></div>
        <div className="wide-table"><table>
          <thead><tr><th>Name</th><th>Contact</th><th>Email</th><th>Phone</th><th>Website</th><th>Notes</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {suppliers.map((s: any) => (
              <tr key={s.id}>
                <td><Link className="link" href={`/suppliers/${s.id}`}>{s.name}</Link></td><td>{s.contact_name}</td><td>{s.email}</td><td>{s.phone}</td><td>{s.website && <a className="link" href={s.website}>{s.website}</a>}</td><td>{s.notes}</td>
                <td><div className="action-row"><Link className="button small-btn secondary" href={`/suppliers/${s.id}`}>Open</Link><form className="inline-form" action={deleteSupplier}><input type="hidden" name="id" value={s.id} /><button className="small-btn danger" type="submit">Delete</button></form></div></td>
              </tr>
            ))}
            {suppliers.length === 0 && <tr><td colSpan={7}><div className="empty-state">No suppliers match this search.</div></td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
