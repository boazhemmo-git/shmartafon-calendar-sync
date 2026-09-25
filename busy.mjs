// Turns an iCal feed into busy blocks per Israeli calendar date.
// Only times are kept — never titles, locations or attendees.
import IcalExpander from 'ical-expander'

export const TZ = 'Asia/Jerusalem'
const DAY = 24 * 60

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** Israel-local date string and minute-of-day for an instant. */
function local(ms) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) }
}

function addDays(ds, n) {
  const [y, m, d] = ds.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

function add(out, date, start, end) {
  if (end <= start) return
  ;(out[date] ??= []).push({ start, end })
}

/** Split an absolute [startMs, endMs) interval into per-date blocks in Israel time. */
function addTimed(out, startMs, endMs) {
  const a = local(startMs)
  const b = local(endMs)
  if (a.date === b.date) return add(out, a.date, a.min, b.min)
  add(out, a.date, a.min, DAY)
  for (let d = addDays(a.date, 1); d < b.date; d = addDays(d, 1)) add(out, d, 0, DAY)
  add(out, b.date, 0, b.min)
}

function merge(blocks) {
  const sorted = [...blocks].sort((x, y) => x.start - y.start)
  const out = []
  for (const b of sorted) {
    const last = out[out.length - 1]
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end)
    else out.push({ ...b })
  }
  return out
}

/** An event counts as busy unless it's marked "free" (TRANSPARENT) or cancelled. */
function isBusy(item) {
  const c = item.component
  const transp = String(c.getFirstPropertyValue('transp') ?? '').toUpperCase()
  const status = String(c.getFirstPropertyValue('status') ?? '').toUpperCase()
  return transp !== 'TRANSPARENT' && status !== 'CANCELLED'
}

/**
 * @param {string} ics      iCal text
 * @param {Date} from       window start
 * @param {Date} to         window end
 * @returns {Record<string, {start:number,end:number}[]>} date → merged busy blocks
 */
export function busyFromIcs(ics, from, to) {
  const expander = new IcalExpander({ ics, maxIterations: 5000 })
  const { events, occurrences } = expander.between(from, to)
  const instances = [
    ...events.map((e) => ({ item: e, startDate: e.startDate, endDate: e.endDate })),
    ...occurrences.map((o) => ({ item: o.item, startDate: o.startDate, endDate: o.endDate })),
  ]
  const out = {}
  for (const { item, startDate, endDate } of instances) {
    if (!isBusy(item)) continue
    if (startDate.isDate) {
      // All-day event: whole local days from start (inclusive) to end (exclusive).
      const first = startDate.toString().slice(0, 10)
      const last = endDate ? endDate.toString().slice(0, 10) : addDays(first, 1)
      for (let d = first; d < last; d = addDays(d, 1)) add(out, d, 0, DAY)
    } else {
      const s = startDate.toJSDate().getTime()
      const e = endDate ? endDate.toJSDate().getTime() : s
      addTimed(out, s, e)
    }
  }
  for (const d of Object.keys(out)) out[d] = merge(out[d])
  return out
}

/** Union of several feeds' results. */
export function mergeBusy(maps) {
  const out = {}
  for (const m of maps) for (const [d, blocks] of Object.entries(m)) (out[d] ??= []).push(...blocks)
  for (const d of Object.keys(out)) out[d] = merge(out[d])
  return out
}

export { local as israelLocal }
