# shmartafon-calendar-sync

Background job for [שמרטפון](https://shmartafon-hemmo.web.app). Every 15 minutes it reads each parent's private iCal calendar addresses from Firestore, works out when they're busy, and writes only those **busy times** (no titles or details) back to the app.

- `busy.mjs`: iCal → busy blocks per Israeli date. It expands recurring events, skips events marked "free" or cancelled, and splits events that cross midnight.
- `sync.mjs`: reads `calendarFeeds/*` and writes `people/{uid}.calendar`.
- Credentials are kept in the `FIREBASE_SERVICE_ACCOUNT` repository secret. Nothing secret is in the code.

```bash
npm test                                   # parser tests
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run sync   # against the local emulator
```
