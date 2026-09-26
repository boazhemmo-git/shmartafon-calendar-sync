# shmartafon-calendar-sync

Background job for [שמרטפון](https://shmartafon-hemmo.web.app). Every 15 minutes it reads each parent's private iCal calendar addresses from Firestore, works out when they're busy, and writes only those **busy times** (no titles or details) back to the app.

- `busy.mjs`: iCal → busy blocks per Israeli date. It expands recurring events, skips events marked "free" or cancelled, and splits events that cross midnight.
- `sync.mjs`: reads `calendarFeeds/*` and writes `people/{uid}.calendar`.
- `notify.mjs` / `notify-core.mjs`: the daily pickup push notification, sent 30 minutes before the gan closes (at most once a day, `notifyLog/{date}`). Run the workflow manually with **test_push** checked to send a test notification to every parent device.
- `domain.mjs` is **generated** from the app (`npm run bundle:server` in `shmartafon`). It holds the same gan-hours, holiday and pickup rules the app uses. Don't edit it here.
- Credentials are kept in the `FIREBASE_SERVICE_ACCOUNT` repository secret. Nothing secret is in the code.

```bash
npm test                                   # parser tests
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run sync   # against the local emulator
```
