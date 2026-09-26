// Shared Firebase Admin setup: real project in CI (service-account secret), emulator locally.
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

export function adminDb() {
  if (!getApps().length) {
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-shmartafon' })
    } else {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT
      if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set')
      const sa = JSON.parse(raw)
      initializeApp({ credential: cert(sa), projectId: sa.project_id })
    }
  }
  return getFirestore()
}
