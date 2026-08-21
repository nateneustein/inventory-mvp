// @ts-nocheck
/**
 * The Advanced Prediction engine.
 *
 * Every function here is one step of the calculation the team designed in
 * conversation, and each was validated against hand-checked SQL runs before
 * this file was written. Deterministic throughout: same inputs, same answer.
 * There is no AI anywhere in this file.
 *
 * The vocabulary used by the page:
 *   block   - 4 consecutive weeks of usage, never overlapping
 *   chop    - one of the 4 possible places the 4-week grid can start
 *   window  - 7 consecutive blocks (28 weeks) judged against their own median
 *   surge % - how much worse a bad order-window is than a calm one
 */

const DAY = 86400000

export function dms(s) { return new Date(s + 'T00:00:00Z').getTime() }
export function isoOf(t) { return new Date(t).toISOString().slice(0, 10) }

export function median(a) {
  const s = [...a].sort((x, y) => x - y)
  const n = s.length
  if (n === 0) return 0
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}

/**
 * Weekly rows for one part (or a whole listing summed) into an indexed map.
 * A row with a null quantity still extends the span - it proves the week was
 * imported - it just counts as zero usage.
 */
export function buildWeekMap(rows) {
  if (!rows || rows.length === 0) return null
  // History STARTS at the first week with actual usage. A leading null/zero
  // row (a stock-balance marker from before the part ever sold) must not
  // fabricate months of fake dead history. Trailing null rows still extend
  // the span - they prove the week was imported.
  let first = Infinity
  let ownLast = -Infinity
  for (const r of rows) {
    const t = dms(r.week)
    if ((Number(r.qty) || 0) > 0 && t < first) first = t
    if (t > ownLast) ownLast = t
  }
  if (!isFinite(first)) return null
  const map = new Map()
  for (const r of rows) {
    const i = Math.round((dms(r.week) - first) / (7 * DAY))
    if (i < 0) continue
    map.set(i, (map.get(i) || 0) + (Number(r.qty) || 0))
  }
  return { first, map, ownLast }
}

/**
 * Zero-filled series from the first data week to the end week.
 * A missing week inside the span is a real zero - the usage table only
 * writes rows when something moved. Skipping the gaps would inflate
 * "normal" by about a third on this data.
 */
export function weeklySeries(first, map, end) {
  const n = Math.floor((end - first) / (7 * DAY)) + 1
  const arr = []
  for (let i = 0; i < n; i++) arr.push(map.get(i) || 0)
  return arr
}

/** A block is seasonal when its midpoint lands in Oct, Nov, Dec or Jan. */
export function isSeasonalBlock(startMs, months) {
  const mo = new Date(startMs + 14 * DAY).getUTCMonth() + 1
  const set = Array.isArray(months) ? months : [10, 11, 12, 1]
  return set.indexOf(mo) >= 0
}

/** Non-overlapping 4-week blocks starting at week off; complete blocks only. */
export function chop(series, first, off, excludeMonths) {
  const blocks = []
  for (let i = off; i + 4 <= series.length; i += 4) {
    const used = series[i] + series[i + 1] + series[i + 2] + series[i + 3]
    const starts = first + i * 7 * DAY
    if (!isSeasonalBlock(starts, excludeMonths)) blocks.push({ starts, used })
  }
  return blocks
}

/**
 * The locked surge rule: 4 chops x every 7-block window inside each chop.
 * Each window is scored as the total demand above its own median, in blocks,
 * scaled to the base order window. The worst combination anywhere in the
 * history wins - an average would dilute a real surge, and a single fixed
 * chop could split one across a block boundary and hide it.
 */
