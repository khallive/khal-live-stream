const DEFAULT_CHANNEL = 'khal';
const socket = io();
const video = document.getElementById('video');
const streamPlaceholder = document.getElementById('placeholder');
const livePill = document.getElementById('live-pill');
const viewerCountEl = document.getElementById('viewer-count');
const channelNameEl = document.getElementById('channel-name');
const chatBox = document.getElementById('chat-box');
const chatForm = document.getElementById('chat-form');
const usernameInput = document.getElementById('username');
const messageInput = document.getElementById('message');
const siteNameEl = document.getElementById('site-name');
const rtmpUrlEl = document.getElementById('rtmp-url');
const streamKeyEl = document.getElementById('stream-key');
const hlsUrlEl = document.getElementById('hls-url');
const statusCopyEl = document.getElementById('status-copy');
const giftsContainer = document.getElementById('gifts-container');

let hls = null;
let FIREBASE_AVAILABLE = false;
let db = null;

function appendChatMessage({ username, message, isSystem = false }) {
  const messageEl = document.createElement('div');
  messageEl.className = `chat-message ${isSystem ? 'system' : ''}`;

  if (!isSystem) {
    const label = document.createElement('strong');
    label.textContent = username;
    messageEl.appendChild(label);
  }

  const text = document.createElement('span');
  text.textContent = message;
  messageEl.appendChild(text);
  chatBox.appendChild(messageEl);
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function loadFirebase() {
  if (!window.__FIREBASE_CONFIG__) return;

  try {
    const app = firebase.initializeApp(window.__FIREBASE_CONFIG__);
    db = firebase.firestore();
    FIREBASE_AVAILABLE = true;
    console.log('Firebase loaded in browser');
  } catch (e) {
    console.error('Failed to init firebase in browser', e);
  }
}

async function loadGifts() {
  try {
    const res = await fetch('/api/gifts');
    const gifts = await res.json();
    giftsContainer.innerHTML = '';

    gifts.forEach(gift => {
      const btn = document.createElement('button');
      btn.className = 'gift-button';
      btn.innerHTML = `${gift.name} — $${(gift.priceCents/100).toFixed(2)}`;
      btn.addEventListener('click', () => sendGift(gift.id));
      giftsContainer.appendChild(btn);
    });
  } catch (e) {
    console.error('Failed to load gifts', e);
  }
}

async function sendGift(giftId) {
  const username = (usernameInput.value || 'Guest').trim() || 'Guest';
  try {
    const res = await fetch('/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ giftId, channel: DEFAULT_CHANNEL, username, successUrl: window.location.href, cancelUrl: window.location.href })
    });
    const data = await res.json();
    if (data.url) {
      window.location = data.url;
    } else {
      alert('Failed to create checkout session');
    }
  } catch (e) {
    console.error('sendGift error', e);
    alert('Payment failed to start');
  }
}

function setLiveState(streamState) {
  const isLive = !!streamState.isLive;
  channelNameEl.textContent = streamState.channel || DEFAULT_CHANNEL;
  viewerCountEl.textContent = Number(streamState.viewers || 0);
  livePill.textContent = isLive ? 'Live' : 'Offline';
  livePill.style.background = isLive ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)';
  livePill.style.borderColor = isLive ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.2)';
  livePill.style.color = isLive ? '#bbf7d0' : '#fecaca';

  if (isLive) {
    streamPlaceholder.classList.add('hidden');
    statusCopyEl.textContent = streamState.title || 'The stream is live now.';
    const streamUrl = streamState.hlsUrl || `http://localhost:8080/hls/${streamState.channel || DEFAULT_CHANNEL}.m3u8`;

    if (Hls.isSupported()) {
      if (!hls) {
        hls = new Hls({ liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 5 });
        hls.attachMedia(video);
      }

      hls.loadSource(streamUrl);
      video.muted = false;
      video.play().catch(() => {});
    } else {
      video.src = streamUrl;
      video.muted = false;
      video.play().catch(() => {});
    }
  } else {
    streamPlaceholder.classList.remove('hidden');
    statusCopyEl.textContent = 'Start your OBS stream using the RTMP key above to go live.';
    if (hls) {
      hls.destroy();
      hls = null;
    }
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}

async function subscribeFirestoreMessages(channel) {
  if (!FIREBASE_AVAILABLE || !db) return;

  try {
    db.collection('channels').doc(channel).collection('messages')
      .orderBy('createdAt', 'asc')
      .limitToLast(200)
      .onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            const doc = change.doc.data();
            appendChatMessage({ username: doc.username || 'Guest', message: doc.text || '', isSystem: !!doc.system });
          }
        });
      });
  } catch (e) {
    console.error('subscribeFirestoreMessages failed', e);
  }
}

async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();

    if (config.appName) {
      siteNameEl.textContent = config.appName;
      document.title = config.appName;
    }

    if (config.streamChannel) {
      DEFAULT_CHANNEL = config.streamChannel;
    }

    rtmpUrlEl.textContent = config.rtmpUrl || 'rtmp://localhost:1935/live';
    streamKeyEl.textContent = config.streamKey || 'khal';
    hlsUrlEl.textContent = config.hlsUrl || 'http://localhost:8080/hls/khal.m3u8';
    channelNameEl.textContent = config.channel || DEFAULT_CHANNEL;

    socket.emit('join-channel', config.streamChannel || DEFAULT_CHANNEL);

    // If firebase config is present, init and subscribe to messages
    await loadFirebase();
    if (FIREBASE_AVAILABLE) {
      subscribeFirestoreMessages(config.streamChannel || DEFAULT_CHANNEL);
    }

    await loadGifts();
  } catch (error) {
    console.error('Failed to load stream config', error);
  }
}

socket.on('connect', () => {
  appendChatMessage({
    username: 'System',
    message: 'Connected to the stream server.',
    isSystem: true
  });
});

socket.on('stream-state', (streamState) => {
  setLiveState(streamState);
});

socket.on('chat-message', ({ username, message }) => {
  appendChatMessage({ username, message, isSystem: false });
});

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const username = (usernameInput.value || 'Guest').trim() || 'Guest';
  const message = messageInput.value.trim();

  if (!message) {
    return;
  }

  // Persist via Firestore if available, otherwise emit via socket
  if (FIREBASE_AVAILABLE && db) {
    db.collection('channels').doc(DEFAULT_CHANNEL).collection('messages').add({
      userId: null,
      username,
      text: message,
      system: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(e => console.error('firestore message write failed', e));
  } else {
    socket.emit('chat-message', {
      channel: DEFAULT_CHANNEL,
      username,
      message
    });
  }

  messageInput.value = '';
});

loadConfig();
