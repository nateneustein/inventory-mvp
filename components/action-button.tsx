'use client'

import { useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'

/**
 * A submit button that tells you what it is doing.
 *
 * Server actions give no feedback of their own: you click "Apply rules to
 * existing rows", nothing visibly happens for several seconds, so you click
 * again. This button goes disabled and says "Working…" while the action runs,
 * then flashes "Done" so you know it landed.
 *
 * Pass `confirm` to make it two-step. The first click arms it and the label
 * changes to the confirm text (which should name what is about to happen);
 * only the second click submits. Clicking anywhere else disarms it, so a
 * mis-click costs nothing.
 *
 * Must live inside the <form> it submits — useFormStatus reads the nearest
 * enclosing form.
 */
export function ActionButton({
  children,
  className = '',
  title,
  confirm,
  disabled = false,
  busyLabel = 'Working…',
  doneLabel = 'Done',
}: {
  children: React.ReactNode
  className?: string
  title?: string
  confirm?: string
  disabled?: boolean
  busyLabel?: string
  doneLabel?: string
}) {
  const { pending } = useFormStatus()
  const [armed, setArmed] = useState(false)
  const [done, setDone] = useState(false)
  const wasPending = useRef(false)

  // "Done" is the falling edge of pending. If the action redirects we unmount
  // before this ever runs, which is fine — the new page is the feedback.
  useEffect(() => {
    if (wasPending.current && !pending) {
      setDone(true)
      setArmed(false)
      wasPending.current = pending
      const timer = setTimeout(() => setDone(false), 2500)
      return () => clearTimeout(timer)
    }
    wasPending.current = pending
  }, [pending])

  // Any click elsewhere on the page cancels a pending confirmation. The
  // timeout skips the click that armed it in the first place.
  useEffect(() => {
    if (!armed) return
    const disarm = () => setArmed(false)
    const timer = setTimeout(() => document.addEventListener('click', disarm, { once: true }), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', disarm)
    }
  }, [armed])

  if (disabled) {
    return <button className={className} type="submit" title={title} disabled>{children}</button>
  }

  if (pending) {
    return <button className={`${className} is-busy`} type="submit" disabled>{busyLabel}</button>
  }

  if (done) {
    return <button className={`${className} is-done`} type="button" disabled>{doneLabel} ✓</button>
  }

  if (confirm && !armed) {
    return (
      <button
        className={className}
        type="button"
        title={title}
        onClick={(e) => { e.preventDefault(); setArmed(true) }}
      >
        {children}
      </button>
    )
  }

  if (confirm && armed) {
    return (
      <button className={`${className} is-armed`} type="submit" title="Click again to confirm">
        {confirm}
      </button>
    )
  }

  return <button className={className} type="submit" title={title}>{children}</button>
}
