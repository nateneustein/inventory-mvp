'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Sidebar link that knows whether it is the page you are on.
 *
 * A nested route counts as active too, so /parts/<id> keeps "Parts / Supplies"
 * lit. The exception is "/", which would otherwise match everything.
 */
export function NavLink({ href, children }: { href: string, children: React.ReactNode }) {
  const pathname = usePathname() || ''
  const isActive = href === '/'
    ? pathname === '/'
    : pathname === href || pathname.startsWith(`${href}/`)

  return (
    <Link href={href} className={isActive ? 'active' : undefined} aria-current={isActive ? 'page' : undefined}>
      {children}
    </Link>
  )
}
