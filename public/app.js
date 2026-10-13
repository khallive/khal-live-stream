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

let hls = null;

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
    const streamUrl = `http://localhost:8080/hls/${streamState.channel || DEFAULT_CHANNEL}.m3u8`;

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
    if (hls) {
      hls.destroy();
      hls = null;
    }
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}

socket.on('connect', () => {
  socket.emit('join-channel', DEFAULT_CHANNEL);
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

  socket.emit('chat-message', {
    channel: DEFAULT_CHANNEL,
    username,
    message
  });

  messageInput.value = '';
});

socket.emit('join-channel', DEFAULT_CHANNEL);
