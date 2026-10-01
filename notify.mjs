// Daily pickup notification: 30 minutes before the gan closes, tell the parents who picks up.
// Runs every 15 minutes with the calendar sync; sends at most once per day (notifyLog/{date}).
// TEST_PUSH=1 sends a test notification to every parent device right away.
import webpush from 'web-push'
import { adminDb } from './admin.mjs'
import { israelMidnightMs, pickupPlan, todayIL, weekStart, DEFAULT_SETTINGS } from './domain.mjs'
import { buildNotification, buildParentReminder } from './notify-core.mjs'

const db = adminDb()
/** A run this close before a send time waits and sends exactly on time (runs come every 15 min). */
const LOOKAHEAD_MS = 16 * 60_000

/** VAPID keys are created once and kept in Firestore: the private half in an admin-only doc. */
async function vapid() {
  const ref = db.doc('system/vapid')
  const snap = await ref.get()
  if (snap.exists) return snap.data()
  const keys = webpush.generateVAPIDKeys()
  await ref.set(keys)
  await db.doc('config/push').set({ vapidPublicKey: keys.publicKey })
  console.log('created VAPID keys')
  return keys
}

async function parentsAndSubs() {
  const access = (await db.doc('config/access').get()).data() ?? { parents: [] }
  const people = (await db.collection('people').get()).docs.map((d) => ({ uid: d.id, ...d.data() }))
  const parents = people.filter((p) => access.parents.includes((p.email ?? '').toLowerCase()))
  const uids = new Set(parents.map((p) => p.uid))
  const subs = (await db.collection('pushSubs').get()).docs.filter((d) => uids.has(d.get('uid')))
  return { parents, subs }
}

async function send(subs, payload) {
  let ok = 0
  for (const s of subs) {
    const { endpoint, keys } = s.data()
    try {
      await webpush.sendNotification({ endpoint, keys }, JSON.stringify(payload), { TTL: 1800, urgency: 'high' })
      ok++
    } catch (e) {
      // 404/410: the device unsubscribed or the app was removed — forget it.
      if (e.statusCode === 404 || e.statusCode === 410) await s.ref.delete()
      console.log(`  push failed (${e.statusCode ?? e.message})`)
    }
  }
  return ok
}

/** True the first time it's called for `path` (atomic create), false afterwards. */
async function once(path, kind) {
  try {
    await db.doc(path).create({ kind, at: Date.now() })
    return true
  } catch {
    return false
  }
}

async function main() {
  const keys = await vapid()
  webpush.setVapidDetails('https://shmartafon-hemmo.web.app', keys.publicKey, keys.privateKey)
  const { parents, subs } = await parentsAndSubs()

  if (process.env.TEST_PUSH === '1') {
    // TEST_PLATFORM=android|iphone limits the test to that kind of device (matched on the saved user agent).
    const platform = process.env.TEST_PLATFORM || 'all'
    const match = { android: /Android/i, iphone: /iPhone|iPad|iPod|Macintosh/i }[platform]
    const targets = match ? subs.filter((s) => match.test(s.get('ua') ?? '')) : subs
    const n = await send(targets, { title: '🔔 בדיקת התראות', body: 'ההתראות של שמרטפון עובדות ✓', tag: 'test', url: '/' })
    return console.log(`test push (${platform}): ${n}/${targets.length} device(s)`)
  }

  // NOTIFY_DATE / NOTIFY_NOW (minutes) simulate another moment — for local testing only (no real waiting).
  const today = process.env.NOTIFY_DATE || todayIL()
  const simulated = !!process.env.NOTIFY_NOW
  const midnight = israelMidnightMs(today)
  const nowMs = () => (simulated ? midnight + Number(process.env.NOTIFY_NOW) * 60_000 : Date.now())

  const loadPlan = async () => {
    const settingsSnap = await db.doc('settings/app').get()
    const settings = settingsSnap.exists ? { ...DEFAULT_SETTINGS, ...settingsSnap.data() } : DEFAULT_SETTINGS
    const weekSnap = await db.doc(`weeks/${weekStart(today)}`).get()
    const week = weekSnap.exists ? { id: weekSnap.id, ...weekSnap.data() } : undefined
    return pickupPlan(today, settings, week, parents)
  }

  let plan = await loadPlan()
  if (!plan) return console.log('pickup: no gan today')

  const steps = [
    {
      // 30 min before: every parent hears who picks up.
      log: `notifyLog/${today}`,
      at: (pl) => pl.notifyAt,
      run: async (pl) => {
        const sitter = pl.kind === 'sitter' ? (await db.doc(`sitters/${pl.booking.sitterId}`).get()).data() : undefined
        const n = await send(subs, buildNotification(pl, sitter))
        console.log(`pickup (${pl.kind}): sent to ${n}/${subs.length} device(s) at ${new Date().toISOString()}`)
      },
    },
    {
      // 15 min before: the parent(s) picking up get a personal reminder, like a sitter would.
      log: `notifyLog/${today}-remind`,
      at: (pl) => pl.remindAt,
      run: async (pl) => {
        for (const uid of pl.pickupUids) {
          const parent = parents.find((p) => p.uid === uid)
          if (!parent) continue
          const mine = subs.filter((s) => s.get('uid') === uid)
          const n = await send(mine, buildParentReminder(pl, parent, parents))
          console.log(`reminder to ${uid.slice(0, 6)}…: ${n}/${mine.length} device(s) at ${new Date().toISOString()}`)
        }
      },
    },
  ]

  let waited = false
  for (const step of steps) {
    const targetMs = midnight + step.at(plan) * 60_000
    const endMs = midnight + plan.end * 60_000
    if (nowMs() >= endMs) {
      console.log('pickup: gan already closed')
      break
    }
    const wait = targetMs - nowMs()
    if (wait > LOOKAHEAD_MS) {
      console.log(`${step.log}: not yet (in ${Math.round(wait / 60_000)} min)`)
      break
    }
    if ((await db.doc(step.log).get()).exists) {
      console.log(`${step.log}: already sent`)
      continue
    }
    // Runs come every ~15 minutes and start a little late, so the run before the target
    // waits here and sends on the exact minute instead of up to 15 minutes late.
    if (wait > 0) {
      // One wait per run; the next run (15 minutes later) handles the following step.
      if (waited) break
      waited = true
      console.log(`${step.log}: waiting ${Math.round(wait / 1000)}s to send on time`)
      if (!simulated) await new Promise((r) => setTimeout(r, wait))
      plan = (await loadPlan()) ?? plan // pick up any change made while waiting
    }
    if (step === steps[1] && !plan.pickupUids.length) continue
    // create() fails if the log exists, so overlapping runs can't both send.
    if (await once(step.log, plan.kind)) await step.run(plan)
    else console.log(`${step.log}: already sent`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
