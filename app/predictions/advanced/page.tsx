// @ts-nocheck
import { requireUser } from '@/lib/require-user'
import { date, num, today } from '@/lib/format'
import {
  dms, isoOf, buildWeekMap, surgeSearch, groupSurge, monthsToOrder,
  cleanRate, trendSearch, buildMonthly, seasonCheck, coveredCalendarMonths,
  newProductCheck, quantity, seasonScan, weeklySeries,
} from '@/lib/advanced-prediction'
import { saveAdvancedPredictionSettings, saveSeasonDecision } from '@/lib/prediction-actions'

export const dynamic = 'force-dynamic'

/**
 * Advanced Prediction.
 *
 * The order of the page is the order of authority: the GROUP decides the
 * official ordering time and months for the whole listing first; the single
 * variation is checked afterwards, and can only raise its own quantity -
 * never change the group's schedule. Every number's working is shown, and
 * every dial can be changed and re-run. Deterministic - no AI anywhere.
 */

const DAY = 86400000
const f0 = (n) => num(Math.round(Number(n) || 0))
const f1 = (n) => (Math.round((Number(n) || 0) * 10) / 10).toFixed(1)
const f2 = (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2)
const pctOf = (n) => Math.round(Number(n) || 0)
const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Why a month may spike: holidays and seasons, INCLUDING the run-up months -
 *  personalized gifts get ordered one to two months before the day itself. */
const OCCASIONS = {
  1: ['Valentine\u2019s buying starts late January'],
  2: ['Valentine\u2019s Day'],
  3: ['Mother\u2019s Day run-up (gifts ordered early)', 'wedding-season buying begins'],
  4: ['Mother\u2019s Day run-up', 'wedding season', 'graduation gifts start'],
  5: ['Mother\u2019s Day', 'wedding season', 'graduation season', 'Father\u2019s Day run-up'],
  6: ['Father\u2019s Day', 'graduations', 'weddings'],
  7: ['weddings'],
  8: ['weddings', 'back-to-school'],
  9: ['weddings', 'back-to-school'],
  10: ['Christmas run-up begins (personalized gifts ordered early)'],
  11: ['Christmas buying', 'Black Friday'],
  12: ['Christmas'],
}

/**
 * Supabase caps a single response at 1000 rows. The bigger categories have
 * more weekly history than that, and silent truncation would quietly corrupt
 * every number downstream - so everything bulk is paged until exhausted.
 */
