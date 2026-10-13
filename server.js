require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const STRIPE_SECRET = process.env.STRIPE_SECRET || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripe = STRIPE_SECRET ? require('stripe')(STRIPE_SECRET) : null;

const admin = (() => {
  try {
    const admin = require('firebase-admin');
    let initialized = false;

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      const saJson = JSON.parse(fs.readFileSync(saPath, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(saJson),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined
      });
      initialized = true;
      console.log('Firebase Admin initialized using service account.');
    } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      // Support for passing service account pieces as env vars (PRIVATE_KEY may have escaped newlines)
      const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey
        }),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined
      });
      initialized = true;
      console.log('Firebase Admin initialized using env vars.');
    } else {
      console.log('Firebase Admin not initialized — no service account provided. Firestore persistence disabled.');
    }

    return initialized ? admin : null;
  } catch (e) {
    console.log('firebase-admin not available or failed to init:', e.message);
    return null;
  }
})();

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

let channels = {
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

// In-memory fallback for users when Firebase Admin is not initialized
const inMemoryUsers = {}; // { userId: { followerCount, monetized, monetizedAt, earningsCents } }
let inMemoryPlatformRevenue = 0;
let inMemoryWithdrawals = {}; // id -> withdrawal

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

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

// Gifts catalog
const gifts = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'gifts.json'), 'utf8'));

app.get('/api/gifts', (req, res) => {
  res.json(gifts);
});

