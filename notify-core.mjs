// Builds the daily pickup notification. Pure: no I/O, so it's unit-tested.
import { hhmm, reminderMessage, whatsappLink } from './domain.mjs'

/**
 * @param plan    result of pickupPlan() for today
 * @param sitter  the booked sitter's document (only for plan.kind === 'sitter')
 * @returns web-push payload shown by the app's service worker
 */
export function buildNotification(plan, sitter) {
  const at = hhmm(plan.end)
  const title = `🚸 איסוף היום ב-${at}`
  const tag = `pickup-${plan.date}`
  switch (plan.kind) {
    case 'sitter': {
      const b = plan.booking
      const first = b.sitterName.trim().split(/\s+/)[0]
      const female = sitter?.gender !== 'm'
      const payload = {
        title,
        body: `${first} ${female ? 'אוספת' : 'אוסף'} היום. לשלוח ${female ? 'לה' : 'לו'} תזכורת בוואטסאפ?`,
        tag,
        url: `/?remind=${encodeURIComponent(b.id)}&date=${plan.date}`,
        requireInteraction: true,
      }
      if (sitter?.phone) {
        payload.whatsapp = whatsappLink(sitter.phone, reminderMessage(sitter.name ?? b.sitterName, sitter.gender ?? 'f', b))
        payload.actions = [{ action: 'remind', title: '📲 שליחת תזכורת' }]
      }
      return payload
    }
    case 'parent':
      return { title, body: `${plan.booking.sitterName} אוסף/ת היום.`, tag, url: '/' }
    case 'free': {
      const names = plan.freeParents.map((p) => p.name)
      const body = names.length === 1 ? `לפי הלו״ז ${names[0]} פנוי/ה לאסוף.` : `${names.join(' ו')} פנויים לפי הלו״ז — מי אוסף?`
      return { title, body, tag, url: '/' }
    }
    default:
      return { title: `⚠️ אין מי שיאסוף היום ב-${at}!`, body: 'אף הורה לא פנוי ואין שמרטף משובץ. לחצו כדי למצוא מישהו.', tag, url: '/', requireInteraction: true }
  }
}
