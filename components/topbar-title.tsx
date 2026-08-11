'use client'

import { usePathname } from 'next/navigation'

/**
 * The topbar used to say "Operations dashboard" on every single page, which
 * read as a mistake once you were three levels deep. It now names the page you
 * are actually on. Longest prefix wins, so /parts/<id> resolves to "Parts /
 * Supplies" rather than falling through.
 */
const TITLES: Array<[string, string]> = [
  ['/dashboard', 'Operations dashboard'],
  ['/uploads', 'Uploads / Connections'],
  ['/imported-orders', 'Imported Orders'],
  ['/reports', 'Reports'],
  ['/parts', 'Parts / Supplies'],
  ['/shipments', 'Shipments / Purchases'],
  ['/receiving', 'Receiving'],
  ['/adjustments', 'Adjustments / Switches'],
  ['/damage', 'Damage / Scrap'],
  ['/zero', 'Report Zero'],
  ['/counts', 'Counts'],
  ['/scanner', 'Scanner / QR'],
  ['/products', 'Finished Products'],
  ['/boms', 'BOM / Master File'],
  ['/mapping-rules', 'Mapping Rules'],
  ['/usage', 'Usage & History'],
  ['/predictions/basic', 'Basic Prediction'],
  ['/predictions/advanced', 'Advanced Prediction'],
  ['/predictions', 'Prediction'],
  ['/suppliers', 'Suppliers'],
  ['/slack', 'Slack Alerts'],
  ['/purchase-orders', 'Purchase Orders'],
  ['/replacements', 'Replacements'],
  ['/users', 'Users & roles'],
  ['/no-access', 'No access'],
  ['/login', 'Sign in'],
]

/**
 * The line above the page name. It used to read "Inventory Management MVP" on
 * every page, which told nobody anything. It now names the part of the app you
 * are standing in, so the two lines together read as a trail:
 * INVENTORY / Parts / Supplies.
 */
const SECTIONS: Array<[string, string]> = [
  ['/dashboard', 'Control'],
  ['/uploads', 'Control'],
  ['/imported-orders', 'Control'],
  ['/reports', 'Control'],
  ['/parts', 'Inventory'],
  ['/shipments', 'Inventory'],
  ['/purchase-orders', 'Inventory'],
  ['/receiving', 'Inventory'],
  ['/adjustments', 'Inventory'],
  ['/damage', 'Inventory'],
  ['/replacements', 'Inventory'],
  ['/zero', 'Inventory'],
  ['/counts', 'Inventory'],
  ['/reorder', 'Inventory'],
  ['/scanner', 'Inventory'],
  ['/products', 'Products'],
  ['/boms', 'Products'],
  ['/mapping-rules', 'Products'],
  ['/usage', 'Products'],
  ['/predictions', 'Planning'],
  ['/suppliers', 'Planning'],
  ['/users', 'Admin'],
  ['/slack', 'Admin'],
]

function longest(list: Array<[string, string]>, pathname: string) {
  return list
    .filter(([href]) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b[0].length - a[0].length)[0]
}

export function TopbarTitle() {
  const pathname = usePathname() || '/'
  const match = longest(TITLES, pathname)
  const section = longest(SECTIONS, pathname)

  /* One quiet line, not two loud ones. The page prints its own big heading a
     few centimetres below this, so repeating the page name here in heavy type
     just said the same thing twice. This is a trail: where you are, small. */
  return (
    <nav className="topbar-crumb" aria-label="Breadcrumb">
      <span>{section ? section[1] : 'EO Inventory Management'}</span>
      {match && <span className="topbar-crumb-sep" aria-hidden="true">/</span>}
      {match && <span className="topbar-crumb-here">{match[1]}</span>}
    </nav>
  )
}