export function surgeSearch(first, map, end, baseWeeks, localTrend, excludeMonths, medianFloorFrac, absFloorPcs, lookbackWeeks) {
  const bw = baseWeeks || 13
  const series = weeklySeries(first, map, end)
  // The surge must have HAPPENED recently: the search only reads the last
  // lookbackWeeks of history (a yearly season always fits inside 12 months,
  // so recurring spikes never fall out - only stale one-offs do). The
  // whole-life median for the optional floor still uses the full history.
  let sFirst = first
  let ser = series
  if (lookbackWeeks && lookbackWeeks > 0 && ser.length > lookbackWeeks) {
    sFirst = first + (ser.length - lookbackWeeks) * 7 * DAY
    ser = ser.slice(ser.length - lookbackWeeks)
  }
  // Dead-period floor: the divider (a window's median) may never fall below
  // this fraction of the variation's WHOLE-LIFE median block - zeros included,
  // counted from its first reported week. A spike in a dead stretch must not
  // divide by almost-nothing and read as an absurd percentage forever.
  const lifeBlocks = chop(series, first, 0, excludeMonths) // full life, on purpose
  const lifeMed = lifeBlocks.length ? median(lifeBlocks.map(function (b) { return b.used })) : 0
  // Two independent floors, the higher wins: a fraction of the variation's
  // whole-life median, and/or an absolute pieces floor (used for the GROUP
  // number so a 1-to-25 jump on a tiny variation cannot inflate everyone).
  const floorVal = Math.max((medianFloorFrac || 0) * lifeMed, absFloorPcs || 0)
  let best = null
  const cuts = []
  for (let off = 0; off < 4; off++) {
    const blocks = chop(ser, sFirst, off, excludeMonths)
    const n = blocks.length
    let cutBest = null
    if (n > 0) {
      // A window must be CONSECUTIVE in real time. When excluded months cut
      // the timeline (e.g. Oct-Jan dropped), a window may never stitch
      // September onto February - each unbroken stretch is scored on its own,
      // with every 7-block window inside it (or the whole stretch if shorter).
      const segs = []
      let segStart = 0
      for (let i = 1; i <= n; i++) {
        if (i === n || blocks[i].starts - blocks[i - 1].starts !== 28 * DAY) {
          segs.push([segStart, i - 1])
          segStart = i
        }
      }
      const windows = []
      for (const [sa, sb] of segs) {
        if (sb - sa + 1 >= 7) {
          for (let i = sa; i + 6 <= sb; i++) windows.push([i, i + 6])
        } else {
          windows.push([sa, sb])
        }
      }
      for (const [ws, we] of windows) {
        const raw = blocks.slice(ws, we + 1)
        // The window's own ERA is checked for a listing-wide climb (same
        // gates and 1.5x spike-clip as the trend step, measured over the
        // ~6 months ending where this window ends). A real era climb is
        // leveled out block by block - growth must never masquerade as a
        // surge, and an old advertising-driven year is judged against its
        // own trajectory, not today's. No real climb -> raw numbers.
        const winEnd = raw[raw.length - 1].starts + 28 * DAY
        const lt = localTrend ? localTrend(raw[0].starts, winEnd) : null
        const g = lt && lt.applied && lt.gWeekly !== 0 ? lt.gWeekly : 0
        const seg = raw.map((b) => {
          const f = g !== 0 ? 1 + g * ((winEnd - (b.starts + 14 * DAY)) / (7 * DAY)) : 1
          return { starts: b.starts, used: f > 0 ? b.used * f : b.used, lift: f }
        })
        const medRaw = median(seg.map((b) => b.used))
        // A window whose own median is zero is a dead window - never scoreable.
        // The floor only lifts LOW-but-alive medians, it must not resurrect
        // windows that were rightly skipped before.
        if (medRaw <= 0) continue
        const med = Math.max(medRaw, floorVal)
        const excess = seg.reduce((s, b) => s + Math.max(b.used - med, 0), 0) / med
        const winWeeks = seg.length * 4
        const score = (excess * bw) / winWeeks / (bw / 4)
        const cand = { score, pct: score * 100, off, wfrom: seg[0].starts,
                       winWeeks, med, medRaw, lifeMed, floored: med > medRaw + 1e-9,
                       excess, seg, blocksInHistory: n,
                       ltPct: g !== 0 ? lt.perBlockPct : 0 }
        if (!cutBest || score > cutBest.score) cutBest = cand
        if (!best || score > best.score) best = cand
      }
    }
    cuts.push({ off, nBlocks: n,
      bestPct: cutBest ? cutBest.pct : null,
      bestFrom: cutBest ? cutBest.wfrom : null,
      bestWeeks: cutBest ? cutBest.winWeeks : null })
  }
  if (best) best.cuts = cuts
  return best
}

/** Group number: average of the top quarter (rounded up) of variation surge %. */
export function groupSurge(entries, fraction) {
  const f = fraction || 0.25
  const sorted = [...entries].sort((a, b) => b.pct - a.pct)
  const k = Math.max(1, Math.ceil(sorted.length * f))
  const pool = sorted.slice(0, k)
  return { pct: pool.reduce((s, x) => s + x.pct, 0) / pool.length, pool, k, sorted }
}

/** Months to order = alert threshold: base x (1 + group %), to the nearest week. */
export function monthsToOrder(pct, baseMonths) {
  const bm = baseMonths || 3
  const months = bm * (1 + pct / 100)
  const weeks = Math.round((months * 13) / 3)
  return { months, weeks }
}

/**
 * The clean usage rate: the median of the ACTUAL last N months of blocks,
 * anchored backward from the newest data - never from the surge window.
 * Spikes are already paid for by the surge %, so the median keeps them out
 * of the rate; counting them here too would charge for them twice.
 */
