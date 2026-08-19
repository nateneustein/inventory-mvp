/**
 * The three ways a part can be sitting still, said in words rather than in one
 * shared label.
 *
 * "Slow" used to cover both "you bought more than a year's worth" and "nothing
 * has touched this since the spring". They look identical on a screen and call
 * for opposite decisions - the first is still selling and just over-bought, the
 * second has stopped selling - so each now has its own word and its own colour.
 *
 * Blue rather than amber for overstocked on purpose: too much stock is a buying
 * decision to revisit, not something going wrong today.
 */
const LABELS: Record<string, { text: string, cls: string, title: string }> = {
  overstocked: {
    text: 'overstocked',
    cls: 'info',
    title: 'Still selling, but there is more than a year of cover on the shelf. Buy less next time.',
  },
  not_moving: {
    text: 'not moving',
    cls: 'warning',
    title: 'Nothing has consumed this in over 120 days.',
  },
  dead: {
    text: 'dead',
    cls: 'out',
    title: 'Nothing has consumed this in over 270 days, or it has never been used at all.',
  },
}

export function DeadStockBadge({ status }: { status: string }) {
  const found = LABELS[status]
  if (!found) return <span className="badge">{status}</span>
  return <span className={'badge ' + found.cls} title={found.title}>{found.text}</span>
}
