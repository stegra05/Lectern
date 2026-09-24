import type { ReactNode } from 'react'
import { openExternal } from '../lib/links'

/** A link that leaves the app: opens in the browser, marked with ↗. */
export function ExternalLink({
  href,
  children,
  className = '',
}: {
  href: string
  children: ReactNode
  className?: string
}) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        openExternal(href)
      }}
      className={`rounded-sm whitespace-nowrap underline underline-offset-2 transition-colors duration-150 ${className}`}
    >
      {children}
      <span aria-hidden> ↗</span>
    </a>
  )
}
