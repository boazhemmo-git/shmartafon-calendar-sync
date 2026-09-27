// Daily pickup notification: 30 minutes before the gan closes, tell the parents who picks up.
// Runs every 15 minutes with the calendar sync; sends at most once per day (notifyLog/{date}).
// TEST_PUSH=1 sends a test notification to every parent device right away.
import webpush from 'web-push'
import { adminDb } from './admin.mjs'
import { nowMinutesIL, pickupPlan, todayIL, weekStart, DEFAULT_SETTINGS } from './domain.mjs'
import { buildNotification, buildParentReminder } from './notify-core.mjs'

const db = adminDb()

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
    const n = await send(subs, { title: '🔔 בדיקת התראות', body: 'ההתראות של שמרטפון עובדות ✓', tag: 'test', url: '/' })
    return console.log(`test push: ${n}/${subs.length} device(s)`)
  }

  // NOTIFY_DATE / NOTIFY_NOW (minutes) simulate another moment — for local testing only.
  const today = process.env.NOTIFY_DATE || todayIL()
  const now = process.env.NOTIFY_NOW ? Number(process.env.NOTIFY_NOW) : nowMinutesIL()
  const settingsSnap = await db.doc('settings/app').get()
  const settings = settingsSnap.exists ? { ...DEFAULT_SETTINGS, ...settingsSnap.data() } : DEFAULT_SETTINGS
  const weekSnap = await db.doc(`weeks/${weekStart(today)}`).get()
  const week = weekSnap.exists ? { id: weekSnap.id, ...weekSnap.data() } : undefined
  const plan = pickupPlan(today, settings, week, parents)
  if (!plan) return console.log('pickup: no gan today')
  if (now < plan.notifyAt || now >= plan.end) return console.log(`pickup: not in the notify window (${plan.notifyAt}–${plan.end}, now ${now})`)

  // 1) 30 min before: every parent hears who picks up. create() fails if the log doc exists,
  //    so overlapping runs can't send twice.
  if (await once(`notifyLog/${today}`, plan.kind)) {
    const sitter = plan.kind === 'sitter' ? (await db.doc(`sitters/${plan.booking.sitterId}`).get()).data() : undefined
    const n = await send(subs, buildNotification(plan, sitter))
    console.log(`pickup (${plan.kind}): sent to ${n}/${subs.length} device(s)`)
  } else console.log('pickup: overview already sent today')

  // 2) 15 min before: the parent(s) picking up get a personal reminder, like a sitter would.
  if (now >= plan.remindAt && plan.pickupUids.length && (await once(`notifyLog/${today}-remind`, plan.kind))) {
    for (const uid of plan.pickupUids) {
      const parent = parents.find((p) => p.uid === uid)
      if (!parent) continue
      const mine = subs.filter((s) => s.get('uid') === uid)
      const n = await send(mine, buildParentReminder(plan, parent, parents))
      console.log(`reminder to ${uid.slice(0, 6)}…: ${n}/${mine.length} device(s)`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