export function cleanRate(first, map, end, coverWeeks, excludeMonths) {
  const series = weeklySeries(first, map, end)
  const want = Math.max(1, Math.ceil((coverWeeks || 13) / 4))
  const blocks = []
  for (let hi = series.length; hi - 4 >= 0 && blocks.length < want; hi -= 4) {
    const lo = hi - 4
    const starts = first + lo * 7 * DAY
    if (excludeMonths && isSeasonalBlock(starts, excludeMonths)) continue
    let used = 0
    for (let i = lo; i < hi; i++) used += series[i]
    blocks.unshift({ starts, used })
  }
  const med = median(blocks.map((b) => b.used))
  return { perWeek: med / 4, median4wk: med, blocks }
}

/**
 * Listing-wide trend. Blocks anchored backward from the newest data,
 * seasonal blocks excluded (Christmas belongs to the seasonality step),
 * spikes clipped at 1.5x the median (surges belong to the surge step),
 * slope = the median of every pairwise block-to-block slope, so no single
 * month can set the direction. Upward only - a falling trend is reported
 * but never shrinks an order.
 */
export function trendSearch(first, map, end, opts) {
  const o = Object.assign(
    { minMonths: 4, thresholdPct: 2, maxBlocks: 13, clipMult: 1.5 }, opts || {})
  const series = weeklySeries(first, map, end)
  const all = []
  for (let hi = series.length; hi - 4 >= 0 && all.length < o.maxBlocks; hi -= 4) {
    const lo = hi - 4
    let used = 0
    for (let i = lo; i < hi; i++) used += series[i]
    const starts = first + lo * 7 * DAY
    if (!isSeasonalBlock(starts, o.excludeMonths)) all.unshift({ starts, used })
  }
  const out = { applied: false, reason: '', perBlockPct: 0, gWeekly: 0,
                blocks: all, clipped: [], med: 0, spanMonths: 0 }
  if (all.length === 0) { out.reason = 'no usable history'; return out }
  out.spanMonths = (end - all[0].starts) / (30.44 * DAY)
  if (all.length < 4 || out.spanMonths < o.minMonths) {
    out.reason = 'needs at least ' + o.minMonths + ' months of history'
    return out
  }
  const med = median(all.map((b) => b.used))
  out.med = med
  if (med <= 0) { out.reason = 'no baseline to measure against'; return out }
  const clipped = all.map((b) => Math.min(b.used, o.clipMult * med))
  out.clipped = clipped
  const xs = all.map((b) => (b.starts - all[0].starts) / (28 * DAY))
  const slopes = []
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const dx = xs[j] - xs[i]
      if (dx > 0) slopes.push((clipped[j] - clipped[i]) / dx)
    }
  }
  const slope = median(slopes)
  out.perBlockPct = (slope / med) * 100
  // A real trend in EITHER direction is usable for surge-leveling (judging a
  // window against its own era's trajectory). The projection in step 4 still
  // only ever applies upward - an order is never shrunk by a falling trend.
  if (Math.abs(out.perBlockPct) >= o.thresholdPct) {
    out.levelable = true
    out.gWeekly = out.perBlockPct / 100 / 4
  }
  if (out.perBlockPct <= 0) {
    out.reason = 'direction is flat or down - an order is never shrunk'
    return out
  }
  if (out.perBlockPct < o.thresholdPct) {
    out.reason = 'below the ' + o.thresholdPct + '% per month threshold'
    return out
  }
  out.applied = true
  out.gWeekly = out.perBlockPct / 100 / 4
  return out
}

/** Monthly rows summed into a year*100+month keyed map. */
export function buildMonthly(rows) {
  const m = new Map()
  for (const r of rows || []) {
    const t = new Date(r.month + 'T00:00:00Z')
    const key = t.getUTCFullYear() * 100 + (t.getUTCMonth() + 1)
    m.set(key, (m.get(key) || 0) + (Number(r.qty) || 0))
  }
  return m
}

/** A year's baseline = the median of its non-seasonal months (Feb-Sep). */
export function yearBaseline(monthMap, year) {
  const vals = []
  for (let mo = 2; mo <= 9; mo++) {
    const v = monthMap.get(year * 100 + mo)
    if (v !== undefined) vals.push(v)
  }
  return vals.length >= 3 ? median(vals) : null
}

/**
 * For one covered calendar month: what did the SAME month do last year,
 * against that year's own baseline? "No history" is reported as exactly
 * that - it must never read as "checked, all clear".
 */
