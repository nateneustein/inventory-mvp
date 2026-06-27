import { requireUser } from '@/lib/require-user'
import { createSupplier } from '@/lib/actions'

export default async function SuppliersPage() {
  const { supabase } = await requireUser()
  const { data: suppliers } = await supabase.from('suppliers').select('*').order('name')

  return (
    <>
      <h1>Suppliers</h1>
      <p className="muted">Central place for where to buy each part, notes, supplier rules, and contact details.</p>

      <div className="card">
        <h2>Add supplier</h2>
        <form className="stack" action={createSupplier}>
          <div className="form-row">
            <label>Name<input name="name" required /></label>
            <label>Contact name<input name="contact_name" /></label>
          </div>
          <div className="form-row">
            <label>Email<input name="email" type="email" /></label>
            <label>Phone<input name="phone" /></label>
            <label>Website / supplier link<input name="website" /></label>
          </div>
          <label>Notes<textarea name="notes" placeholder="MOQ, shipping rules, price notes, backup contact, etc." /></label>
          <button type="submit">Add supplier</button>
        </form>
      </div>

      <div className="card">
        <h2>Supplier list</h2>
        <table>
          <thead><tr><th>Name</th><th>Contact</th><th>Email</th><th>Phone</th><th>Website</th><th>Notes</th></tr></thead>
          <tbody>
            {(suppliers || []).map((s: any) => (
              <tr key={s.id}>
                <td>{s.name}</td><td>{s.contact_name}</td><td>{s.email}</td><td>{s.phone}</td><td>{s.website}</td><td>{s.notes}</td>
              </tr>
            ))}
            {(suppliers || []).length === 0 && <tr><td colSpan={6}>No suppliers yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
