'use client'

import { useFormStatus } from 'react-dom'

/**
 * A submit button that shows it is working.
 *
 * Confirmation is NOT handled here any more. The first version did it in-page
 * with a two-step "click again" button, and the second click never actually
 * submitted: the same click bubbled to a document listener that disarmed the
 * button, React swapped the element, and the submission was lost. Confirmation
 * now lives in <FormGuard>, which uses a real browser dialog with a working
 * Cancel and covers every form in the app, not just the ones wired up here.
 *
 * `confirm` is still accepted and is passed through as data-confirm so the
 * guard can use the specific wording.
 */
export function ActionButton({
  children,
  className = '',
  title,
  confirm,
  disabled = false,
  busyLabel = 'Working…',
}: {
  children: React.ReactNode
  className?: string
  title?: string
  confirm?: string
  disabled?: boolean
  busyLabel?: string
  /** Accepted for compatibility with earlier call sites; no longer rendered. */
  doneLabel?: string
}) {
  const { pending } = useFormStatus()

  return (
    <button
      className={pending ? `${className} is-busy` : className}
      type="submit"
      title={title}
      disabled={disabled || pending}
      data-confirm={confirm}
      data-busy-label={busyLabel}
    >
      {pending ? busyLabel : children}
    </button>
  )
}