async function fetchAll(build) {
  const out = []
  for (let page = 0; page < 40; page++) {
    const { data } = await build().range(page * 1000, page * 1000 + 999)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

export default async function AdvancedPredictionPage({ searchParams }) {
  const params = searchParams ? await searchParams : {}
  const { supabase } = await requireUser()

  const { data: allParts } = await supabase.from('parts')
    .select('id, name, sku, category, lead_time_days_min, lead_time_days_max, safety_stock_days, reorder_horizon_days, moq, order_multiple, unit_price, currency, months_of_usage_to_order, supplier_id')
    .eq('active', true).order('name')
  const parts = allParts || []
  const selId = typeof params.part === 'string' ? params.part : ''
  const part = parts.find((p) => p.id === selId) || null

  // Dials resolve in three layers: built-in defaults first, then this group's
  // saved settings, then anything typed into the dial form for this one run.
  const DEFAULTS = { base: 3, pool: 0.25, tmin: 4, tth: 2, tlook: 6, thoriz: 3, tclip: 1.5, sth: 1.3, npmin: 2, npbump: 25, flagx: 2.5 }
  let savedSettings = {}
  let savedAt = null
  if (part && part.category) {
    const { data: sRow } = await supabase.from('advanced_prediction_settings')
      .select('settings, updated_at').eq('category', part.category).maybeSingle()
    if (sRow && sRow.settings) { savedSettings = sRow.settings; savedAt = sRow.updated_at }
  }
  const pick = function (k) {
    const u = Number(params[k])
    if (Number.isFinite(u) && u > 0) return u
    const sv = Number(savedSettings[k])
    if (Number.isFinite(sv) && sv > 0) return sv
    return DEFAULTS[k]
  }
  const dial = {
    baseMonths: pick('base'),
    poolFrac: pick('pool'),
    trendMin: pick('tmin'),
    trendTh: pick('tth'),
    trendLook: pick('tlook'),
    trendHoriz: pick('thoriz'),
    trendClip: pick('tclip'),
    seasonTh: pick('sth'),
    npMin: pick('npmin'),
    npBump: pick('npbump'),
    flagX: pick('flagx'),
    surgeOnWait: params.wait != null ? params.wait === '1' : Number(savedSettings.wait) === 1,
  }
  const baseWeeks = Math.round((dial.baseMonths * 13) / 3)

  // Month lists: which calendar months are ignored when measuring normal
  // behavior. Separate lists for the surge search and the trend measure,
  // resolved the same three-layer way (default Oct-Jan < saved < this run).
  // The form submits the months that COUNT; internally everything works on
  // the excluded list (stored as sx/tx/rx), so saved settings stay stable.
  const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  const parseCount = function (val, savedExclude, marker) {
    if (marker) {
      const inc = [].concat(val || []).map(Number)
      return ALL_MONTHS.filter((m) => inc.indexOf(m) < 0)
    }
    if (Array.isArray(savedExclude)) return savedExclude.map(Number).filter((n) => n >= 1 && n <= 12)
    return [10, 11, 12, 1]
  }
  const surgeExclude = parseCount(params.sc, savedSettings.sx, params.scset === '1')
  const trendExclude = parseCount(params.tc, savedSettings.tx, params.tcset === '1')
  const rateExclude = parseCount(params.rc, savedSettings.rx, params.rcset === '1')
  const seasonDecisions = savedSettings.seasons && typeof savedSettings.seasons === 'object' ? savedSettings.seasons : {}

  const byCategory = {}
  for (const p of parts) {
    const c = p.category || 'No category'
    if (!byCategory[c]) byCategory[c] = []
    byCategory[c].push(p)
  }

  // ------------------------------------------------------------------ inputs
  let groupParts = []
  let weeklyByPart = {}
  let shopMedianLast = 0
  let stockByPart = {}
  let openReports = []
  let monthlyAll = []
  const todayIso = today()
  const todayMs = dms(todayIso)

  if (part) {
    groupParts = parts.filter((p) => p.category === part.category)
    const ids = groupParts.map((p) => p.id)

    const weekly = await fetchAll(() => supabase.from('part_usage_weekly')
      .select('part_id, period_start, used_qty').in('part_id', ids)
      .order('period_start'))
    for (const r of weekly) {
      if (!weeklyByPart[r.part_id]) weeklyByPart[r.part_id] = []
      weeklyByPart[r.part_id].push({ week: r.period_start, qty: r.used_qty })
    }

    // Data currency: the median of every part's own latest data week across
    // the whole shop. A few parts running ahead must not make everyone
    // else's missing weeks read as calm; a few running behind must not
    // truncate real data. Each part reads to max(its own last, this median).
    const cutoff = isoOf(todayMs - 120 * DAY)
    const recent = await fetchAll(() => supabase.from('part_usage_weekly')
      .select('part_id, period_start').gte('period_start', cutoff).order('period_start'))
    const lastBy = {}
    for (const r of recent) {
      const t = dms(r.period_start)
      if (!lastBy[r.part_id] || t > lastBy[r.part_id]) lastBy[r.part_id] = t
    }
    const lasts = Object.values(lastBy).sort((a, b) => a - b)
    shopMedianLast = lasts.length ? lasts[Math.floor((lasts.length - 1) / 2)] : todayMs

    const { data: st } = await supabase.from('inventory_status')
      .select('part_id, on_hand, incoming_qty').in('part_id', ids)
    for (const r of st || []) stockByPart[r.part_id] = r

    const { data: reps } = await supabase.from('zero_stock_reports')
      .select('id, part_id, report_type, created_at').is('resolved_at', null)
      .in('part_id', ids).order('created_at', { ascending: false }).limit(20)
    openReports = reps || []

    monthlyAll = await fetchAll(() => supabase.from('part_usage_monthly')
      .select('part_id, period_start, used_qty').order('period_start'))
  }

  // ------------------------------------------------------------- calculation
  let calc = null
  if (part) {
    // The listing-wide trend is measured FIRST: when it fires, the surge
    // search levels every week to the trend line before hunting for spikes,
    // so growth is paid once (step 4) and spikes once (steps 1-2).
    const listingRows = []
    let listingFirst = Infinity
    for (const p of groupParts) {
      for (const r of weeklyByPart[p.id] || []) listingRows.push(r)
    }
    const listingWm = buildWeekMap(listingRows)
    if (listingWm) listingFirst = listingWm.first
    const trend = listingWm
      ? trendSearch(listingWm.first, listingWm.map, shopMedianLast,
                    { minMonths: dial.trendMin, thresholdPct: dial.trendTh, clipMult: dial.trendClip,
                      maxBlocks: Math.max(4, Math.round((dial.trendLook * 13) / 12)),
                      excludeMonths: trendExclude })
      : { applied: false, reason: 'no listing history', perBlockPct: 0, gWeekly: 0, blocks: [], clipped: [] }
    // Every candidate surge window is checked against its own era's
    // listing-wide climb: the ~6 months (7 blocks) ending where that window
    // ends, same gates and spike-clip as step 4. Cached per window end.
    const ltCache = {}
    const localTrend = listingWm ? function (fromMs, toMs) {
      const ltEnd = Math.min(toMs, shopMedianLast)
      const key = String(ltEnd)
      if (!ltCache[key]) {
        ltCache[key] = trendSearch(listingWm.first, listingWm.map, ltEnd, {
          minMonths: dial.trendMin, thresholdPct: dial.trendTh, clipMult: dial.trendClip,
          maxBlocks: 7, excludeMonths: trendExclude,
        })
      }
      const t = ltCache[key]
      return { applied: t.applied, gWeekly: t.gWeekly, perBlockPct: t.perBlockPct }
    } : null

    const perVariation = []
    const noData = []
    const wmBy = {}
    for (const p of groupParts) {
      const wm = buildWeekMap(weeklyByPart[p.id] || [])
      wmBy[p.id] = wm
      if (!wm) { noData.push(p); continue }
      const end = Math.max(wm.ownLast, shopMedianLast)
      const s = surgeSearch(wm.first, wm.map, end, baseWeeks, localTrend, surgeExclude)
      if (!s) { noData.push(p); continue }
      perVariation.push({ part: p, wm, end, s, pct: s.pct })
    }
    perVariation.sort((a, b) => b.pct - a.pct)

    if (perVariation.length > 0) {
      const group = groupSurge(perVariation.map((v) => ({ name: v.part.name, pct: v.pct })), dial.poolFrac)
      const months = monthsToOrder(group.pct, dial.baseMonths)
      const poolNames = new Set(group.pool.map((x) => x.name))

      const mine = perVariation.find((v) => v.part.id === part.id) || null
      const ownPct = mine ? mine.pct : 0
      const effPct = Math.max(ownPct, group.pct)
      const effWeeks = monthsToOrder(effPct, dial.baseMonths).weeks

      const selWm = wmBy[part.id]
      const selEnd = selWm ? Math.max(selWm.ownLast, shopMedianLast) : shopMedianLast
      const rate = selWm ? cleanRate(selWm.first, selWm.map, selEnd, effWeeks, rateExclude) : null

      // Lead time straight off the part record.
      const leadDays = part.lead_time_days_max != null
        ? Number(part.lead_time_days_max) + Number(part.safety_stock_days || 0)
        : Number(part.reorder_horizon_days || 90)
      const leadWeeks = Math.max(1, Math.round(leadDays / 7))
      const arrivalMs = todayMs + leadDays * DAY
      const coveredToMs = arrivalMs + effWeeks * 7 * DAY

      // Seasonality: variation, listing and shop monthly maps.
      const idSet = new Set(groupParts.map((p) => p.id))
      const mRows = { sel: [], listing: [], shop: [] }
      for (const r of monthlyAll) {
        const row = { month: r.period_start, qty: r.used_qty }
        mRows.shop.push(row)
        if (idSet.has(r.part_id)) mRows.listing.push(row)
        if (r.part_id === part.id) mRows.sel.push(row)
      }
      const mm = { sel: buildMonthly(mRows.sel), listing: buildMonthly(mRows.listing), shop: buildMonthly(mRows.shop) }
      // From TODAY until the order is used up: the waiting weeks plus the
      // cover weeks, driven by this part's own lead time - a 40-day supply
      // gets a short window, a 90-day import a long one. Nothing applies on
      // its own: a suggested month must be approved by a human first.
      const coverMonths = coveredCalendarMonths(todayMs, leadWeeks + effWeeks)
      const seasonRows = coverMonths.map((cm) => {
        const v = seasonScan(mm.sel, cm.y, cm.mo, dial.seasonTh)
        const l = seasonScan(mm.listing, cm.y, cm.mo, dial.seasonTh)
        const s = seasonScan(mm.shop, cm.y, cm.mo, dial.seasonTh)
        const decision = seasonDecisions[String(cm.mo)] || null
        const candidate = v.hits > 0 || l.hits > 0
        let applied = 1
        if (decision === 'approved') {
          if (v.hits > 0) applied = Math.max(applied, v.factor)
          else if (l.hits > 0) applied = Math.max(applied, l.factor)
          else if (v.hasHistory && v.factor > 1) applied = Math.max(applied, v.factor)
          else if (l.hasHistory && l.factor > 1) applied = Math.max(applied, l.factor)
        }
        return { ...cm, v, l, s, decision, candidate, applied }
      })
      const appliedByMonth = {}
      for (const r of seasonRows) appliedByMonth[r.y * 100 + r.mo] = r.applied
      const weekFactor = (w) => {
        const mid = new Date(todayMs + w * 7 * DAY - 3.5 * DAY)
        const key = mid.getUTCFullYear() * 100 + (mid.getUTCMonth() + 1)
        return appliedByMonth[key] || 1
      }
      const shopFlags = seasonRows.filter((r) => r.s.hits > 0 && r.applied === 1 && !r.candidate)

      const np = newProductCheck(listingFirst, todayMs, dial.npMin, dial.npBump)

      const stRow = stockByPart[part.id] || { on_hand: 0, incoming_qty: 0 }
      const available = Number(stRow.on_hand || 0) + Number(stRow.incoming_qty || 0)

      const q = rate ? quantity({
        available, ratePerWeek: rate.perWeek, leadWeeks, coverWeeks: effWeeks,
        gWeekly: trend.applied ? trend.gWeekly : 0, weekFactor,
        newBumpPct: np.bumpPct, surgeOnWait: dial.surgeOnWait, waitSurgePct: effPct,
        trendCapWeeks: Math.round((dial.trendHoriz * 13) / 3),
        orderMultiple: Number(part.order_multiple || 0),
      }) : null

      // Pieces each protection adds to THIS order: the same quantity math is
      // re-run with the adjusters switched on one at a time, in page order,
      // and each step's pieces are the difference it makes.
      const flatWeek = () => 1
      const vq = (over) => rate ? quantity({
        available, ratePerWeek: rate.perWeek, leadWeeks,
        coverWeeks: baseWeeks, gWeekly: 0, weekFactor: flatWeek,
        newBumpPct: 0, surgeOnWait: false, waitSurgePct: 0,
        trendCapWeeks: Math.round((dial.trendHoriz * 13) / 3),
        orderMultiple: 0, ...over,
      }) : null
      const surgeOn = { coverWeeks: effWeeks, surgeOnWait: dial.surgeOnWait, waitSurgePct: effPct }
      const trendOn = { ...surgeOn, gWeekly: trend.applied ? trend.gWeekly : 0 }
      const seasonOn = { ...trendOn, weekFactor }
      const npOn = { ...seasonOn, newBumpPct: np.bumpPct }
      const av0 = vq({})
      const av1 = vq(surgeOn)
      const av2 = vq(trendOn)
      const av3 = vq(seasonOn)
      const av4 = vq(npOn)
      const stepPcs = av0 ? {
        surge: av1.orderRaw - av0.orderRaw,
        trend: av2.orderRaw - av1.orderRaw,
        season: av3.orderRaw - av2.orderRaw,
        newProd: av4.orderRaw - av3.orderRaw,
      } : null

      const plain3mo = rate ? 13 * rate.perWeek : 0
      const flagged = q && plain3mo > 0 && q.order > dial.flagX * plain3mo
      // Actual raw usage over the alert window - spikes INCLUDED - so the
      // clean-median months and the as-it-really-ran months sit side by side.
      let actualRecent = null
      if (selWm && rate) {
        const sSel = weeklySeries(selWm.first, selWm.map, selEnd)
        const nW = Math.min(effWeeks, sSel.length)
        let tot = 0
        for (let i = sSel.length - nW; i < sSel.length; i++) tot += sSel[i]
        actualRecent = { weeks: nW, perWeek: nW > 0 ? tot / nW : 0 }
      }
      const coverWeeksNow = rate && rate.perWeek > 0 ? available / rate.perWeek : 0
      const staleWeeks = Math.max(0, Math.floor((todayMs - selEnd) / (7 * DAY)))

      calc = { perVariation, noData, group, months, poolNames, mine, ownPct, effPct, effWeeks,
               rate, trend, leadDays, leadWeeks, arrivalMs, coveredToMs, seasonRows, shopFlags,
               np, available, q, plain3mo, flagged, stepPcs, actualRecent, coverWeeksNow, staleWeeks, selEnd, stRow }
    }
  }

  // ---------------------------------------------------------------- render
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Advanced Prediction</h1>
          <p className="muted">
            The group sets the ordering schedule first; the single variation is checked after, and can only order more, never change the schedule.
            Every number shows its working. Surge protection is a percentage everywhere.
          </p>
        </div>
      </div>

      <form method="get" className="card">
        <div className="form-row" style={{ alignItems: 'end', flexWrap: 'wrap', gap: 12 }}>
          <label>Part
            <select name="part" defaultValue={selId} className="ap-select">
              <option value="">Choose a part...</option>
              {Object.keys(byCategory).sort().map((cat) => (
                <optgroup key={cat} label={cat}>
                  {byCategory[cat].map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <button className="button" type="submit">Calculate</button>
        </div>
        <details className="ap-dials">
          <summary className="button ap-dials-btn">Adjust the dials</summary>
          <p className="small" style={{ margin: '10px 0 2px' }}>
            Change any dial and press <b>Calculate with these dials</b> to re-run every number on this page with it - a dial change on its own is only for this run. Press <b>Save these dials for this group</b> (below this panel) to make the current dials the group&apos;s baseline for everyone, every visit.
          </p>
          <div className="ap-dial-grid">
            <label>Base months
              <input type="number" name="base" step="0.5" defaultValue={dial.baseMonths} />
              <span className="ap-dial-help">The plain order size before any protection: how many months of normal usage one order should cover. Every protection stacks on top of this.</span>
            </label>
            <label>Pool (top fraction)
              <input type="number" name="pool" step="0.05" defaultValue={dial.poolFrac} />
              <span className="ap-dial-help">Which slice of the group sets the surge %. 0.25 = the average of the top quarter of variations - one freak cannot set it alone, and calm ones cannot water it down.</span>
            </label>
            <label>Trend needs (months)
              <input type="number" name="tmin" step="1" defaultValue={dial.trendMin} />
              <span className="ap-dial-help">A growth trend only counts when the listing has at least this many months of history - with less, growth cannot be told apart from luck.</span>
            </label>
            <label>Trend fires from (%/mo)
              <input type="number" name="tth" step="0.5" defaultValue={dial.trendTh} />
              <span className="ap-dial-help">Growth slower than this per month is treated as noise and ignored. Only a real climb changes the order.</span>
            </label>
            <label>Trend looks back (months)
              <input type="number" name="tlook" step="1" defaultValue={dial.trendLook} />
              <span className="ap-dial-help">How much history the trend line is measured from. Shorter feels a new climb faster; longer is steadier but can flatten a recent takeoff.</span>
            </label>
            <label>Trend horizon (months)
              <input type="number" name="thoriz" step="0.5" defaultValue={dial.trendHoriz} />
              <span className="ap-dial-help">How far out the trend keeps growing in the projection. After this many months it holds flat - so one order only buys this much of the forecast, and the next order re-reads the trend with fresh data.</span>
            </label>
            <label>Trend spike clip (x median)
              <input type="number" name="tclip" step="0.1" defaultValue={dial.trendClip} />
              <span className="ap-dial-help">Before the trend is measured, any 4-week block bigger than this x the listing&apos;s median is cut down to that ceiling - one surge spike cannot fake a lasting trend.</span>
            </label>
            <label>Season fires from (x)
              <input type="number" name="sth" step="0.1" defaultValue={dial.seasonTh} />
              <span className="ap-dial-help">A calendar month counts as seasonal when last year it sold at least this x its year&apos;s normal. Months this order covers get last year&apos;s multiplier applied.</span>
            </label>
            <label>New product under (months)
              <input type="number" name="npmin" step="0.5" defaultValue={dial.npMin} />
              <span className="ap-dial-help">A listing younger than this counts as a new product - too little history to trust its rate yet.</span>
            </label>
            <label>New product bump (%)
              <input type="number" name="npbump" step="5" defaultValue={dial.npBump} />
              <span className="ap-dial-help">The extra % added on top for new products, covering what the short history cannot show yet.</span>
            </label>
            <label>Big-order flag (x plain)
              <input type="number" name="flagx" step="0.5" defaultValue={dial.flagX} />
              <span className="ap-dial-help">If the final order is bigger than this x a plain 3-month order, the page flags it for a human double-check. The flag never blocks or shrinks the order.</span>
            </label>
            <label className="ap-check">
              <span><input type="checkbox" name="wait" value="1" defaultChecked={dial.surgeOnWait} /> Surge % on the waiting weeks too</span>
              <span className="ap-dial-help">Also protect the pieces that sell while the shipment is on the water, not only the shelf target at arrival. Off by default - the surge % already covers the target.</span>
            </label>
          </div>
          <div className="ap-months">
            <div className="ap-months-row">
              <span className="ap-months-lbl">Months that count - surge search</span>
              <input type="hidden" name="scset" value="1" />
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                <label key={m} className="ap-mo"><input type="checkbox" name="sc" value={m} defaultChecked={surgeExclude.indexOf(m) < 0} />{MONTH_NAMES[m]}</label>
              ))}
            </div>
            <div className="ap-months-row">
              <span className="ap-months-lbl">Months that count - trend measure</span>
              <input type="hidden" name="tcset" value="1" />
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                <label key={m} className="ap-mo"><input type="checkbox" name="tc" value={m} defaultChecked={trendExclude.indexOf(m) < 0} />{MONTH_NAMES[m]}</label>
              ))}
            </div>
            <div className="ap-months-row">
              <span className="ap-months-lbl">Months that count - clean usage rate</span>
              <input type="hidden" name="rcset" value="1" />
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                <label key={m} className="ap-mo"><input type="checkbox" name="rc" value={m} defaultChecked={rateExclude.indexOf(m) < 0} />{MONTH_NAMES[m]}</label>
              ))}
            </div>
            <p className="ap-sm muted" style={{ margin: '4px 0 0' }}>A ticked month counts as normal behavior for that calculation. Untick a month you KNOW is special (Mother&apos;s Day, Christmas...) and its spike is handed to the seasonality step instead of being read as a surge, a trend, or the everyday rate. Oct-Jan comes unticked out of the box; the walk just reaches further back for replacement blocks. Each row saves with the dials.</p>
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="button" type="submit">Calculate with these dials</button>
          </div>
        </details>
      </form>

      {part && (
        <form action={saveAdvancedPredictionSettings} className="card ap-saverow">
          <input type="hidden" name="category" value={part.category || ''} />
          <input type="hidden" name="part" value={part.id} />
          <input type="hidden" name="base" value={dial.baseMonths} />
          <input type="hidden" name="pool" value={dial.poolFrac} />
          <input type="hidden" name="tmin" value={dial.trendMin} />
          <input type="hidden" name="tth" value={dial.trendTh} />
          <input type="hidden" name="tlook" value={dial.trendLook} />
          <input type="hidden" name="thoriz" value={dial.trendHoriz} />
          <input type="hidden" name="tclip" value={dial.trendClip} />
          <input type="hidden" name="sth" value={dial.seasonTh} />
          <input type="hidden" name="npmin" value={dial.npMin} />
          <input type="hidden" name="npbump" value={dial.npBump} />
          <input type="hidden" name="flagx" value={dial.flagX} />
          <input type="hidden" name="wait" value={dial.surgeOnWait ? '1' : '0'} />
          <input type="hidden" name="sx" value={surgeExclude.join(',')} />
          <input type="hidden" name="tx" value={trendExclude.join(',')} />
          <input type="hidden" name="rx" value={rateExclude.join(',')} />
          <span className="ap-sm muted">
            {savedAt
              ? 'Saved dials are in use for this group (saved ' + date(String(savedAt).slice(0, 10)) + '). Saving again overwrites them with the dials applied above.'
              : 'No saved dials for this group yet - the dials applied above come from the defaults (or this run). Save to make them the group baseline.'}
          </span>
          <button className="button" type="submit">Save these dials for this group</button>
        </form>
      )}

      {!part && (
        <div className="card"><div className="empty-state">Pick a part. Its whole group (every part with the exact same category name) is calculated together, because they sell as one listing.</div></div>
      )}

      {part && !calc && (
        <div className="card"><div className="empty-state">No usable usage history anywhere in the {part.category} group yet - there is nothing to calculate from.</div></div>
      )}

      {part && calc && (() => {
        const c = calc
        const selName = part.name
        return (
          <>
            <div className="ap-bar">
              <div><span className="ap-lbl">On hand</span><span className={'ap-num' + (Number(c.stRow.on_hand) < 0 ? ' bad' : '')}>{num(c.stRow.on_hand)}</span></div>
              <div><span className="ap-lbl">Incoming</span><span className="ap-num">{num(c.stRow.incoming_qty)}</span></div>
              <div><span className="ap-lbl">Total available</span><span className={'ap-num' + (c.available < 0 ? ' bad' : '')}>{f1(c.available)}</span></div>
              <div><span className="ap-lbl">Normal use</span><span className="ap-num">{c.rate ? f1(c.rate.median4wk) : '-'}</span><span className="ap-sm">per 4 weeks</span></div>
              <div><span className="ap-lbl">Cover</span>
                <span className={'ap-num' + (c.coverWeeksNow * 7 < c.leadDays ? ' bad' : '')}>
                  {c.available <= 0 ? 'out' : f1(c.coverWeeksNow / 4.333) + ' mo'}
                </span>
                {c.available <= 0 && c.rate && c.rate.perWeek > 0 &&
                  <span className="ap-sm">{f1(-c.available / c.rate.perWeek)} wks behind</span>}
              </div>
              <div><span className="ap-lbl">Lead time</span><span className="ap-num todo">{c.leadDays} days</span>
                <span className="ap-sm">{part.lead_time_days_max != null ? 'max ' + num(part.lead_time_days_max) + ' + buffer ' + num(part.safety_stock_days || 0) : 'from reorder horizon'}</span></div>
            </div>

            {c.available < 0 && (
              <div className="card ap-note">
                <strong>Stock below zero is treated as real demand.</strong> People are waiting for these {f0(-c.available)} pieces - the backlog is demand that already happened, so the order below includes it. A warehouse count only ever corrects the stock number; it never lowers the demand this page predicts from.
              </div>
            )}

            {c.staleWeeks >= 2 && (
              <div className="ap-warn">Usage data for this part is <b>{c.staleWeeks} weeks old</b> (to {date(isoOf(c.selEnd))}). Quiet recent weeks may just be missing imports - upload the latest orders before trusting the rate.</div>
            )}

            <div className="card">
              <strong style={{ fontSize: 14 }}>Open reports on this group</strong>
              {openReports.length === 0
                ? <div className="ap-ok">None right now. A zero or running-low report on any {part.category} part would show here - it means the shelf disagrees with these numbers.</div>
                : <ul className="ap-replist">{openReports.map((r) => {
                    const p = parts.find((x) => x.id === r.part_id)
                    return <li key={r.id}><span className={'badge ' + (r.report_type === 'zero' ? 'out' : 'warning')}>{r.report_type === 'zero' ? 'at zero' : 'running low'}</span> {p ? p.name : r.part_id} - {date(r.created_at)}</li>
                  })}</ul>}
            </div>

            {part.months_of_usage_to_order && (
              <div className="card" style={{ background: '#fafbfc' }}>
                <span className="ap-sm muted">Your note saved on this part:</span>
                <p className="small" style={{ margin: '4px 0 0', fontStyle: 'italic' }}>{part.months_of_usage_to_order}</p>
              </div>
            )}

            {/* ---------------- STEP 1: the group decides ---------------- */}
            <div className="ap-step">
              <div className="ap-step-h"><span className="ap-n">1</span><strong>The group decides the schedule - every variation, worst chop and window each</strong>
                <span className="ap-out">group = +{pctOf(c.group.pct)}%</span></div>
              <div className="ap-step-b">
                <p className="small" style={{ margin: '0 0 8px' }}>
                  Group = every part whose category is exactly <b>{part.category}</b> ({groupParts.length} parts). For each one: usage cut into 4-week blocks <b>4 different ways</b> (a block boundary must never split a surge and hide it), Oct-Jan blocks dropped by midpoint, then <b>every 28-week window</b> inside every chop is scored against its own median. The worst combination anywhere in its history is that variation&apos;s surge protection.
                </p>
                {c.perVariation.some((pv) => pv.s.ltPct > 0) && (
                  <p className="small" style={{ margin: '0 0 8px' }}>
                    <b>Era climbs removed:</b> before a window is scored, its own ~6 months are checked for a listing-wide climb (same gates and 1.5x spike-clip as step 4). A real climb in the window&apos;s own time is leveled out first - growth never masquerades as a surge, and an old advertising-driven year is judged against its own trajectory, not today&apos;s. Windows whose era shows no real climb are scored on raw numbers.
                  </p>
                )}
                <table>
                  <thead><tr><th>Variation</th><th>History</th><th>Data to</th><th>Worst chop</th><th>Worst window from</th><th>Surge protection</th></tr></thead>
                  <tbody>
                    {c.perVariation.map((v) => (
                      <tr key={v.part.id} className={(c.poolNames.has(v.part.name) ? 'ap-pool' : '') + (v.part.id === part.id ? ' ap-me' : '')}>
                        <td>{v.part.name}{v.part.id === part.id ? ' <- this one' : ''}</td>
                        <td>{v.s.blocksInHistory} blocks</td>
                        <td>{date(isoOf(v.end))}</td>
                        <td>cut +{v.s.off}wk</td>
                        <td>{date(isoOf(v.s.wfrom))} ({v.s.winWeeks} wks)</td>
                        <td><b>+{pctOf(v.pct)}%</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {c.noData.length > 0 && <p className="ap-sm muted">No usable history yet: {c.noData.map((p) => p.name).join(', ')}</p>}
                <div className="ap-calc">
                  {'Top quarter of ' + c.perVariation.length + '  =  top ' + c.group.k + '\n'}
                  {'(' + c.group.pool.map((x) => '+' + pctOf(x.pct) + '%').join(' + ') + ') / ' + c.group.k + '  =  +' + pctOf(c.group.pct) + '% surge protection for the whole group'}
                </div>
                <div className="ap-why">The top quarter rather than the average, so calm variations cannot hide the risk - and rather than the single worst, so one freak cannot set the number alone. What any variation on the listing has proved possible, all of them get protected against.</div>
                {c.group.pool.map((x) => {
                  const dv = c.perVariation.find((pv) => pv.part.name === x.name)
                  if (!dv) return null
                  return (
                    <details key={dv.part.id} className="ap-drill">
                      <summary>{dv.part.name}: inside its worst window (+{pctOf(dv.pct)}%)</summary>
                      <p className="small" style={{ margin: '6px 0 0' }}>
                        Chop start +{dv.s.off} wk. Window from {date(isoOf(dv.s.wfrom))}, {dv.s.winWeeks} weeks. Normal for that window (its median) is <b>{f1(dv.s.med)}</b> per 4-week block - every spike below is measured against that.{dv.s.ltPct > 0 ? ' This window\u2019s own era was climbing +' + f1(dv.s.ltPct) + '% per 4 weeks (listing-wide) - that climb is removed: each block below is leveled to the window end before scoring.' : ' No real climb in this window\u2019s own era - raw values.'}
                      </p>
                      <table>
                        <thead><tr><th>Block</th><th>Used</th><th>Above normal</th><th>As blocks</th></tr></thead>
                        <tbody>
                          {dv.s.seg.map((b, i) => (
                            <tr key={i} className={b.used > dv.s.med ? 'ap-hot' : ''}>
                              <td>{date(isoOf(b.starts))}</td><td>{f1(b.used)}</td>
                              <td>{b.used > dv.s.med ? '+' + f1(b.used - dv.s.med) : '-'}</td>
                              <td>{b.used > dv.s.med ? f2((b.used - dv.s.med) / dv.s.med) : '0'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="ap-calc">
                        {'Spikes above normal   ' + f2(dv.s.excess) + ' blocks over ' + dv.s.winWeeks + ' weeks\n'}
                        {'Surge protection   ' + f2(dv.s.excess) + ' x ' + baseWeeks + '/' + dv.s.winWeeks + '  /  ' + f2(baseWeeks / 4) + '  =  +' + pctOf(dv.pct) + '%'}
                      </div>
                    </details>
                  )
                })}
              </div>
            </div>

            <div className="ap-band">
              <div><span className="ap-lbl">Months of usage to order</span><span className="ap-big">{f1(c.months.months)}</span></div>
              <div><span className="ap-lbl">Start ordering when cover drops below</span><span className="ap-big">{f1(c.months.months)} mo</span></div>
              <div><span className="ap-lbl">In weeks</span><span className="ap-big">{c.months.weeks}</span></div>
              <span className="ap-band-note">{dial.baseMonths} months x (1 + {pctOf(c.group.pct)}%) rounded to the nearest week - the same schedule for all {c.perVariation.length} variations, because they sell as one listing.{c.stepPcs ? ' On this part\u2019s order below, that surge protection adds ' + f0(Math.max(0, c.stepPcs.surge)) + ' pcs.' : ''}</span>
            </div>

            {/* ---------------- STEP 2: this variation's check ---------------- */}
            <div className="ap-step">
              <div className="ap-step-h"><span className="ap-n">2</span><strong>{selName} - its own surge, as a check only</strong>
                <span className="ap-out">uses +{pctOf(c.effPct)}%{c.stepPcs ? ' = +' + f0(Math.max(0, c.stepPcs.surge)) + ' pcs' : ''}</span></div>
              <div className="ap-step-b">
                {c.mine ? (
                  <>
                    <table>
                      <thead><tr><th>Chop</th><th>Blocks</th><th>Best window from</th><th>Window</th><th>Surge</th></tr></thead>
                      <tbody>
                        {c.mine.s.cuts.map((k) => (
                          <tr key={k.off} className={k.off === c.mine.s.off ? 'ap-me' : ''}>
                            <td>start +{k.off} wk{k.off === c.mine.s.off ? ' <- worst' : ''}</td>
                            <td>{k.nBlocks}</td>
                            <td>{k.bestFrom ? date(isoOf(k.bestFrom)) : '-'}</td>
                            <td>{k.bestWeeks ? k.bestWeeks + ' wks' : '-'}</td>
                            <td>{k.bestPct != null ? '+' + pctOf(k.bestPct) + '%' : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="small" style={{ margin: '10px 0 6px' }}><b>Inside the worst window</b> ({date(isoOf(c.mine.s.wfrom))}, {c.mine.s.winWeeks} weeks, its own median {f1(c.mine.s.med)} per block{c.mine.s.ltPct > 0 ? '; its era\u2019s climb of +' + f1(c.mine.s.ltPct) + '%/4wks removed first' : ''}):</p>
                    <table>
                      <thead><tr><th>Block</th><th>Used</th><th>Above normal</th><th>As blocks</th></tr></thead>
                      <tbody>
                        {c.mine.s.seg.map((b, i) => (
                          <tr key={i} className={b.used > c.mine.s.med ? 'ap-hot' : ''}>
                            <td>{date(isoOf(b.starts))}</td><td>{f1(b.used)}</td>
                            <td>{b.used > c.mine.s.med ? '+' + f1(b.used - c.mine.s.med) : '-'}</td>
                            <td>{b.used > c.mine.s.med ? f2((b.used - c.mine.s.med) / c.mine.s.med) : '0'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="ap-calc">
                      {'Surge in worst window   ' + f2(c.mine.s.excess) + ' blocks over ' + c.mine.s.winWeeks + ' weeks\n'}
                      {'Share of a ' + baseWeeks + '-week order  ' + f2(c.mine.s.excess) + ' x ' + baseWeeks + '/' + c.mine.s.winWeeks + '  =  ' + f2(c.mine.s.excess * baseWeeks / c.mine.s.winWeeks) + ' blocks\n'}
                      {'Surge protection        ' + f2(c.mine.s.excess * baseWeeks / c.mine.s.winWeeks) + ' / ' + f2(baseWeeks / 4) + '  =  +' + pctOf(c.ownPct) + '%\n\n'}
                      {'This variation  +' + pctOf(c.ownPct) + '%   |   its group  +' + pctOf(c.group.pct) + '%   ->  the higher wins: +' + pctOf(c.effPct) + '%' + (c.stepPcs ? '   =  +' + f0(Math.max(0, c.stepPcs.surge)) + ' pcs on this order' : '')}
                    </div>
                    <div className="ap-why">A quiet variation is lifted to the group floor - calm history is not proof of safety, only proof its bad quarter has not come yet. The reverse fires only for a genuine outlier, and it changes this variation&apos;s quantity only - never the group schedule.</div>
                  </>
                ) : (
                  <p className="small">No usable history for this variation yet - it takes the group number +{pctOf(c.group.pct)}% entirely.</p>
                )}
              </div>
            </div>

            {/* ---------------- STEP 3: clean rate ---------------- */}
            <div className="ap-step">
              <div className="ap-step-h"><span className="ap-n">3</span><strong>Clean usage rate - the actual last {c.rate ? c.rate.blocks.length : 0} blocks</strong>
                <span className="ap-out">{c.rate ? f1(c.rate.median4wk) + ' per 4 wks' : 'no data'}</span></div>
              <div className="ap-step-b">
                {c.rate && (
                  <>
                    <table>
                      <thead><tr><th>Block</th><th>Used</th></tr></thead>
                      <tbody>{c.rate.blocks.map((b, i) => (
                        <tr key={i}><td>{date(isoOf(b.starts))}</td><td>{f1(b.used)}</td></tr>))}</tbody>
                    </table>
                    <div className="ap-calc">{'Median of the last ' + c.rate.blocks.length + ' blocks  =  ' + f1(c.rate.median4wk) + ' per 4 weeks  =  ' + f2(c.rate.perWeek) + ' per week'}</div>
                    <div className="ap-why">The median of the <b>actual most recent months</b> - anchored backward from the newest data, never taken from the surge window. Blocks landing in months unticked for the clean rate are skipped and the walk reaches further back instead. Spikes are already paid for by the surge %; the median keeps them out of the rate so they are never charged twice.</div>
                  </>
                )}
              </div>
            </div>

            {/* ---------------- STEP 4: trend ---------------- */}
            <div className="ap-step">
              <div className="ap-step-h"><span className="ap-n">4</span><strong>Trend - the whole listing&apos;s direction</strong>
                <span className={'ap-out' + (c.trend.applied ? '' : ' off')}>{c.trend.applied ? '+' + f1(c.trend.perBlockPct) + '% per 4 wks  =  +' + (c.stepPcs ? f0(Math.max(0, c.stepPcs.trend)) : '0') + ' pcs' : 'not applied'}</span></div>
              <div className="ap-step-b">
                {c.trend.blocks.length > 0 && (
                  <div className="ap-calc">
                    {'Listing blocks (newest last)   ' + c.trend.blocks.map((b) => f0(b.used)).join('  ') + '\n'}
                    {c.trend.clipped.length ? 'Spikes clipped at 1.5x median  ' + c.trend.clipped.map((x) => f0(x)).join('  ') + '\n' : ''}
                    {'Slope (median of every pair)   ' + (c.trend.med > 0 ? f1(c.trend.perBlockPct) + '% per 4 weeks' : '-')}
                  </div>
                )}
                <p className="small" style={{ margin: '8px 0 0' }}>
                  {c.trend.applied
                    ? 'Growth is applied to the projection for the first ' + f1(dial.trendHoriz) + ' months, then held flat - the order only buys ' + f1(dial.trendHoriz) + ' months of what the trend forecasts, and the next order re-reads it. A falling trend is shown but never shrinks an order.'
                    : 'Not applied: ' + c.trend.reason + '.'}
                  {' '}Looks back {dial.trendLook} months; needs {dial.trendMin}+ months and +{dial.trendTh}%/month to fire; all are dials.
                </p>
              </div>
            </div>

            {/* ---------------- STEP 5: seasonality ---------------- */}
            <div className="ap-step">
              <div className="ap-step-h"><span className="ap-n">5</span><strong>Seasonality - from today until the order is used up</strong>
                <span className={'ap-out' + (c.seasonRows.some((r) => r.applied > 1) ? '' : ' off')}>
                  {c.seasonRows.some((r) => r.applied > 1) ? 'applied  =  +' + (c.stepPcs ? f0(Math.max(0, c.stepPcs.season)) : '0') + ' pcs' : c.seasonRows.some((r) => r.candidate && !r.decision) ? 'needs your decision' : c.shopFlags.length ? 'flag only' : 'nothing found'}</span></div>
              <div className="ap-step-b">
                <table>
                  <thead><tr><th>Month (wait + cover)</th><th>Weeks in it</th><th>This part, past years</th><th>The listing, past years</th><th>Whole shop, past years</th><th>Decision</th><th>Applied</th></tr></thead>
                  <tbody>
                    {c.seasonRows.map((r) => (
                      <tr key={r.y * 100 + r.mo}>
                        <td>{MONTH_NAMES[r.mo]} {r.y}</td><td>{r.weeksIn}</td>
                        <td>{r.v.hasHistory ? f1(r.v.factor) + 'x' + (r.v.years.length > 1 ? ' (' + r.v.hits + ' of ' + r.v.years.length + ' yrs)' : '') : 'no history'}</td>
                        <td>{r.l.hasHistory ? f1(r.l.factor) + 'x' + (r.l.years.length > 1 ? ' (' + r.l.hits + ' of ' + r.l.years.length + ' yrs)' : '') : 'no history'}</td>
                        <td>{r.s.hasHistory ? f1(r.s.factor) + 'x' + (r.s.years.length > 1 ? ' (' + r.s.hits + ' of ' + r.s.years.length + ' yrs)' : '') : 'no history'}</td>
                        <td>{r.decision === 'approved' ? 'approved' : r.decision === 'dismissed' ? 'dismissed' : r.candidate ? 'waiting' : '-'}</td>
                        <td>{r.applied > 1 ? <b>{f1(r.applied)}x</b> : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(() => {
                  const twice = []
                  for (const r of c.seasonRows) {
                    if (r.decision === 'approved' && surgeExclude.indexOf(r.mo) < 0 && twice.indexOf(r.mo) < 0) twice.push(r.mo)
                  }
                  if (!twice.length) return null
                  return (
                    <div className="ap-warn"><b>Paid twice:</b> {twice.map((m) => MONTH_NAMES[m]).join(', ')} is approved as seasonal but still ticked in &quot;Months that count - surge search&quot; in the dial panel. Its spike is being charged once inside the surge % and again as the seasonal factor. Untick it there (and Save) so it is only paid once, by the seasonality step.</div>
                  )
                })()}
                {(() => {
                  const seen = []
                  const cards = c.seasonRows.filter((r) => {
                    if (!r.candidate || r.decision) return false
                    if (seen.indexOf(r.mo) >= 0) return false
                    seen.push(r.mo)
                    return true
                  })
                  return cards.map((r) => {
                    const ev = r.v.hits > 0 ? r.v : r.l
                    const level = r.v.hits > 0 ? 'this part' : 'the whole listing'
                    const conf = ev.years.length >= 2 && ev.hits >= 2
                      ? 'Very confident: it spiked in ' + ev.hits + ' of ' + ev.years.length + ' years with data.'
                      : 'Based on ' + ev.years.length + ' year of data - it could be a one-off.'
                    return (
                      <div key={r.mo} className="ap-season-card">
                        <div>
                          <b>{MONTH_NAMES[r.mo]} looks seasonal: {f1(ev.factor)}x normal for {level}.</b>{' '}
                          {conf}{' '}Possible reason{(OCCASIONS[r.mo] || []).length > 1 ? 's' : ''}: {(OCCASIONS[r.mo] || ['none known']).join('; ')}.
                          {' '}Approve to apply {f1(ev.factor)}x to every {MONTH_NAMES[r.mo]} this order touches; dismiss to stop suggesting it.
                        </div>
                        <div style={{ whiteSpace: 'nowrap' }}>
                          <form action={saveSeasonDecision} style={{ display: 'inline' }}>
                            <input type="hidden" name="category" value={part.category || ''} />
                            <input type="hidden" name="part" value={part.id} />
                            <input type="hidden" name="month" value={r.mo} />
                            <input type="hidden" name="decision" value="approved" />
                            <button className="button" type="submit">Approve</button>
                          </form>
                          <form action={saveSeasonDecision} style={{ display: 'inline', marginLeft: 8 }}>
                            <input type="hidden" name="category" value={part.category || ''} />
                            <input type="hidden" name="part" value={part.id} />
                            <input type="hidden" name="month" value={r.mo} />
                            <input type="hidden" name="decision" value="dismissed" />
                            <button className="button" type="submit">Dismiss</button>
                          </form>
                        </div>
                      </div>
                    )
                  })
                })()}
                {Object.keys(seasonDecisions).length > 0 && (
                  <div className="ap-sm muted" style={{ margin: '8px 0 0' }}>
                    Decided months:{' '}
                    {Object.keys(seasonDecisions).map((mk) => (
                      <span key={mk} style={{ marginRight: 12 }}>
                        {MONTH_NAMES[Number(mk)]}: {seasonDecisions[mk]}
                        <form action={saveSeasonDecision} style={{ display: 'inline', marginLeft: 4 }}>
                          <input type="hidden" name="category" value={part.category || ''} />
                          <input type="hidden" name="part" value={part.id} />
                          <input type="hidden" name="month" value={mk} />
                          <input type="hidden" name="decision" value="clear" />
                          <button className="ap-linkbtn" type="submit">undo</button>
                        </form>
                      </span>
                    ))}
                  </div>
                )}
                {c.shopFlags.length > 0 && (
                  <div className="ap-warn"><b>Seasonal months are inside this order&apos;s window and this listing has no history for them.</b> Shop-wide last year: {c.shopFlags.map((r) => MONTH_NAMES[r.mo] + ' ran ' + f1(r.s.factor) + 'x').join(', ')}. Per your rule a shop-wide signal is never added automatically - if this listing follows the shop, raise the order by hand.</div>
                )}
                <div className="ap-why">&quot;No history&quot; and &quot;checked, all clear&quot; would otherwise look identical on screen. They are opposite situations. Nothing is applied automatically: a month at {f1(dial.seasonTh)}x or more becomes a suggestion with the likely holiday or season named, and only your Approve applies it. The whole shop column only ever flags. With 2+ years of data a repeated spike is called out as very confident.</div>
              </div>
            </div>

            {/* ---------------- STEP 6: new product ---------------- */}
            <div className="ap-step">
              <div className="ap-step-h"><span className="ap-n">6</span><strong>New-product check</strong>
                <span className={'ap-out' + (c.np.isNew ? '' : ' off')}>{c.np.isNew ? '+' + c.np.bumpPct + '% extra  =  +' + (c.stepPcs ? f0(Math.max(0, c.stepPcs.newProd)) : '0') + ' pcs' : 'passes - no extra'}</span></div>
              <div className="ap-step-b">
                <p className="small" style={{ margin: 0 }}>This listing&apos;s data starts {f1(c.np.ageMonths)} months ago; under {dial.npMin} months everything gets an extra +{dial.npBump}% because a few weeks of history can hide almost anything.</p>
              </div>
            </div>

            {/* ---------------- STEP 7: pieces ---------------- */}
            {c.q && c.rate && (
              <div className="ap-step">
                <div className="ap-step-h"><span className="ap-n">7</span><strong>The order, in pieces</strong>
                  <span className="ap-out">{f0(c.q.order)} pieces</span></div>
                <div className="ap-step-b">
                  <div className="ap-calc">
                    {(c.available < 0 ? 'Owed right now (backlog)                    ' + f1(-c.available) + '\n' : 'On the shelf right now                      ' + f1(c.available) + '\n')}
                    {'Sold during the ' + c.leadDays + '-day wait (' + c.leadWeeks + ' wks)      ' + f1(c.q.lead) + (c.trend.applied || c.seasonRows.some((r) => r.applied > 1) ? '   (trend/season inside)' : '') + '\n'}
                    {'Shelf target at arrival (' + c.effWeeks + ' wks cover)     ' + f1(c.q.cover) + '\n'}
                    {'Projected at arrival                        ' + f1(c.q.projectedAtArrival) + '\n'}
                    {'Order  =  ' + f1(c.q.cover) + ' - (' + f1(c.q.projectedAtArrival) + ')  =  ' + f1(c.q.orderRaw) + '  ->  ' + f0(c.q.order) + ' pieces'}
                    {part.unit_price ? '\nAt ' + num(part.unit_price) + ' ' + (part.currency || 'USD') + ' each  =  ' + f0(c.q.order * part.unit_price) + ' ' + (part.currency || 'USD') : ''}
                  </div>
                  {c.flagged && (
                    <div className="ap-flag"><b>{f1(c.q.order / c.plain3mo)}x a plain 3-month order</b> (over the {dial.flagX}x line). Nothing is capped - this flag exists so a big number is always a decision, never a surprise. The breakdown above shows exactly where it comes from.</div>
                  )}
                  {c.rate.perWeek <= 0 && <div className="ap-warn">The clean rate is zero - no recent usage - so this order is backlog only.</div>}
                </div>
              </div>
            )}

            <div className="ap-final">
              <div><span className="ap-lbl">Order</span><span className="ap-big">{c.q ? f0(c.q.order) + ' pcs' : '-'}</span></div>
              <div><span className="ap-lbl">Months of normal usage ordered</span><span className="ap-big">{c.q && c.rate && c.rate.perWeek > 0 ? f1(c.q.order / (c.rate.perWeek * 13 / 3)) + ' mo' : '-'}</span></div>
              <div><span className="ap-lbl">{'Months of actual usage ordered' + (c.actualRecent ? ' (last ' + c.actualRecent.weeks + ' wks pace)' : '')}</span><span className="ap-big">{c.q && c.actualRecent && c.actualRecent.perWeek > 0 ? f1(c.q.order / (c.actualRecent.perWeek * 13 / 3)) + ' mo' : '-'}</span></div>
              <div><span className="ap-lbl">Arrives about</span><span className="ap-big">{date(isoOf(c.arrivalMs))}</span></div>
              <div><span className="ap-lbl">Covered to about</span><span className="ap-big">{date(isoOf(c.coveredToMs))}</span></div>
              <div><span className="ap-lbl">Surge protection</span><span className="ap-big">+{pctOf(c.effPct)}%{c.stepPcs ? ' = +' + f0(Math.max(0, c.stepPcs.surge)) + ' pcs' : ''}</span></div>
              <div><span className="ap-lbl">Alert threshold</span><span className="ap-big">{f1(c.months.months)} mo</span></div>
              <span className="ap-band-note">Deterministic - the same inputs always give this same answer. Change any dial above and every step re-runs from there.</span>
            </div>
          </>
        )
      })()}
    </>
  )
}
