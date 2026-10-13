# khal live stream

A public-ready Twitch-style live stream app for a single channel called `khal`.

## Features

- Public web UI with a live viewer page
- Live chat using Socket.IO
- RTMP ingest for OBS
- HLS playback for browser viewers
- Production docker setup
- Deployment guide for public hosting

## Quick local start

```bash
npm install
docker compose up -d
npm start
```

Open:

```text
http://localhost:3000
```

OBS settings:

```text
RTMP URL: rtmp://localhost:1935/live
Stream key: khal
```

HLS viewer:

```text
http://localhost:8080/hls/khal.m3u8
```

## Production deployment

### 1) VPS / server setup

Use any Ubuntu or Debian VPS with Docker installed.

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin git nginx certbot python3-certbot-nginx
sudo systemctl enable --now docker
```

### 2) Clone the repo

```bash
git clone https://github.com/khallive/khal-live-stream.git
cd khal-live-stream
cp .env.example .env
```

### 3) Set public environment values

Update `.env`:

```env
APP_NAME="khal live stream"
STREAM_CHANNEL="khal"
PUBLIC_URL="https://stream.yourdomain.com"
RTMP_URL="rtmp://stream.yourdomain.com:1935/live"
HLS_URL="https://stream.yourdomain.com/hls/khal.m3u8"
PORT=3000
```

### 4) Start the app in production mode

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

### 5) Configure a public reverse proxy

Create a site config for Nginx:

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
}
```

### 6) Get SSL certificate

```bash
sudo certbot --nginx -d stream.yourdomain.com
```

### 7) OBS public stream settings

Use the public domain in OBS:

```text
RTMP URL: rtmp://stream.yourdomain.com:1935/live
Stream key: khal
```

Public viewer URL:

```text
https://stream.yourdomain.com
```

## Notes

This project is a public deployment-ready MVP for one stream channel. It is suitable for local or server-hosted use but is not a full Twitch clone. It does not yet include multi-user auth, premium subscriptions, moderation dashboards, or enterprise-scale CDN delivery.
