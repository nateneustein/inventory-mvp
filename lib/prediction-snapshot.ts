// @ts-nocheck
/**
 * Shared prediction snapshot.
 *
 * The Advanced Prediction page works one group at a time. This module runs the
 * SAME group-surge math for every group in one pass, so the parts page, the
 * dashboard and the Slack alerts can all read the same current numbers without
 * re-deriving them. It is refreshed after each weekly upload.
 *
 * Two numbers come out of it per part, exactly as the group box on the advanced
 * page shows them:
 *   - alertDays   = lead time x (1 + group surge %)   -> when to warn
 *   - orderMonths = base months x (1 + group surge %)  -> how much to order
 */
import {
  dms, isoOf, buildWeekMap, surgeSearch, groupSurge, monthsToOrder, trendSearch,
} from './advanced-prediction'
import { today } from './format'

const DAY = 86400000
const DEFAULTS = {
  base: 3, pool: 0.5, tmin: 4, tth: 2, tlook: 6, thoriz: 6, tclip: 1.5,
  sth: 2, npmin: 2, npbump: 25, flagx: 2.5, mfloor: 0, gfloor: 2, slook: 12,
}

function resolveDials(saved) {
  saved = saved || {}
  const pick = (k) => { const v = Number(saved[k]); return Number.isFinite(v) && v > 0 ? v : DEFAULTS[k] }
  const pick0 = (k) => {
    if (saved[k] !== undefined && saved[k] !== null) { const v = Number(saved[k]); if (Number.isFinite(v) && v >= 0) return v }
    return DEFAULTS[k]
  }
  const excl = (arr) => (Array.isArray(arr) ? arr.map(Number).filter((n) => n >= 1 && n <= 12) : [10, 11, 12, 1])
  const ovRaw = saved.trendOv
  const trendOv = ovRaw === 'off' ? 'off'
    : (ovRaw !== undefined && ovRaw !== null && Number.isFinite(Number(ovRaw)) ? Number(ovRaw) : null)
  return {
    baseMonths: pick('base'), poolFrac: pick('pool'), trendMin: pick('tmin'), trendTh: pick('tth'),
    trendLook: pick('tlook'), trendClip: pick('tclip'), medFloor: pick0('mfloor'),
    groupFloor: pick0('gfloor'), surgeLook: pick0('slook'),
    surgeExclude: excl(saved.sx), trendExclude: excl(saved.tx),
    knockouts: Array.isArray(saved.knockouts) ? saved.knockouts : [],
    trendOv,
  }
}