// Create Stripe Checkout Session for a gift
app.post('/create-checkout-session', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

  const { giftId, channel = streamChannel, username = 'Guest', successUrl, cancelUrl, customerEmail } = req.body;
  const gift = gifts.find(g => g.id === giftId);
  if (!gift) return res.status(400).json({ error: 'Unknown gift' });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${gift.name} (Gift to ${channel})`,
              images: gift.image ? [gift.image] : []
            },
            unit_amount: gift.priceCents
          },
          quantity: 1
        }
      ],
      metadata: {
        giftId: gift.id,
        channel,
        username
      },
      success_url: successUrl || `${publicUrl}/?success=1`,
      cancel_url: cancelUrl || `${publicUrl}/?canceled=1`,
      customer_email: customerEmail || undefined
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper to compute earnings and splits
const OWNER_SHARE_PERCENT = Number(process.env.OWNER_SHARE_PERCENT || 40); // percent that owner/platform gets
const PLATFORM_FEE_PERCENT = OWNER_SHARE_PERCENT; // alias

function splitAmountCents(amountCents) {
  const ownerShare = Math.round((amountCents * PLATFORM_FEE_PERCENT) / 100);
  const streamerShare = amountCents - ownerShare;
  return { ownerShare, streamerShare };
}

// Stripe webhook endpoint — needs raw body for signature verification
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    console.warn('Webhook received but stripe not configured');
    return res.status(200).send('stripe not configured');
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    if (STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } else {
      // If no webhook secret provided, parse body directly — less secure (only for local/test)
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('⚠️  Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the checkout.session.completed event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const metadata = session.metadata || {};
    const giftId = metadata.giftId;
    const channel = metadata.channel || streamChannel;
    const username = metadata.username || 'Guest';

    const gift = gifts.find(g => g.id === giftId);
    const amount = session.amount_total || (gift ? gift.priceCents : 0);

    const messageText = `${username} sent a ${gift ? gift.name : 'gift'} ♥`;

    // Emit to live chat via socket.io
    io.to(channel).emit('chat-message', {
      username: 'System',
      message: messageText,
      time: new Date().toISOString()
    });

    // Persist transaction + chat message to Firestore if admin initialized
    if (admin) {
      try {
        const db = admin.firestore();

        // Idempotency: use Stripe session id as transaction doc id
        const txDoc = db.collection('transactions').doc(session.id);
        const existing = await txDoc.get();
        if (existing.exists) {
          console.log('Transaction already processed:', session.id);
          return res.json({ received: true });
        }

        const { ownerShare, streamerShare } = splitAmountCents(amount);

        // Save transaction
        await txDoc.set({
          giftId,
          giftName: gift ? gift.name : null,
          amountCents: amount,
          ownerShareCents: ownerShare,
          streamerShareCents: streamerShare,
          channel,
          username,
          stripeSessionId: session.id,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Credit streamer earnings (add streamerShare)
        const userRef = db.collection('users').doc(channel);
        await userRef.set({ earningsCents: admin.firestore.FieldValue.increment(streamerShare) }, { merge: true });

        // Credit platform/owner revenue
        const platformRef = db.collection('platform').doc('revenue');
        await platformRef.set({ totalCents: admin.firestore.FieldValue.increment(ownerShare) }, { merge: true });

        // Save a system message to channel messages collection
        const msgRef = db.collection('channels').doc(channel).collection('messages').doc();
        await msgRef.set({
          userId: null,
          username: 'System',
          text: messageText,
          system: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log('Recorded transaction and system message to Firestore');

        // Notify the user (streamer) in their user room
        io.to(`user:${channel}`).emit('gift-received', {
          channel,
          streamerShareCents: streamerShare,
          ownerShareCents: ownerShare,
          totalCents: amount,
          message: messageText
        });
      } catch (e) {
        console.error('Failed to write to Firestore:', e.message);
      }
    } else {
      // In-memory fallback
      const { ownerShare, streamerShare } = splitAmountCents(amount);

      inMemoryPlatformRevenue += ownerShare;
      inMemoryUsers[channel] = inMemoryUsers[channel] || { followerCount: 0, monetized: false, monetizedAt: null, earningsCents: 0 };
      inMemoryUsers[channel].earningsCents = (inMemoryUsers[channel].earningsCents || 0) + streamerShare;

      // Store transaction idempotently
      inMemoryWithdrawals[session.id] = {
        id: session.id,
        giftId,
        amountCents: amount,
        ownerShareCents: ownerShare,
        streamerShareCents: streamerShare,
        channel,
        username,
        createdAt: new Date().toISOString()
      };

      io.to(`user:${channel}`).emit('gift-received', {
        channel,
        streamerShareCents: streamerShare,
        ownerShareCents: ownerShare,
        totalCents: amount,
        message: messageText
      });

      console.log('Processed in-memory transaction for session', session.id);
    }
  }

  res.json({ received: true });
});

// --- Monetization / user follower endpoints ---
// Policy: when a user's followerCount reaches >= 10,000 they are auto-enabled for monetization.
// Earnings rule (simple): $1 per 1,000 followers (rounded down). Stored as cents in earningsCents.

// Helper: get user from Firestore or in-memory fallback
async function getUser(userId) {
  if (admin) {
    const db = admin.firestore();
    const doc = await db.collection('users').doc(userId).get();
    if (doc.exists) return doc.data();
    return null;
  }
  return inMemoryUsers[userId] || null;
}

async function saveUser(userId, data) {
  if (admin) {
    const db = admin.firestore();
    await db.collection('users').doc(userId).set(data, { merge: true });
    return;
  }
  inMemoryUsers[userId] = Object.assign(inMemoryUsers[userId] || {}, data);
}

function computeEarningsCents(followerCount) {
  // $1 per 1000 followers -> 100 cents per 1000 followers
  const thousands = Math.floor(followerCount / 1000);
  return thousands * 100; // cents
}

// Get user profile
app.get('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    let user = await getUser(id);
    if (!user) {
      // create a default user record
      user = {
        followerCount: 0,
        monetized: false,
        monetizedAt: null,
        earningsCents: 0
      };
      await saveUser(id, user);
    }

    res.json({ id, ...user });
  } catch (e) {
    console.error('get user failed', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Increment followers (simple endpoint for testing or webhook integration)
app.post('/api/users/:id/follow', async (req, res) => {
  const { id } = req.params;
  const { delta = 1 } = req.body;

  try {
    const existing = (await getUser(id)) || { followerCount: 0, monetized: false, monetizedAt: null, earningsCents: 0 };
    const newCount = Number(existing.followerCount || 0) + Number(delta || 1);

    const updates = { followerCount: newCount };

    // Auto-enable monetization when threshold reached
    if (!existing.monetized && newCount >= 10000) {
      updates.monetized = true;
      updates.monetizedAt = admin ? admin.firestore.FieldValue.serverTimestamp() : new Date().toISOString();
      // initial earnings allocation based on follower count
      updates.earningsCents = computeEarningsCents(newCount);

      // emit notification to the user socket room (if any)
      io.to(`user:${id}`).emit('monetization-enabled', { id, monetizedAt: updates.monetizedAt, earningsCents: updates.earningsCents });
    }

    await saveUser(id, updates);

    res.json({ id, followerCount: newCount, monetized: updates.monetized || existing.monetized, earningsCents: updates.earningsCents || existing.earningsCents || 0 });
  } catch (e) {
    console.error('follow update failed', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get earnings summary
app.get('/api/users/:id/earnings', async (req, res) => {
  const { id } = req.params;
  try {
    const user = (await getUser(id)) || { earningsCents: 0 };
    res.json({ id, earningsCents: user.earningsCents || 0, monetized: user.monetized || false });
  } catch (e) {
    console.error('earnings fetch failed', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Admin protection helper
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.admin_token;
  if (!process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'ADMIN_TOKEN not configured' });
  }
  if (token !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  return next();
}

// Minimum withdrawal threshold (cents)
const MIN_WITHDRAWAL_CENTS = Number(process.env.MIN_WITHDRAWAL_CENTS || 1000);

// Create a withdrawal request (user requests payout)
app.post('/api/users/:id/withdraw-request', async (req, res) => {
  const { id } = req.params;
  const { amountCents } = req.body; // optional, default to full balance

  try {
    const user = (await getUser(id)) || { earningsCents: 0 };
    const balance = Number(user.earningsCents || 0);
    const requestAmount = Number(amountCents || balance);

    if (requestAmount <= 0) return res.status(400).json({ error: 'invalid amount' });
    if (requestAmount > balance) return res.status(400).json({ error: 'insufficient balance' });
    if (requestAmount < MIN_WITHDRAWAL_CENTS) return res.status(400).json({ error: `minimum withdrawal is ${MIN_WITHDRAWAL_CENTS} cents` });

    // Deduct immediately (reserve funds)
    if (admin) {
      const db = admin.firestore();
      const withdrawalRef = db.collection('withdrawals').doc();
      await withdrawalRef.set({
        userId: id,
        amountCents: requestAmount,
        status: 'requested',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // decrement user's earnings
      await db.collection('users').doc(id).set({ earningsCents: admin.firestore.FieldValue.increment(-requestAmount) }, { merge: true });

      res.json({ ok: true, withdrawalId: withdrawalRef.id });
    } else {
      // in-memory
      const wid = `w_${Date.now()}`;
      inMemoryWithdrawals[wid] = { id: wid, userId: id, amountCents: requestAmount, status: 'requested', createdAt: new Date().toISOString() };
      inMemoryUsers[id] = inMemoryUsers[id] || { earningsCents: 0 };
      inMemoryUsers[id].earningsCents = (inMemoryUsers[id].earningsCents || 0) - requestAmount;
      res.json({ ok: true, withdrawalId: wid });
    }
  } catch (e) {
    console.error('withdraw request failed', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Admin: list pending withdrawals
app.get('/api/admin/withdrawals', requireAdmin, async (req, res) => {
  try {
    if (admin) {
      const db = admin.firestore();
      const q = await db.collection('withdrawals').where('status', '==', 'requested').get();
      const items = [];
      q.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
      return res.json(items);
    }

    // in-memory
    const items = Object.values(inMemoryWithdrawals).filter(w => w.status === 'requested');
    res.json(items);
  } catch (e) {
    console.error('list withdrawals failed', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Admin: mark withdrawal complete (paid)
app.post('/api/admin/withdrawals/:id/complete', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    if (admin) {
      const db = admin.firestore();
      const ref = db.collection('withdrawals').doc(id);
      await ref.set({ status: 'paid', paidAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return res.json({ ok: true });
    }

    if (inMemoryWithdrawals[id]) {
      inMemoryWithdrawals[id].status = 'paid';
      inMemoryWithdrawals[id].paidAt = new Date().toISOString();
      return res.json({ ok: true });
    }

    res.status(404).json({ error: 'withdrawal not found' });
  } catch (e) {
    console.error('complete withdrawal failed', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Admin: manually toggle monetization (protected in production — simple implementation here)
app.post('/api/users/:id/monetize', async (req, res) => {
  const { id } = req.params;
  const { enable } = req.body; // boolean

  try {
    const existing = (await getUser(id)) || { followerCount: 0, monetized: false, monetizedAt: null, earningsCents: 0 };
    const updates = {};
    if (enable) {
      if (!existing.monetized) {
        updates.monetized = true;
        updates.monetizedAt = admin ? admin.firestore.FieldValue.serverTimestamp() : new Date().toISOString();
        updates.earningsCents = computeEarningsCents(existing.followerCount || 0);
      }
    } else {
      updates.monetized = false;
    }

    await saveUser(id, updates);
    res.json({ id, monetized: updates.monetized ?? existing.monetized, earningsCents: updates.earningsCents ?? existing.earningsCents });
  } catch (e) {
    console.error('monetize toggle failed', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Fallback route to serve index.html
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

  // allow sockets to subscribe to a user's personal room for monetization notices
  socket.on('subscribe-user', (userId) => {
    if (!userId) return;
    socket.join(`user:${userId}`);
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

    // Emit to sockets
    io.to(safeChannel).emit('chat-message', {
      username: safeName,
      message: safeMessage,
      time: new Date().toISOString()
    });

    // Persist to Firestore if available
    if (admin) {
      const db = admin.firestore();
      db.collection('channels').doc(safeChannel).collection('messages').add({
        userId: null,
        username: safeName,
        text: safeMessage,
        system: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }).catch(e => console.error('failed to persist message', e.message));
    }
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
