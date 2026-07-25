/**
 * The three things a `role="dialog" aria-modal="true"` element has to do and
 * that are easy to declare without doing: take focus when it opens, keep Tab
 * inside while it is open, and hand focus back when it closes.
 *
 * SettingsSheet grew these inline; ConceptSheet declared the same attributes
 * with none of the behaviour, so Tab walked the filmstrip and the card list
 * behind a sheet that covered the window.
 */

import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'

export function useDialogFocus(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusables = ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (!focusables || focusables.length === 0) return
      const start = focusables[0]
      const end = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === start) {
        e.preventDefault()
        end.focus()
      } else if (!e.shiftKey && document.activeElement === end) {
        e.preventDefault()
        start.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [ref])
}
