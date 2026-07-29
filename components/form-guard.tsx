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
    // ---------------------------------------------------------- unsaved work
    // These pages are mostly boxes you type into and then have to remember to
    // save. Anything typed but not saved is tracked here, so leaving the page
    // has to be a decision rather than an accident.
    //
    // The browser's own dialog only ever offers two buttons and its wording
    // cannot be changed, so the in-app one is worded to match what those two
    // buttons actually do.
    const dirty = new Set<HTMLFormElement>()

    function clearAllDirty() {
      dirty.clear()
      document.querySelectorAll('form.is-dirty').forEach((f) => f.classList.remove('is-dirty'))
    }

    // Search and filter bars post to a URL and lose nothing when you leave.
    // Only forms that run a server action hold real unsaved work.
    function holdsWork(form: HTMLFormElement) {
      if (form.classList.contains('filter-bar')) return false
      return !/^(\/|https?:)/.test(form.getAttribute('action') || '')
    }

    function onEdit(event: Event) {
      const target = event.target as HTMLInputElement | null
      if (!target || !target.closest) return
      if (['hidden', 'search', 'submit', 'button', 'reset'].includes(target.type)) return
      const form = target.closest('form') as HTMLFormElement | null
      if (form && holdsWork(form)) dirty.add(form)
      form.classList.add('is-dirty')
    }

    function onReset(event: Event) { dirty.delete(event.target as HTMLFormElement)
      ;(event.target as HTMLFormElement).classList.remove('is-dirty') }

    // A form that has been re-rendered away took its unsaved edits with it.
    function unsavedWork() {
      for (const form of dirty) if (document.body.contains(form)) return true
      clearAllDirty()
      return false
    }

    const LEAVE = 'You have typed something here that has not been saved yet.'
      + '\n\nOK - leave the page and throw those changes away.'
      + '\nCancel - stay here so you can save them first.'

    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!unsavedWork()) return
      // Closing the tab, reloading, or going to another site. The browser
      // writes its own wording here; all we can do is ask it to ask.
      event.preventDefault()
      event.returnValue = ''
    }

    // Moving around inside the app never reloads the page, so the browser
    // never gets a chance to ask. This asks for it.
    function onLeave(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const link = target?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!link) return
      const href = link.getAttribute('href') || ''
      if (!href || href.startsWith('#')) return
      if (link.target === '_blank' || link.hasAttribute('download')) return
      if (!unsavedWork()) return
      if (window.confirm(LEAVE)) clearAllDirty()
      else { event.preventDefault(); event.stopImmediatePropagation() }
    }

    function onSubmit(event: Event) {
      const form = event.target as HTMLFormElement
      if (!(form instanceof HTMLFormElement)) return

      // The button that actually submitted. Falls back to the form's first
      // submit control for keyboard submits.
      const submitter = (event as SubmitEvent).submitter as HTMLElement | null
        || form.querySelector('button[type="submit"], button:not([type])')
      if (!submitter) return

      // Each save button only saves ITS OWN form. Somebody who types in two
      // places and presses one button used to lose the other silently - and
      // the browser refilling text boxes on a refresh made it look saved.
      const elsewhere = [...dirty].filter((f) => f !== form && document.body.contains(f))
      if (elsewhere.length) {
        const carryOn = window.confirm(
          'Only this section is being saved.\n\n' +
          'You have typed something in ' + elsewhere.length + ' other place' +
          (elsewhere.length > 1 ? 's' : '') + ' on this page that has its own save button. ' +
          'That typing will NOT be saved by this button and will be lost.\n\n' +
          'Save just this section anyway?'
        )
        if (!carryOn) { event.preventDefault(); event.stopImmediatePropagation(); return }
      }

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
      // Saved, so nothing is hanging any more.
      clearAllDirty()

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
      if (form) { form.reset(); dirty.delete(form)
      form.classList.remove('is-dirty') }
      const panel = (button.closest('details')
        || button.closest('.card')?.querySelector(':scope > .add-panel')) as HTMLDetailsElement | null
      if (panel) panel.open = false
    }

    document.addEventListener('submit', onSubmit, true)
    document.addEventListener('click', onCancel, true)
    document.addEventListener('input', onEdit, true)
    document.addEventListener('change', onEdit, true)
    document.addEventListener('reset', onReset, true)
    document.addEventListener('click', onLeave, true)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('submit', onSubmit, true)
      document.removeEventListener('click', onCancel, true)
      document.removeEventListener('input', onEdit, true)
      document.removeEventListener('change', onEdit, true)
      document.removeEventListener('reset', onReset, true)
      document.removeEventListener('click', onLeave, true)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [])

  return null
}
