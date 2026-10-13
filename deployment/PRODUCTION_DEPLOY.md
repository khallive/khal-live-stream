# Firebase + Production Deployment Checklist

This guide covers the Firebase setup and the public production deployment for the khal live stream app.

## 1) Firebase setup

### Enable Firestore
1. Go to Firebase Console.
2. Open your project: khallive.
3. Enable Firestore Database.
4. Use your Firestore rules file (`firestore.rules`).

### Enable Authentication
1. Open Firebase Console → Authentication → Sign-in method.
2. Enable Email/Password and/or Google sign-in if desired.

### Upload Firestore rules
From the Firebase CLI:

```bash
firebase login
firebase init firestore
firebase deploy --only firestore
```

Or if you already have a firebase.json file in the repo:

```bash
firebase deploy --only firestore
```

## 2) Firebase web config

Your web app config is already added to:

- `public/firebase-config.js`

It contains:

```js
window.__FIREBASE_CONFIG__ = {
  apiKey: "AIzaSyCaGIQ599g8q2feOoC_ibXUNoj83_9qmXg",
  authDomain: "khallive.firebaseapp.com",
  projectId: "khallive",
  storageBucket: "khallive.firebasestorage.app",
  messagingSenderId: "995193116449",
  appId: "1:995193116449:web:0abc41c961cd4d05679060",
  measurementId: "G-VHFEBS40EP"
};
```

## 3) Firebase Admin for the server

The server uses Firebase Admin to write to Firestore and persist transactions / system chat messages.

Example environment variables:

```env
GOOGLE_APPLICATION_CREDENTIALS=/opt/khal-live-stream/service-account.json
FIREBASE_STORAGE_BUCKET=khallive.firebasestorage.app
```

Download a service account JSON from Firebase Console:

- Firebase Console → Project settings → Service accounts → Generate new private key

This file must stay on the server and should not be committed to git.

## 4) Production deployment to a VPS

### Linux / Ubuntu VPS

```bash
sudo apt update
sudo apt install -y docker.io git curl nginx certbot python3-certbot-nginx
sudo apt install -y docker-compose-plugin
sudo systemctl enable --now docker
sudo systemctl enable --now nginx
```

### Clone repo

```bash
cd /opt
git clone https://github.com/khallive/khal-live-stream.git
cd khal-live-stream
cp .env.example .env
```

### Example `.env`

```env
APP_NAME="khal live stream"
STREAM_CHANNEL="khal"
PUBLIC_URL="https://stream.yourdomain.com"
RTMP_URL="rtmp://stream.yourdomain.com:1935/live"
HLS_URL="https://stream.yourdomain.com/hls/khal.m3u8"
PORT=3000
STRIPE_SECRET=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
GOOGLE_APPLICATION_CREDENTIALS=/opt/khal-live-stream/service-account.json
FIREBASE_STORAGE_BUCKET=khallive.firebasestorage.app
```

### Start app

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

### Nginx HTTPS reverse proxy

```nginx
server {
    listen 80;
    server_name stream.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name stream.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/stream.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/stream.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    location /hls {
        proxy_pass http://127.0.0.1:8080;
        add_header Access-Control-Allow-Origin *;
    }

    location = /ads.txt {
        alias /opt/khal-live-stream/ads.txt;
    }
}
```

### Get certificate

```bash
sudo certbot --nginx -d stream.yourdomain.com
```

## 5) Stripe gift flow

- Set `STRIPE_SECRET` to your Stripe secret key.
- Add Stripe webhook endpoint: `https://stream.yourdomain.com/webhook`
- Subscribe to `checkout.session.completed`.
- Add the webhook signing secret to `STRIPE_WEBHOOK_SECRET`.

## 6) AdSense / ads.txt

Your repo already contains an `ads.txt` file and a consent banner. For public ads to work, ensure:

- the domain is verified in AdSense
- HTTPS is active on that domain
- ads.txt is served at `https://stream.yourdomain.com/ads.txt`

## 7) Notes

- Firestore is required for saved chat and gift records.
- Firebase Admin credentials are required for the server-side Firestore write path.
- This is a production-ready starting point, not a full Twitch clone.
- For advanced scale, add CDN, user auth, moderation, and VOD storage.

## 8) Quick test checklist

- app loads at `https://stream.yourdomain.com`
- `https://stream.yourdomain.com/hls/khal.m3u8` works
- OBS can publish to `rtmp://stream.yourdomain.com:1935/live` with key `khal`
- chat messages show up
- gift checkout opens Stripe
- webhook writes transaction to Firestore
- ads banner shows after consent
