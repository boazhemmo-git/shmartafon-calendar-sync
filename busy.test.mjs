import assert from 'node:assert/strict'
import { test } from 'node:test'
import { busyFromIcs, mergeBusy } from './busy.mjs'

const H = (h, m = 0) => h * 60 + m

// Shaped like Google Calendar's "secret address in iCal format" export.
const ics = `BEGIN:VCALENDAR
PRODID:-//Google Inc//Google Calendar 70.9054//EN
VERSION:2.0
CALSCALE:GREGORIAN
X-WR-TIMEZONE:Asia/Jerusalem
BEGIN:VTIMEZONE
TZID:Asia/Jerusalem
BEGIN:DAYLIGHT
TZOFFSETFROM:+0200
TZOFFSETTO:+0300
TZNAME:IDT
DTSTART:19700327T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1FR
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0300
TZOFFSETTO:+0200
TZNAME:IST
DTSTART:19701025T020000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
DTSTART;TZID=Asia/Jerusalem:20260928T160000
DTEND;TZID=Asia/Jerusalem:20260928T183000
RRULE:FREQ=WEEKLY;BYDAY=MO
EXDATE;TZID=Asia/Jerusalem:20261005T160000
UID:weekly@google.com
SUMMARY:Secret meeting title
TRANSP:OPAQUE
END:VEVENT
BEGIN:VEVENT
DTSTART:20260930T120000Z
DTEND:20260930T130000Z
UID:utc@google.com
SUMMARY:Lunch
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=Asia/Jerusalem:20260930T170000
DTEND;TZID=Asia/Jerusalem:20260930T180000
UID:free@google.com
SUMMARY:Just a reminder
TRANSP:TRANSPARENT
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261001
DTEND;VALUE=DATE:20261003
UID:allday@google.com
SUMMARY:Vacation
TRANSP:OPAQUE
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=Asia/Jerusalem:20261006T220000
DTEND;TZID=Asia/Jerusalem:20261007T020000
UID:night@google.com
SUMMARY:Night shift
END:VEVENT
END:VCALENDAR`

test('expands recurrences, respects exceptions, skips free events, splits across days', () => {
  const busy = busyFromIcs(ics, new Date('2026-09-20T00:00:00Z'), new Date('2026-10-20T00:00:00Z'))
  // Weekly Monday 16:00–18:30 local, except 5.10.
  assert.deepEqual(busy['2026-09-28'], [{ start: H(16), end: H(18, 30) }])
  assert.equal(busy['2026-10-05'], undefined)
  assert.deepEqual(busy['2026-10-12'], [{ start: H(16), end: H(18, 30) }])
  // 12:00Z on 30.9 is 15:00 in Israel (IDT, +3); the TRANSPARENT event is ignored.
  assert.deepEqual(busy['2026-09-30'], [{ start: H(15), end: H(16) }])
  // All-day opaque event covers 1.10 and 2.10 only.
  assert.deepEqual(busy['2026-10-01'], [{ start: 0, end: H(24) }])
  assert.deepEqual(busy['2026-10-02'], [{ start: 0, end: H(24) }])
  assert.equal(busy['2026-10-03'], undefined)
  // Night shift split at midnight.
  assert.deepEqual(busy['2026-10-06'], [{ start: H(22), end: H(24) }])
  assert.deepEqual(busy['2026-10-07'], [{ start: 0, end: H(2) }])
  // Nothing but times is kept.
  assert.ok(!JSON.stringify(busy).includes('Secret'))
})

test('winter time (after 25.10) uses +2', () => {
  const winter = ics.replace('20260930T120000Z', '20261104T120000Z').replace('20260930T130000Z', '20261104T130000Z')
  const busy = busyFromIcs(winter, new Date('2026-11-01T00:00:00Z'), new Date('2026-11-10T00:00:00Z'))
  assert.deepEqual(busy['2026-11-04'], [{ start: H(14), end: H(15) }])
})

test('merges several calendars', () => {
  const m = mergeBusy([{ '2026-10-01': [{ start: 60, end: 120 }] }, { '2026-10-01': [{ start: 100, end: 200 }], '2026-10-02': [{ start: 0, end: 30 }] }])
  assert.deepEqual(m, { '2026-10-01': [{ start: 60, end: 200 }], '2026-10-02': [{ start: 0, end: 30 }] })
})