export function seasonCheck(monthMap, year, mo) {
  const prev = monthMap.get((year - 1) * 100 + mo)
  const base = yearBaseline(monthMap, year - 1)
  if (prev === undefined || base === null || base <= 0) return { hasHistory: false, factor: 1 }
  return { hasHistory: true, factor: prev / base }
}

/**
 * Multi-year season scan for one calendar month: EVERY prior year with data
 * is checked against its own Feb-Sep baseline, so with 2+ years of history a
 * repeated spike becomes a confident pattern instead of a maybe-one-off.
 * `contradicted` is the veto the page leans on: an older year cleared the bar
 * but the newest year with data did not. `repeated` (2+ years cleared) only
 * changes how confidently the suggestion is worded.
 */
export function seasonScan(monthMap, targetYear, mo, threshold) {
  const th = threshold || 1.3
  const years = []
  for (let y = targetYear - 1; y >= targetYear - 6; y--) {
    const val = monthMap.get(y * 100 + mo)
    const base = yearBaseline(monthMap, y)
    if (val === undefined || base === null || base <= 0) continue
    years.push({ y, factor: val / base })
  }
  const hits = years.filter(function (r) { return r.factor >= th })
  const factor = hits.length
    ? median(hits.map(function (r) { return r.factor }))
    : (years.length ? median(years.map(function (r) { return r.factor })) : 1)
  /* A newer year gets a veto. The hits above are medianed on their own, so a
     year that looked and DISAGREED is otherwise dropped from the maths instead
     of counting against the spike - which let one old loud year keep proposing
     itself forever. `contradicted` is that case and only that case: the most
     recent year with data did NOT clear the bar while an older one did.
     years[0] is the newest, because the loop above counts backwards.
     A month with only one year behind it is NOT contradicted - nothing has
     disagreed with it, there simply has not been a second year yet. That is a
     confidence question, not a veto, so `repeated` is reported separately and
     used for wording rather than for blocking. */
  const latest = years.length ? years[0] : null
  const contradicted = hits.length > 0 && latest !== null && latest.factor < th
  const repeated = hits.length >= 2
  return { hasHistory: years.length > 0, years, hits: hits.length, factor, repeated, contradicted, latest }
}

/** The calendar months a run of weeks touches, with how many weeks land in each. */
export function coveredCalendarMonths(startMs, weeks) {
  const buckets = []
  const seen = new Map()
  for (let w = 0; w < weeks; w++) {
    const mid = new Date(startMs + w * 7 * DAY + 3.5 * DAY)
    const y = mid.getUTCFullYear()
    const mo = mid.getUTCMonth() + 1
    const key = y * 100 + mo
    if (!seen.has(key)) { seen.set(key, { y, mo, weeksIn: 0 }); buckets.push(seen.get(key)) }
    seen.get(key).weeksIn++
  }
  return buckets
}

/** Under the minimum age, a new listing gets an extra conservatism bump. */
export function newProductCheck(listingFirst, todayMs, minMonths, bumpPct) {
  const ageMonths = (todayMs - listingFirst) / (30.44 * DAY)
  const isNew = ageMonths < (minMonths || 2)
  return { isNew, ageMonths, bumpPct: isNew ? (bumpPct || 25) : 0 }
}

/**
 * The pieces. Week by week from today:
 *   demand(w) = rate x trend growth at week w x seasonal factor for w's month
 *               x new-product bump
 * Lead weeks drain the shelf before the ship lands; cover weeks are the
 * shelf target at arrival. order = cover demand - (available - lead demand).
 * Stock below zero is real demand - the backlog is inside available.
 */
export function quantity(q) {
  const bump = 1 + (q.newBumpPct || 0) / 100
  const g = q.gWeekly || 0
  const factorOf = q.weekFactor || function () { return 1 }
  const cap = q.trendCapWeeks && q.trendCapWeeks > 0 ? q.trendCapWeeks : Infinity
  const demand = function (w) {
    return q.ratePerWeek * (1 + g * Math.min(w, cap)) * factorOf(w) * bump
  }
  let lead = 0
  for (let w = 1; w <= q.leadWeeks; w++) lead += demand(w)
  if (q.surgeOnWait) lead *= 1 + (q.waitSurgePct || 0) / 100
  let cover = 0
  for (let w = q.leadWeeks + 1; w <= q.leadWeeks + q.coverWeeks; w++) cover += demand(w)
  const projectedAtArrival = q.available - lead
  const orderRaw = cover - projectedAtArrival
  let order = Math.max(0, Math.ceil(orderRaw))
  if (q.orderMultiple && q.orderMultiple > 0 && order > 0) {
    order = Math.ceil(order / q.orderMultiple) * q.orderMultiple
  }
  return { lead, cover, projectedAtArrival, orderRaw, order }
}
