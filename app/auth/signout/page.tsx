import { signOut } from '@/lib/actions'

export default function SignOutPage() {
  return (
    <form action={signOut}>
      <button type="submit">Confirm sign out</button>
    </form>
  )
}
