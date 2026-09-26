import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildNotification } from './notify-core.mjs'

const plan = (kind, extra = {}) => ({ date: '2026-10-04', end: 960, notifyAt: 930, kind, freeParents: [], ...extra })
const booking = { id: 'b1', sitterId: 's1', sitterName: 'נועה כהן', date: '2026-10-04', start: 960, end: 1080 }

test('sitter pickup asks to send a WhatsApp reminder', () => {
  const n = buildNotification(plan('sitter', { booking }), { name: 'נועה כהן', phone: '052-3333333', gender: 'f' })
  assert.equal(n.title, '🚸 איסוף היום ב-16:00')
  assert.equal(n.body, 'נועה אוספת היום. לשלוח לה תזכורת בוואטסאפ?')
  assert.equal(n.url, '/?remind=b1&date=2026-10-04')
  assert.equal(n.actions[0].action, 'remind')
  assert.equal(decodeURIComponent(n.whatsapp.split('text=')[1]), 'היי נועה, תזכורת: היום את אוספת את הילדים מהגן ב-15:45. תודה! 🙂')
  assert.ok(n.whatsapp.startsWith('https://wa.me/972523333333?'))
})

test('male sitter, and no phone → no action button', () => {
  const n = buildNotification(plan('sitter', { booking: { ...booking, sitterName: 'סבא משה' } }), { name: 'סבא משה', gender: 'm' })
  assert.equal(n.body, 'סבא אוסף היום. לשלוח לו תזכורת בוואטסאפ?')
  assert.equal(n.actions, undefined)
})

test('parents and nobody', () => {
  assert.equal(buildNotification(plan('parent', { booking: { ...booking, sitterName: 'בועז' } })).body, 'בועז אוסף/ת היום.')
  assert.equal(buildNotification(plan('free', { freeParents: [{ name: 'דנה' }] })).body, 'לפי הלו״ז דנה פנוי/ה לאסוף.')
  assert.equal(buildNotification(plan('free', { freeParents: [{ name: 'בועז' }, { name: 'דנה' }] })).body, 'בועז ודנה פנויים לפי הלו״ז — מי אוסף?')
  assert.equal(buildNotification(plan('none')).title, '⚠️ אין מי שיאסוף היום ב-16:00!')
})
