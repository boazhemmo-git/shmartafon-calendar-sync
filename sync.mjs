// Background job: reads each parent's private iCal addresses from Firestore, computes busy
// times, and writes them to people/{uid}.calendar for the app to show as "busy".
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './admin.mjs'
import { busyFromIcs, mergeBusy } from './busy.mjs'

const PAST_DAYS = 7
const FUTURE_DAYS = 70

async function fetchIcs(url) {
  const res = await fetch(url.replace(/^webcal:/i, 'https:'), { signal: AbortSignal.timeout(20_000), redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('not an iCal feed')
  return text
}

/** Errors are shown to the parent in the app, so they must never contain the secret address. */
function describe(err) {
  const msg = String(err?.message ?? err)
  if (/HTTP 404|HTTP 403|HTTP 401/.test(msg)) return 'הכתובת לא נמצאה או שאין אליה גישה (אולי אופסה?)'
  if (/not an iCal/.test(msg)) return 'זו כתובת של דף ולא של קובץ יומן — צריך את ״כתובת סודית בפורמט iCal״ (מסתיימת ב-basic.ics)'
  if (/timeout|aborted/i.test(msg)) return 'היומן לא הגיב בזמן'
  return 'שגיאה בקריאת היומן'
}

async function main() {
  const db = adminDb()
  const now = Date.now()
  const from = new Date(now - PAST_DAYS * 86_400_000)
  const to = new Date(now + FUTURE_DAYS * 86_400_000)

  const feeds = await db.collection('calendarFeeds').get()
  const withFeed = new Set()
  for (const feed of feeds.docs) {
    const uid = feed.id
    withFeed.add(uid)
    const person = db.collection('people').doc(uid)
    if (!(await person.get()).exists) continue
    const results = []
    const errors = []
    for (const url of feed.data().urls ?? []) {
      try {
        results.push(busyFromIcs(await fetchIcs(url), from, to))
      } catch (e) {
        errors.push(describe(e))
        // Log the kind of failure and the host only — the full address is a secret.
        let host = '?'
        try {
          host = new URL(url.replace(/^webcal:/i, 'https:')).host
        } catch {
          host = 'invalid URL'
        }
        console.log(`  feed on ${host} failed: ${String(e?.message ?? e).slice(0, 120)}`)
      }
    }
    const calendar = { syncedAt: Date.now(), error: errors.length ? [...new Set(errors)].join(' · ') : null }
    if (results.length) calendar.busy = mergeBusy(results)
    else {
      // Every feed failed: keep the last good busy times rather than wiping them.
      const prev = (await person.get()).get('calendar.busy')
      if (prev) calendar.busy = prev
    }
    // update() replaces the whole field, so dates that no longer have events disappear.
    await person.update({ calendar })
    const days = Object.keys(calendar.busy ?? {}).length
    console.log(`${uid.slice(0, 6)}…: ${days} days with events${errors.length ? `, ${errors.length} feed error(s)` : ''}`)
  }

  // Parents who removed their calendar: clear the synced busy times.
  const people = await db.collection('people').get()
  for (const p of people.docs) {
    if (!withFeed.has(p.id) && p.get('calendar') !== undefined) {
      await p.ref.update({ calendar: FieldValue.delete() })
      console.log(`${p.id.slice(0, 6)}…: calendar removed`)
    }
  }
  console.log(`done: ${feeds.size} feed(s)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
