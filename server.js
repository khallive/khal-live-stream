require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = Number(process.env.PORT || 3000);
const appName = process.env.APP_NAME || 'khal live stream';
const streamChannel = process.env.STREAM_CHANNEL || 'khal';
const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3000';
const rtmpUrl = process.env.RTMP_URL || 'rtmp://localhost:1935/live';
const hlsUrl = process.env.HLS_URL || 'http://localhost:8080/hls/khal.m3u8';

const channels = {
  [streamChannel]: {
    channel: streamChannel,
    name: appName,
    title: `${appName} is live`,
    isLive: false,
    viewers: 0,
    status: 'Offline',
    streamKey: streamChannel,
    startedAt: null,
    streamUrl: rtmpUrl,
    hlsUrl: hlsUrl
  }
};

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'khal-live-stream',
    appName,
    channel: streamChannel,
    publicUrl,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/config', (req, res) => {
  const channel = channels[streamChannel];
  res.json({
    appName,
    channel: channel.channel,
    streamKey: channel.streamKey,
    publicUrl,
    rtmpUrl,
    hlsUrl,
    streamChannel,
    status: channel.status,
    isLive: channel.isLive,
    title: channel.title,
    viewers: channel.viewers
  });
});

app.get('/api/channel/:slug', (req, res) => {
  const { slug } = req.params;
  const channel = channels[slug] || channels[streamChannel];
  res.json({
    ...channel,
    streamUrl: rtmpUrl,
    hlsUrl
  });
});

app.get('/api/channels', (req, res) => {
  res.json(Object.values(channels));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
  socket.on('join-channel', (channelName) => {
    const channel = channelName || streamChannel;
    socket.join(channel);

    if (!channels[channel]) {
      channels[channel] = {
        channel,
        name: `${channel} Live Stream`,
        title: `${channel} is live`,
        isLive: false,
        viewers: 0,
        status: 'Offline',
        streamKey: channel,
        startedAt: null,
        streamUrl: rtmpUrl,
        hlsUrl: hlsUrl.replace(/khal/, channel)
      };
    }

    socket.emit('stream-state', channels[channel]);
  });

  socket.on('stream-status', ({ channel, isLive, title, viewers }) => {
    const safeChannel = channel || streamChannel;

    if (!channels[safeChannel]) {
      channels[safeChannel] = {
        channel: safeChannel,
        name: `${safeChannel} Live Stream`,
        title: `${safeChannel} is live`,
        isLive: false,
        viewers: 0,
        status: 'Offline',
        streamKey: safeChannel,
        startedAt: null,
        streamUrl: rtmpUrl,
        hlsUrl: hlsUrl.replace(/khal/, safeChannel)
      };
    }

    channels[safeChannel].isLive = !!isLive;
    channels[safeChannel].title = title || channels[safeChannel].title;
    channels[safeChannel].viewers = Number(viewers) || channels[safeChannel].viewers;
    channels[safeChannel].status = channels[safeChannel].isLive ? 'Live' : 'Offline';
    channels[safeChannel].startedAt = channels[safeChannel].isLive ? new Date().toISOString() : null;

    io.to(safeChannel).emit('stream-state', channels[safeChannel]);
  });

  socket.on('chat-message', ({ channel, username, message }) => {
    const safeChannel = channel || streamChannel;
    const safeName = String(username || 'Guest').slice(0, 18);
    const safeMessage = String(message || '').slice(0, 300);

    if (!safeMessage.trim()) {
      return;
    }

    io.to(safeChannel).emit('chat-message', {
      username: safeName,
      message: safeMessage,
      time: new Date().toISOString()
    });
  });

  socket.on('viewer-count', ({ channel, viewers }) => {
    const safeChannel = channel || streamChannel;

    if (!channels[safeChannel]) {
      return;
    }

    channels[safeChannel].viewers = Number(viewers) || 0;
    io.to(safeChannel).emit('stream-state', channels[safeChannel]);
  });
});

server.listen(PORT, () => {
  console.log(`${appName} is running on ${publicUrl}`);
  console.log(`Stream key: ${streamChannel}`);
  console.log(`RTMP target: ${rtmpUrl}`);
  console.log(`HLS viewer: ${hlsUrl}`);
});
