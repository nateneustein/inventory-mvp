'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'

/**
 * Says out loud that a change was refused.
 *
 * Row-level security makes a forbidden edit quietly do nothing: the form posts,
 * the row does not move, and the page comes back looking the way it always did.
 * That is safe, but it reads exactly like success - and a person who thinks they
 * changed a lead time when they did not is worse off than one who was told no.
 *
 * Any action that refuses on permission sends the person back with ?denied=<what>,
 * and this turns that into a plain sentence. It lives in the layout, so one banner
 * covers every screen.
 */
export function PermissionBanner() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const denied = params.get('denied')
  if (!denied) return null

  const dismiss = () => {
    const next = new URLSearchParams(params.toString())
    next.delete('denied')
    const qs = next.toString()
    router.replace(qs ? pathname + '?' + qs : pathname)
  }

  return (
    <div className="denied-banner" role="alert">
      <div>
        <strong>Not saved - your account is not allowed to {denied}.</strong>
        <p>
          Nothing was changed. The screen may still show what you typed until you reload,
          so do not treat it as done. Ask a manager or an admin to make this change.
        </p>
      </div>
      <button type="button" className="button secondary small-btn" onClick={dismiss}>Dismiss</button>
    </div>
  )
}
