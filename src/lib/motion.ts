/** Whether the user asked for less movement. The CSS block in index.css
 *  neutralizes animations and transitions, but scripted smooth scrolling is
 *  invisible to it and has to ask. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
