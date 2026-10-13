# khal live stream

A public-ready MVP for a Twitch-style live stream channel called `khal`.

## What this includes

- Public-facing landing page and live stream viewer
- Live chat via Socket.IO
- RTMP ingest and HLS playback via nginx-rtmp
- Environment-based configuration for public deployment
- Docker Compose setup for streaming services
- Production-friendly deployment notes for VPS / cloud hosting

## Recommended stack

- Frontend: Express + static HTML/CSS/JS
- Realtime: Socket.IO
- Streaming: nginx-rtmp + HLS
- Deployment: Docker + reverse proxy (Nginx/Traefik)

## Environment setup

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Then update values:

```env
APP_NAME="khal live stream"
STREAM_CHANNEL="khal"
PUBLIC_URL="https://your-domain.com"
RTMP_URL="rtmp://your-domain.com:1935/live"
HLS_URL="https://your-domain.com/hls/khal.m3u8"
PORT=3000
```

## Start locally

```bash
npm install
docker compose up -d
npm start
```

Then open:

```text
http://localhost:3000
```

OBS settings:

- RTMP URL: `rtmp://localhost:1935/live`
- Stream key: `khal`

Viewer URL:

```text
http://localhost:8080/hls/khal.m3u8
```

## Public deployment

For public access, deploy this repo to a VPS or cloud server and use the public hostname instead of `localhost`.

Typical setup:

1. Run the app container on the server
2. Expose port `3000` for the web UI
3. Expose port `1935` for RTMP ingest
4. Expose port `8080` for HLS viewing or proxy it behind HTTPS
5. Put the app behind a reverse proxy (Nginx / Caddy / Traefik)
6. Set HTTPS and a custom domain for `PUBLIC_URL`

Example reverse proxy location:

```nginx
server {
  listen 80;
  server_name your-domain.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location /hls {
    proxy_pass http://127.0.0.1:8080;
    add_header Access-Control-Allow-Origin *;
  }
}
```

## Notes

This is a public-ready MVP, not a full Twitch replacement. It is designed for simple streaming, chat, and browser viewing. To support user accounts, subscriptions, moderation, monetization, or scalable video delivery, add a database, auth system, and CDN-based delivery next.
