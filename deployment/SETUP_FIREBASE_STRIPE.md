### Firebase and Stripe setup

To enable saved chat and the gift payment flow you must provide:

1. Firebase Admin service account JSON for server-side writes (transactions + system messages)
   - Go to Firebase Console → Project Settings → Service accounts → Generate new private key
   - Save the JSON to your server (e.g. `/opt/khal-live-stream/service-account.json`) and set the env var:
     - `GOOGLE_APPLICATION_CREDENTIALS=/opt/khal-live-stream/service-account.json`

   Alternatively you can set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` env vars.

2. Stripe keys
   - Set `STRIPE_SECRET` to your Stripe secret key
   - Set `STRIPE_WEBHOOK_SECRET` to the webhook signing secret produced by Stripe when you register your webhook endpoint

Example .env additions:

```env
STRIPE_SECRET=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
GOOGLE_APPLICATION_CREDENTIALS=/opt/khal-live-stream/service-account.json
FIREBASE_STORAGE_BUCKET=khal-liv.firebasestorage.app
```

After setting those up, restart the service. The server will persist transactions and system messages to Firestore and will emit real-time chat events to connected viewers.
