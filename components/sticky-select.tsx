'use client'

import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'

/**
 * A dropdown on an edit form that keeps the choice you just made.
 *
 * React clears an uncontrolled form once its action finishes, which snapped
 * these back to the old option even though the save had gone through - the new
 * choice only appeared after a manual refresh. Holding the value in state means
 * the clear has nothing to undo, so what you picked is what stays on screen.
 *
 * The saved value still wins: when fresh data arrives from the server the
 * dropdown follows it, so a change made somewhere else is never hidden.
 */
type Props = Omit<ComponentPropsWithoutRef<'select'>, 'value' | 'defaultValue' | 'onChange'> & {
  value: string
}

export function StickySelect({ value, children, ...rest }: Props) {
  const [choice, setChoice] = useState(value)
  const ref = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    setChoice(value)
  }, [value])

  /* Cancel means go back to what is saved, not sit on a half-made change.
     React clears the form after a save too, and that one has to be ignored -
     at that moment the saved value on screen is still the old one, so obeying
     it would undo exactly what was just saved. form-guard marks a real Cancel. */
  const choiceRef = useRef(value)
  useEffect(() => {
    choiceRef.current = choice
  }, [choice])

  useEffect(() => {
    const form = ref.current?.closest('form')
    if (!form) return
    const onReset = () => {
      if (form.dataset.cancelling === 'yes') {
        setChoice(value)
        return
      }
      /* The clear that follows a save. It empties the element directly, and
         React does not put a controlled dropdown back on its own because the
         state behind it never changed - so the element is set back by hand,
         once the clear has finished. */
      setTimeout(() => {
        const node = ref.current
        if (node && node.value !== choiceRef.current) node.value = choiceRef.current
      }, 0)
    }
    form.addEventListener('reset', onReset)
    return () => form.removeEventListener('reset', onReset)
  }, [value])

  return (
    <select ref={ref} value={choice} onChange={(event) => setChoice(event.target.value)} {...rest}>
      {children}
    </select>
  )
}
