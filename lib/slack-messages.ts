import { ZONE } from '@/lib/format'

/**
 * Every Slack message the app can send.
 *
 * The wording lives here rather than in the database on purpose. It gets
 * changed often, and a wording change should be a one-line edit that deploys
 * like anything else - not a migration. The queue only ever stores the facts
 * (a payload snapshot taken at the moment something happened), so a message
 * sent tomorrow still describes what was true when it was queued, while
 * reading in whatever words we are using today.
 *
 * House style, the same in all ten:
 *   line 1  the person who has to act, on their own so it is impossible to miss
 *   line 2  emoji + headline - what happened, and to what
 *   middle  only the numbers someone needs to decide what to do
 *   then    one link straight to the screen where they do it
 *   last    quiet context in small grey text
 */

type Payload = Record<string, any>

const money = (n: any) => Number(n || 0).toLocaleString('en-US')

function nice(value: any) {
  if (!value) return ''
  const text = String(value)
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const d = m ? new Date(text + 'T12:00:00Z') : new Date(text)
  if (Number.isNaN(d.getTime())) return text
  return d.toLocaleDateString('en-US', { timeZone: ZONE, day: 'numeric', month: 'short' })
}

function niceTime(value: any) {
  if (!value) return ''
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('en-US', {
    timeZone: ZONE, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  })
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** Slack renders a bullet list from plain hyphens well enough, and it survives
 *  the mobile app better than a block kit list does. */
function lines(rows: any[], render: (row: any) => string) {
  return (rows || []).map((r) => '  •  ' + render(r)).join('\n')
}

function link(appUrl: string, path: string, label: string) {
  return '<' + appUrl.replace(/\/$/, '') + path + '|' + label + '>'
}

export type Rendered = { text: string }

export function renderSlack(
  kind: string,
  payload: Payload,
  mentionUserId: string | null,
  appUrl: string,
): Rendered | null {
  const p = payload || {}
  const at = mentionUserId ? '<@' + mentionUserId + '>' : ''
  const head = (emoji: string, title: string) => [at, emoji + ' ' + title].filter(Boolean).join('\n')

  switch (kind) {
    /* 1 - an untracked part someone has to go and buy. Nothing has gone wrong. */
    case 'reorder_needed': {
      const low = p.report_type === 'running_low'
      const body: string[] = []
      body.push(
        low && p.counted != null
          ? 'Warehouse says *running low* - roughly *' + money(p.counted) + '* left on the shelf.'
          : low
            ? 'Warehouse says *running low*.'
            : 'Warehouse says there is *none left*.',
      )
      if (p.last_arrival_qty) {
        body.push('Last arrived: *' + money(p.last_arrival_qty) + '* on ' + nice(p.last_arrival_date) +
          (p.last_arrival_days != null ? ' (' + p.last_arrival_days + ' days ago)' : '') + '.')
      } else {
        body.push('No record of a delivery for this one yet.')
      }
      if (p.note) body.push('Note from the floor: "' + p.note + '"')
      body.push(link(appUrl, '/reorder', 'Open the reorder list →'))
      body.push('_' + [p.reporter && 'Reported by ' + p.reporter, p.category, 'not a tracked part, so nothing has gone wrong here']
        .filter(Boolean).join(' · ') + '_')
      return { text: [head('🛒', 'Needs reordering - ' + p.part_name), ...body].join('\n') }
    }

    /* 2 - it has landed, or should have. Brendon's first look. */
    case 'needs_receiving': {
      const body: string[] = []
      body.push([p.supplier, p.carrier_delivered
        ? 'carrier says *Delivered*' + (p.delivered_when ? ' (' + niceTime(p.delivered_when) + ')' : '')
        : 'expected by ' + nice(p.expected_date) + ' and nothing heard from the carrier',
      ].filter(Boolean).join(' · '))
      body.push('What should be in it:')
      body.push(lines(p.lines, (l: any) => money(l.remaining) + ' × ' + l.part_name))
      body.push('*This still has to be received in the app.* Stock does not move until someone counts it in - until then the app thinks none of it arrived.')
      body.push(link(appUrl, '/receiving', 'Open the receiving screen →'))
      body.push('_Please check the shelf and receive it_')
      return { text: [head('📦', 'Needs to be received - ' + p.po_number), ...body].join('\n') }
    }

    /* 3 - a day later and still nothing booked in. Escalates to admin. */
    case 'still_not_received': {
      const body: string[] = []
      body.push([p.supplier, p.carrier_delivered
        ? 'carrier said *Delivered* on ' + nice(p.delivered_on)
        : 'was expected by ' + nice(p.expected_date),
        (p.days_waiting != null ? '*' + p.days_waiting + ' ' + plural(p.days_waiting, 'day', 'days') + ' ago*' : ''),
      ].filter(Boolean).join(' · '))
      body.push('Still outstanding:')
      body.push(lines(p.lines, (l: any) => money(l.remaining) + ' × ' + l.part_name))
      body.push('Brendon was asked to receive this and nothing has been booked in yet.')
      body.push('Please check with Brendon whether it is on the shelf, or with the supplier if it never turned up, and make sure it gets received.')
      body.push(link(appUrl, '/shipments/' + p.purchase_order_id, 'Open the shipment →'))
      body.push('_Until it is received, the app is still counting this stock as not arrived_')
      return { text: [head('📥', 'Still not received - ' + p.po_number), ...body].join('\n') }
    }

    /* 4 - acrylic is in, so it needs listing. */
    case 'acrylic_received': {
      const body: string[] = []
      body.push([p.po_number, p.received_by && 'received by ' + p.received_by].filter(Boolean).join(' · '))
      body.push(lines(p.lines, (l: any) => l.part_name + ' - *' + money(l.quantity) + '*'))
      body.push('12x20 clear (night light signs) is not listed on Shopify, so it is left off on purpose.')
      body.push(link(appUrl, '/shipments/' + p.purchase_order_id, 'Open the shipment →'))
      return { text: [head('🎨', 'Acrylic sheets are in - add these to Shopify'), ...body].join('\n') }
    }

    /* 5 - a tracked part should never get here. Something in the forecast missed. */
    case 'forecast_failure': {
      const atZero = p.report_type === 'zero'
      const body: string[] = []
      body.push('This is a *tracked* part - the app is meant to keep it in stock, so ' +
        (atZero ? 'hitting zero' : 'running low') + ' means the forecast missed.')
      if (p.covered_po) {
        body.push('A shipment is coming, expected by ' + nice(p.covered_expected) + ', but not in time.')
      } else if (!atZero) {
        body.push('Nothing on the way. The app should have ordered this already and did not.')
      } else {
        body.push('Nothing on the way.')
      }
      body.push('*Investigate further where the failure actually is.*')
      body.push(link(appUrl, '/zero', 'Open Report Zero →'))
      body.push('_' + [p.reporter && 'Reported by ' + p.reporter,
        p.per_week ? 'using ' + p.per_week + ' a week' : ''].filter(Boolean).join(' · ') + '_')
      return {
        text: [head('🚨', 'FORECAST FAILURE - ' + p.part_name + ' is ' + (atZero ? 'at zero' : 'running low')), ...body].join('\n'),
      }
    }

    /* 6 - damage on arrival. The money point is the credit, not the count. */
    case 'damage_found': {
      const body: string[] = []
      if (p.supplier) body.push(p.supplier)
      body.push(lines(p.lines, (l: any) =>
        l.part_name + ' - ' + money(l.good) + ' good, *' + money(l.damaged) + ' damaged*'))
      const total = (p.lines || []).reduce((s: number, l: any) => s + Number(l.damaged || 0), 0)
      body.push('Damaged stock never entered inventory, so the shipment is ' + money(total) +
        ' short. *Raise it with the supplier and ask for credit on the next order.*')
      if (p.note) body.push('Note: "' + p.note + '"')
      body.push(link(appUrl, '/shipments/' + p.purchase_order_id, 'Open the shipment →') + ' · ' +
        link(appUrl, '/damage', 'Damage register →'))
      body.push('_' + [p.received_by && 'Received by ' + p.received_by,
        'send them a photo, it makes the credit easier to get'].filter(Boolean).join(' · ') + '_')
      return { text: [head('⚠️', 'Damaged on arrival - ' + p.po_number), ...body].join('\n') }
    }

    /* 7 - the count itself is wrong. Damage is reported separately. */
    case 'missing_followup': {
      const body: string[] = []
      if (p.supplier) body.push(p.supplier)
      body.push(lines(p.lines, (l: any) =>
        l.part_name + ' - *' + money(l.missing) + ' missing*'))
      body.push('These were marked missing about a week ago and have not been sorted out. If the rest of the shipment turned up, receive them; otherwise mark them as won’t arrive.')
      body.push(link(appUrl, '/receiving', 'Open the receiving screen →'))
      return { text: [head('🔎', 'Missing units still to sort out - ' + p.po_number), ...body].join('\n') }
    }

    case 'wrong_quantity': {
      const body: string[] = []
      if (p.supplier) body.push(p.supplier)
      body.push(lines(p.lines, (l: any) =>
        l.part_name + ' - ordered *' + money(l.ordered) + '*, got *' + money(l.received) + '* → *' +
        money(Math.abs(Number(l.difference))) + ' ' + (Number(l.difference) < 0 ? 'short' : 'over') + '*'))
      body.push('Raise it with the supplier before the invoice is paid, and ask for credit on the next order.')
      body.push(link(appUrl, '/shipments/' + p.purchase_order_id, 'Open the shipment →'))
      return { text: [head('🔢', 'Wrong quantity - ' + p.po_number), ...body].join('\n') }
    }

    /* 8 - a week past the date with nothing received. */
    case 'week_overdue': {
      const body: string[] = []
      body.push([p.supplier, 'was expected by *' + nice(p.expected_date) + '*',
        'that was *' + p.days_late + ' ' + plural(p.days_late, 'day', 'days') + ' ago*'].filter(Boolean).join(' · '))
      body.push('Still outstanding:')
      body.push(lines(p.lines, (l: any) => money(l.remaining) + ' × ' + l.part_name))
      if (p.tracking_note) body.push('Carrier last said: ' + p.tracking_note)
      body.push('*Nothing has been received against this shipment yet.* If it is sitting in the warehouse it still has to be received in the app before the stock counts - please get Brendon to check the shelf and receive it, or chase the supplier.')
      body.push(link(appUrl, '/shipments/' + p.purchase_order_id, 'Open the shipment →'))
      body.push('_Either it is genuinely late, or it arrived and was never received in the app. Both worth checking._')
      return { text: [head('⏰', 'A week overdue - ' + p.po_number), ...body].join('\n') }
    }

    /* 9 - the one that fires early enough to actually save money. */
    case 'order_now': {
      const body: string[] = []
      body.push('On hand *' + money(p.on_hand) + '* · ' +
        (Number(p.incoming) > 0 ? '*' + money(p.incoming) + '* on the way' : 'nothing on the way') +
        ' · using *' + p.per_week + '* a week')
      body.push('Runs out about *' + nice(p.runs_out) + '*.' +
        (p.lead_days ? ' This supplier takes *' + p.lead_days + ' days*, so ordering today already lands late.' : ''))
      body.push(link(appUrl, '/predictions/basic', 'Open basic prediction →'))
      if (p.supplier) body.push('_' + p.supplier + '_')
      return { text: [head('📉', 'Prediction Says Order now - ' + p.part_name), ...body].join('\n') }
    }

    /* 10 - something is coming, just not soon enough. Buy a few, not a container. */
    case 'gap_before_shipment': {
      const body: string[] = []
      body.push('On hand *' + money(p.on_hand) + '* · using *' + p.per_week + '* a week → runs out about *' + nice(p.runs_out) + '*')
      body.push('Next shipment: ' + p.next_po_number + ', expected by *' + nice(p.next_arrival) + '* - *' +
        p.days_short + ' ' + plural(p.days_short, 'day', 'days') + '* after you run dry.')
      body.push('Short by roughly *' + money(p.short_by) + '* to bridge the gap.')
      body.push(link(appUrl, '/predictions/basic', 'Open the gap report →'))
      body.push('_Worth buying a small quantity locally rather than waiting_')
      return { text: [head('⚠️', 'Running out before shipment arrives - ' + p.part_name), ...body].join('\n') }
    }

    /* 11 - the part photos are backed up by hand, so something has to say when
       enough has changed to be worth doing again. Not an emergency: no photo
       is lost, it just is not off-site yet. */
    case 'photo_backup_due': {
      const bits: string[] = []
      if (Number(p.new) > 0) bits.push('*' + p.new + '* new')
      if (Number(p.changed) > 0) bits.push('*' + p.changed + '* changed')
      if (Number(p.deleted) > 0) bits.push('*' + p.deleted + '* deleted')
      const body: string[] = []
      body.push(bits.join(' · ') + ' — *' + p.mb + ' MB* in total')
      body.push('On: ' + p.parts)
      body.push('<https://supabase.com/dashboard/project/gaqhebnpkkgseizdpsug/storage/files/buckets/part-files|Open the photo bucket →>')
      body.push('_Download each folder, drop it in the Drive backup folder, then tell Claude the export is done so the count starts again._')
      return { text: [head('📷', p.total + ' part ' + plural(Number(p.total), 'photo', 'photos') + ' are not backed up yet'), ...body].join('\n') }
    }

    default:
      return null
  }
}
