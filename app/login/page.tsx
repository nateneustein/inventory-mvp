import { signIn } from '@/lib/actions'

export default async function LoginPage({ searchParams }: { searchParams?: Promise<{ error?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const error = params.error

  return (
    <div className="card" style={{ maxWidth: 440 }}>
      <h1>Sign in</h1>
      <p className="muted">Use the employee email/password created in Supabase Auth.</p>
      {error && <p className="error">{decodeURIComponent(error)}</p>}
      <form className="stack" action={signIn}>
        <label>
          Email
          <input name="email" type="email" required />
        </label>
        <label>
          Password
          <input name="password" type="password" required />
        </label>
        <button type="submit">Sign in</button>
      </form>
    </div>
  )
}
