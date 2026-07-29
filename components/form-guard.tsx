'use client'

import { useEffect } from 'react'

/**
 * One guard for the whole app.
 *
 * Confirmation used to be added button by button, which meant it was only ever
 * as complete as the last sweep — Uploads, Suppliers, Users and Products all
 * still deleted on a single click. This listens once, at the document, so any
 * destructive form anywhere is covered, including pages added later.
 *
 * Two jobs:
 *   1. Ask before anything destructive, with a real browser dialog that names
 *      the row, and Cancel actually cancels.
 *   2. Show the button as busy the moment a form is submitted, so nobody
 *      double-clicks a slow action.
 */

// Verbs that mean "this cannot be casually undone".
const DESTRUCTIVE = /^(delete|remove|archive|void|reverse|un-?void|ignore|restore|purge|clear|reset|discard|scrap|write off|report zero|report damage)\b/i

function labelOf(el: HTMLElement) {
  return (el.textContent || '').replace(/\s+/g, ' ').trim()
}

/** The name of the thing this button sits next to, for the dialog text. */
function contextFor(button: HTMLElement): string {
  const explicit = button.closest('[data-confirm-label]') as HTMLElement | null
  if (explicit?.dataset.confirmLabel) return explicit.dataset.confirmLabel

  const row = button.closest('tr')
  if (row) {
    // The first cell is often a date or a status chip, which says nothing about
    // WHAT is being deleted. Prefer the most descriptive of the leading cells.
    const cells = Array.from(row.querySelectorAll('td')).slice(0, 5)
    const named = cells
      .map((c) => labelOf(c as HTMLElement))
      .filter((t) => t && !/^[\d\s/.,:%$+-]+$/.test(t)
                       && !/^(new line|duplicate|voided|active|inactive|mapped|unmapped|ok|out)$/i.test(t))
    if (named.length) return named.sort((x, y) => y.length - x.length)[0].slice(0, 90)
    const first = cells[0] ? labelOf(cells[0] as HTMLElement) : ''
    if (first) return first.slice(0, 90)
  }

  const heading = button.closest('.card')?.querySelector('h1, h2, h3')
  return heading ? labelOf(heading as HTMLElement).slice(0, 80) : ''
}

function messageFor(button: HTMLElement, form: HTMLFormElement): string | null {
  const explicit = button.getAttribute('data-confirm') || form.getAttribute('data-confirm')
  if (explicit) return explicit
  if (button.getAttribute('data-confirm') === '') return null

  const label = labelOf(button)
  const looksDestructive = DESTRUCTIVE.test(label) || button.classList.contains('danger')
  if (!looksDestructive) return null

  const what = contextFor(button)
  return what ? `${label}\n\n${what}\n\nThis cannot be undone from here. Continue?`
              : `${label}\n\nThis cannot be undone from here. Continue?`
}

export function FormGuard() {
  useEffect(() => {
    function onSubmit(event: Event) {
      const form = event.target as HTMLFormElement
      if (!(form instanceof HTMLFormElement)) return

      // The button that actually submitted. Falls back to the form's first
      // submit control for keyboard submits.
      const submitter = (event as SubmitEvent).submitter as HTMLElement | null
        || form.querySelector('button[type="submit"], button:not([type])')
      if (!submitter) return

      const message = messageFor(submitter, form)
      if (message && !window.confirm(message)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }

      // Mark the button busy WITHOUT rewriting its text. The previous version
      // swapped innerHTML, which React knows nothing about — so a label like
      // "Window saved" could survive the re-render and sit there until the page
      // was reloaded. Styling and disabling are safe; text is left to React.
      const button = submitter as HTMLButtonElement
      if (button.disabled) return
      setTimeout(() => {
        if (!document.body.contains(button)) return
        button.classList.add('is-busy')
        // Anything still sitting here after 4s has either finished quietly or
        // failed; either way the button goes back to normal on its own.
        setTimeout(() => button.classList.remove('is-busy'), 4000)
      }, 0)
    }

    // Cancel puts the boxes back and shuts the panel the form opened in, so a
    // half-typed entry is never left sitting there half-open. Handled here,
    // once, so every panel on every page behaves the same way.
    function onCancel(event: Event) {
      const target = event.target as HTMLElement
      if (!target || !target.closest) return
      const button = target.closest('.cancel-btn') as HTMLElement | null
      if (!button) return
      event.preventDefault()
      event.stopPropagation()
      const form = button.closest('form') as HTMLFormElement | null
      if (form) form.reset()
      const panel = (button.closest('details')
        || button.closest('.card')?.querySelector(':scope > .add-panel')) as HTMLDetailsElement | null
      if (panel) panel.open = false
    }

    document.addEventListener('submit', onSubmit, true)
    document.addEventListener('click', onCancel, true)
    return () => {
      document.removeEventListener('submit', onSubmit, true)
      document.removeEventListener('click', onCancel, true)
    }
  }, [])

  return null
}
