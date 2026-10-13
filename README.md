# khal live stream

A lightweight Twitch-style live streaming MVP for a single channel named `khal`.

Features:
- Stream page with live status and chat
- OBS/RTMP ingest endpoint for local live streaming
- HLS viewer output for browser playback
- Simple Socket.IO chat for live viewers
- Mobile-friendly interface

## Quick start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the RTMP + HLS server:
   ```bash
   docker compose up -d
   ```

3. Start the app:
   ```bash
   npm start
   ```

4. Open the app in a browser:
   ```text
   http://localhost:3000
   ```

5. In OBS, configure:
   - Stream type: `RTMP`
   - URL: `rtmp://localhost:1935/live`
   - Stream key: `khal`

6. Watch the stream in-browser at:
   ```text
   http://localhost:8080/hls/khal.m3u8
   ```

## Default channel

The default stream channel is `khal`.

## App architecture

- Frontend: static HTML/CSS/JS served by Express
- Backend: Node.js + Express + Socket.IO
- Stream ingest: nginx-RTMP
- Viewer playback: HLS via nginx

## Notes

This is meant to be a local MVP for development and demo use. If you want to expose it publicly, run it on a VPS or cloud server and update the OBS target and browser URLs to use the public IP / domain.
