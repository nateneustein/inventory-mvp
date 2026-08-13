'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

export type PickerOption = { value: string, label: string, hint?: string }

/**
 * A dropdown you can type into.
 *
 * Replaces a plain <select> on any list long enough that scrolling it is a
 * chore — parts, product variations, purchase orders. It submits exactly what
 * the old <select> submitted (a hidden input carrying the id under the same
 * name), so every server action keeps working untouched.
 *
 * Two details worth knowing:
 *
 *  - The visible text box is never left showing something that is not the
 *    current selection. Blur or Escape snaps it back to the selected label, or
 *    to empty when nothing is chosen. That keeps `required` honest: an empty
 *    box means an empty value, so the browser blocks the submit itself.
 *  - The menu is positioned fixed against the input's screen rect rather than
 *    nested in the layout, because most of these pickers sit inside a card or
 *    table with `overflow: hidden`, which would otherwise clip it.
 */
export function SearchSelect({
  name,
  options,
  defaultValue = '',
  placeholder = 'Type to search',
  required = false,
  disabled = false,
  emptyLabel = 'No matches',
  actionOption,
}: {
  name: string
  options: PickerOption[]
  defaultValue?: string
  placeholder?: string
  required?: boolean
  disabled?: boolean
  emptyLabel?: string
  /** An extra first row in the menu that opens a panel instead of picking a value. */
  actionOption?: { label: string, targetId: string }
}) {
  const byValue = useMemo(() => {
    const m = new Map<string, PickerOption>()
    for (const o of options) m.set(o.value, o)
    return m
  }, [options])

  const labelFor = useCallback((v: string) => byValue.get(v)?.label ?? '', [byValue])

  const [value, setValue] = useState(defaultValue)
  const [query, setQuery] = useState(() => labelFor(defaultValue))
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [rect, setRect] = useState<{ top: number, left: number, width: number, above: boolean } | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)

  // If the page re-renders with a different default (server action revalidate),
  // follow it — but never stomp on what the user is currently typing.
  useEffect(() => {
    if (!open) {
      setValue(defaultValue)
      setQuery(labelFor(defaultValue))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValue])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    // Showing the selected label is the resting state, not a search — list
    // everything so the menu can still be browsed.
    if (!q || query === labelFor(value)) return options
    const terms = q.split(/\s+/)
    return options.filter(o => {
      const hay = (o.label + ' ' + (o.hint || '')).toLowerCase()
      return terms.every(t => hay.includes(t))
    })
  }, [options, query, value, labelFor])

  const place = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom
    const above = spaceBelow < 220 && r.top > spaceBelow
    // Never let the menu run off the right edge: pickers in the last column of
    // a table sit close enough to the window edge that a wider-than-the-input
    // menu would otherwise be half off screen.
    const width = Math.max(r.width, 280)
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 12))
    setRect({
      top: above ? r.top : r.bottom + 4,
      left,
      width,
      above,
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    place()
    const onMove = () => place()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, place])

  /* When the surrounding form is reset - after a save, or when someone hits
     Cancel - the picker has to go back to empty too. A plain form.reset()
     cannot clear React state on its own, so listen for the event. */
  useEffect(() => {
    const form = rootRef.current?.closest('form')
    if (!form) return
    const onReset = () => {
      /* An add form starts empty, so clearing it after a save is right. An edit
         form starts on the saved row, and at the moment React clears the form
         that saved row is still the old one - putting it back would undo the
         change just made. Only a real Cancel should do that. */
      if (defaultValue && form.dataset.cancelling !== 'yes') return
      setValue(defaultValue)
      setQuery(labelFor(defaultValue))
      setOpen(false)
    }
    form.addEventListener('reset', onReset)
    return () => form.removeEventListener('reset', onReset)
  }, [defaultValue, labelFor])

  const reset = useCallback(() => {
    setQuery(labelFor(value))
    setOpen(false)
  }, [labelFor, value])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return
      reset()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, reset])

  useEffect(() => {
    if (!open || !menuRef.current) return
    const el = menuRef.current.children[active] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  // "Add a new supplier" belongs in the list, because the list is where
  // someone looks when the one they want is not there. It never becomes the
  // value - it opens the panel that creates one.
  function runAction() {
    if (!actionOption) return
    setOpen(false)
    const panel = document.getElementById(actionOption.targetId) as HTMLDetailsElement | null
    if (!panel) return
    panel.open = true
    panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const first = panel.querySelector('input, textarea, select') as HTMLElement | null
    setTimeout(() => first?.focus(), 80)
  }

  function commit(o: PickerOption) {
    setValue(o.value)
    setQuery(o.label)
    setOpen(false)
    inputRef.current?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { setOpen(true); setActive(0); return }
      const next = e.key === 'ArrowDown' ? active + 1 : active - 1
      setActive(Math.max(0, Math.min(filtered.length - 1, next)))
      return
    }
    if (e.key === 'Enter') {
      /* Enter never reaches the form. It used to be swallowed only on the
         press that picked an option; the press after that, once the menu had
         closed again, fell straight through and saved the whole entry. */
      e.preventDefault()
      if (open && filtered[active]) commit(filtered[active])
      return
    }
    if (e.key === 'Escape') {
      if (open) { e.preventDefault(); reset() }
      return
    }
    if (e.key === 'Tab') {
      if (open) reset()
    }
  }

  const selected = byValue.get(value)

  return (
    <div className="search-select" ref={rootRef}>
      <input type="hidden" name={name} value={value} />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        className={selected ? 'has-value' : undefined}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0); if (value) setValue('') }}
        onFocus={e => { setOpen(true); setActive(0); e.target.select() }}
        onKeyDown={onKeyDown}
      />
      {open && rect && (
        <ul
          ref={menuRef}
          className="search-select-menu"
          role="listbox"
          style={{
            position: 'fixed',
            top: rect.above ? undefined : rect.top,
            bottom: rect.above ? window.innerHeight - rect.top + 4 : undefined,
            left: rect.left,
            width: rect.width,
          }}
        >
          {actionOption && (
            <li
              className="search-select-action"
              onMouseDown={e => { e.preventDefault(); runAction() }}
            >
              {actionOption.label}
            </li>
          )}
          {filtered.length === 0 && <li className="search-select-empty">{emptyLabel}</li>}
          {filtered.slice(0, 300).map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={i === active ? 'is-active' : undefined}
              onMouseEnter={() => setActive(i)}
              onMouseDown={e => { e.preventDefault(); commit(o) }}
              title={o.label}
            >
              {o.label}
              {o.hint && <span className="search-select-hint">{o.hint}</span>}
            </li>
          ))}
          {filtered.length > 300 && (
            <li className="search-select-empty">
              {filtered.length - 300} more — keep typing to narrow it down
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