async function fetchAll(build) {
  const out = []
  for (let page = 0; page < 60; page++) {
    const { data } = await build().range(page * 1000, page * 1000 + 999)
    if (!data || !data.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

/** Runs the group-surge calc for every active part. Returns one row per part. */
export async function computeSnapshots(supabase) {
  const { data: allParts } = await supabase.from('parts')
    .select('id, name, category, lead_time_days_max, safety_stock_days, active')
    .eq('active', true)
  const parts = allParts || []

  const todayIso = today()
  const todayMs = dms(todayIso)

  const weekly = await fetchAll(() => supabase.from('part_usage_weekly')
    .select('part_id, period_start, used_qty').order('period_start'))
  const weeklyByPart = {}
  for (const r of weekly) { (weeklyByPart[r.part_id] || (weeklyByPart[r.part_id] = [])).push({ week: r.period_start, qty: r.used_qty }) }

  // Data currency, shop-wide: median across every part of its own latest week.
  const cutoff = isoOf(todayMs - 120 * DAY)
  const lastBy = {}
  for (const r of weekly) {
    if (r.period_start < cutoff) continue
    const t = dms(r.period_start)
    if (!lastBy[r.part_id] || t > lastBy[r.part_id]) lastBy[r.part_id] = t
  }
  const lasts = Object.values(lastBy).sort((a, b) => a - b)
  const shopMedianLast = lasts.length ? lasts[Math.floor((lasts.length - 1) / 2)] : todayMs

  const { data: sRows } = await supabase.from('advanced_prediction_settings').select('category, settings')
  const settingsByCat = {}
  for (const r of sRows || []) settingsByCat[r.category] = r.settings || {}

  const byCat = {}
  for (const p of parts) { (byCat[p.category || 'No category'] || (byCat[p.category || 'No category'] = [])).push(p) }

  const results = []
  for (const cat of Object.keys(byCat)) {
    const groupParts = byCat[cat]
    const dial = resolveDials(settingsByCat[cat])
    const baseWeeks = Math.round((dial.baseMonths * 13) / 3)

    const listingRows = []
    for (const p of groupParts) for (const r of (weeklyByPart[p.id] || [])) listingRows.push(r)
    const listingWm = buildWeekMap(listingRows)

    const trendAuto = listingWm
      ? trendSearch(listingWm.first, listingWm.map, shopMedianLast, {
          minMonths: dial.trendMin, thresholdPct: dial.trendTh, clipMult: dial.trendClip,
          maxBlocks: Math.max(4, Math.round((dial.trendLook * 13) / 12)), excludeMonths: dial.trendExclude,
        })
      : { applied: false, gWeekly: 0, perBlockPct: 0 }
    let trend = trendAuto
    if (dial.trendOv === 'off') trend = { ...trendAuto, applied: false }
    else if (typeof dial.trendOv === 'number') trend = { ...trendAuto, applied: dial.trendOv > 0, perBlockPct: dial.trendOv, gWeekly: dial.trendOv / 100 / 4 }

    const ltCache = {}
    const localTrend = listingWm ? function (fromMs, toMs) {
      const ltEnd = Math.min(shopMedianLast, Math.max(toMs, listingWm.first + 28 * 7 * DAY))
      const key = String(ltEnd)
      if (!ltCache[key]) {
        ltCache[key] = trendSearch(listingWm.first, listingWm.map, ltEnd, {
          minMonths: dial.trendMin, thresholdPct: dial.trendTh, clipMult: dial.trendClip,
          maxBlocks: 7, excludeMonths: dial.trendExclude,
        })
      }
      const t = ltCache[key]
      return { applied: t.applied || t.levelable === true, gWeekly: t.gWeekly, perBlockPct: t.perBlockPct }
    } : null

    const surgeLbWeeks = dial.surgeLook > 0 ? Math.round((dial.surgeLook * 13) / 3) : 0
    const perVariation = []
    for (const p of groupParts) {
      const wm = buildWeekMap(weeklyByPart[p.id] || [])
      if (!wm) continue
      const end = Math.max(wm.ownLast, shopMedianLast)
      const s = surgeSearch(wm.first, wm.map, end, baseWeeks, localTrend, dial.surgeExclude, dial.medFloor, dial.groupFloor, surgeLbWeeks)
      if (!s) continue
      perVariation.push({ part: p, pct: s.pct })
    }
    const inGroup = perVariation.filter((pv) => dial.knockouts.indexOf(pv.part.id) < 0)
    const groupBase = inGroup.length ? inGroup : perVariation
    const group = groupBase.length
      ? groupSurge(groupBase.map((pv) => ({ name: pv.part.name, pct: pv.pct })), dial.poolFrac)
      : { pct: 0 }
    const months = monthsToOrder(group.pct, dial.baseMonths)

    for (const p of groupParts) {
      const hasLead = p.lead_time_days_max !== null && p.lead_time_days_max !== undefined
      const leadDays = hasLead ? Number(p.lead_time_days_max) + Number(p.safety_stock_days || 0) : null
      const alertDays = leadDays != null ? leadDays * (1 + group.pct / 100) : null
      results.push({
        partId: p.id,
        category: cat,
        surgePct: group.pct,
        baseMonths: dial.baseMonths,
        orderMonths: months.months,
        leadDays,
        alertDays,
        trendApplied: !!trend.applied,
      })
    }
  }
  return { results, computedAtIso: todayIso, shopMedianLastIso: isoOf(shopMedianLast) }
}

/** The tokens a person can drop into the order-note template. */
export const ORDER_NOTE_TOKENS = [
  '[order_months]', '[surge_pct]', '[lead_days]', '[warn_days]', '[trend_extra]', '[season_extra]',
]

export const DEFAULT_ORDER_TEMPLATE =
  'Order about [order_months] months of stock (base 3 months grown by the group surge of [surge_pct]%). ' +
  'Lead time is about [lead_days] days, so warn when cover drops under [warn_days] days. ' +
  'Check the Advanced Prediction page for any extra to add for trend or seasonality before placing the order.'

const F1 = (n) => (n === null || n === undefined || n === '' ? '—' : (Math.round(Number(n) * 10) / 10).toFixed(1))
const F0 = (n) => (n === null || n === undefined || n === '' ? '—' : String(Math.round(Number(n))))

/** Fills [tokens] in an order-note template from a part row's snapshot columns. */
export function renderOrderNote(template, part) {
  const raw = template && String(template).trim() ? String(template) : DEFAULT_ORDER_TEMPLATE
  const p = part || {}
  const map = {
    '[order_months]': F1(p.snap_order_months),
    '[surge_pct]': F0(p.snap_surge_pct),
    '[lead_days]': F0(p.snap_lead_days),
    '[warn_days]': F0(p.reorder_horizon_days),
    '[trend_extra]': p.snap_trend_extra_pcs === null || p.snap_trend_extra_pcs === undefined ? 'see Advanced Prediction' : F0(p.snap_trend_extra_pcs),
    '[season_extra]': p.snap_season_extra_pcs === null || p.snap_season_extra_pcs === undefined ? 'see Advanced Prediction' : F0(p.snap_season_extra_pcs),
  }
  return raw.replace(/\[(order_months|surge_pct|lead_days|warn_days|trend_extra|season_extra)\]/g, (m) => (map[m] !== undefined ? map[m] : m))
}
