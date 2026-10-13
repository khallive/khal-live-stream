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

const PORT = process.env.PORT || 3000;

const channels = {
  khal: {
    channel: 'khal',
    name: 'Khal Live Stream',
    title: 'Live from Khal',
    isLive: false,
    viewers: 0,
    status: 'Offline',
    streamKey: 'khal',
    startedAt: null
  }
};

app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'khal-live-stream', timestamp: new Date().toISOString() });
});

app.get('/api/channel/:slug', (req, res) => {
  const { slug } = req.params;
  const channel = channels[slug] || channels.khal;
  res.json({
    ...channel,
    streamUrl: `rtmp://localhost:1935/live/${slug}`
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
    const channel = channelName || 'khal';
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
        startedAt: null
      };
    }

    socket.emit('stream-state', channels[channel]);
  });

  socket.on('stream-status', ({ channel, isLive, title, viewers }) => {
    const safeChannel = channel || 'khal';

    if (!channels[safeChannel]) {
      channels[safeChannel] = {
        channel: safeChannel,
        name: `${safeChannel} Live Stream`,
        title: `${safeChannel} is live`,
        isLive: false,
        viewers: 0,
        status: 'Offline',
        streamKey: safeChannel,
        startedAt: null
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
    const safeChannel = channel || 'khal';
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
    const safeChannel = channel || 'khal';

    if (!channels[safeChannel]) {
      return;
    }

    channels[safeChannel].viewers = Number(viewers) || 0;
    io.to(safeChannel).emit('stream-state', channels[safeChannel]);
  });
});

server.listen(PORT, () => {
  console.log(`khal live stream is running on http://localhost:${PORT}`);
});
