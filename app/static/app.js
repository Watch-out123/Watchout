
const { username, token } = window.APP_BOOTSTRAP;

const STUN_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
  ]
};

const localVideo = document.getElementById('localVideo');
const remoteGrid = document.getElementById('remoteGrid');
const emptyStage = document.getElementById('emptyStage');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const roomInput = document.getElementById('roomInput');
const shareBtn = document.getElementById('shareBtn');
const stopShareBtn = document.getElementById('stopShareBtn');
const roomLabel = document.getElementById('roomLabel');
const statusLabel = document.getElementById('statusLabel');
const peopleLabel = document.getElementById('peopleLabel');
const copyInviteBtn = document.getElementById('copyInviteBtn');
const whatsappInviteBtn = document.getElementById('whatsappInviteBtn');
const inviteLinkLabel = document.getElementById('inviteLinkLabel');
const copyMessage = document.getElementById('copyMessage');
const logoutBtn = document.getElementById('logoutBtn');
const theaterBtn = document.getElementById('theaterBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const enableAudioBtn = document.getElementById('enableAudioBtn');
const eventFeed = document.getElementById('eventFeed');
const toastStack = document.getElementById('toastStack');
const heartBurst = document.getElementById('heartBurst');
const partnerNameLabel = document.getElementById('partnerNameLabel');
const roomTitleLabel = document.getElementById('roomTitleLabel');
const stageHint = document.getElementById('stageHint');
const vibeButtons = [...document.querySelectorAll('.vibe-btn')];
const actionButtons = [...document.querySelectorAll('.action-btn')];
const serviceButtons = [...document.querySelectorAll('.service-btn')];
const customUrlInput = document.getElementById('customUrlInput');
const openCustomUrlBtn = document.getElementById('openCustomUrlBtn');
const participantList = document.getElementById('participantList');
const roomTitleInput = document.getElementById('roomTitleInput');
const setTitleBtn = document.getElementById('setTitleBtn');
const lockRoomBtn = document.getElementById('lockRoomBtn');
const chatFeed = document.getElementById('chatFeed');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');

let ws = null;
let roomId = '';
let selfId = '';
let participantCount = 0;
let localStream = null;
let isHost = false;
let roomLocked = false;
const peerConnections = new Map();
const remoteStreams = new Map();
const makingOffer = new Map();
const politePeers = new Map();
const peerNames = new Map();
const remoteTiles = new Map();

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setStatus(text) {
  statusLabel.textContent = text;
}

function setRoom(text) {
  roomLabel.textContent = text;
}

function setPeople(count) {
  participantCount = count;
  peopleLabel.textContent = String(count);
}

function setButtonsConnected(connected) {
  shareBtn.disabled = !connected;
  copyInviteBtn.disabled = !connected;
  whatsappInviteBtn.disabled = !connected;
  setTitleBtn.disabled = !connected || !isHost;
  lockRoomBtn.disabled = !connected || !isHost;
}

function getInviteLink() {
  return roomId ? `${window.location.origin}/app?room=${encodeURIComponent(roomId)}` : '';
}

function updateInviteLink() {
  inviteLinkLabel.textContent = roomId ? getInviteLink() : 'Create a room to get your invite link.';
}

function updateLocalPreview() {
  localVideo.srcObject = localStream || null;
}

function getLivePeerEntries() {
  return [...remoteStreams.entries()].filter(([, stream]) => stream && stream.getTracks().length > 0);
}

function updateStageMeta() {
  const liveEntries = getLivePeerEntries();
  const liveCount = liveEntries.length;
  if (liveCount === 0) {
    partnerNameLabel.textContent = 'Waiting for screens';
    stageHint.textContent = participantCount > 1
      ? 'People are in the room. Waiting for someone to start screen share.'
      : 'Create or join the same room, invite more people, then anyone can start screen share.';
  } else if (liveCount === 1) {
    const [peerId] = liveEntries[0];
    const name = peerNames.get(peerId) || 'Someone';
    partnerNameLabel.textContent = `${name}'s screen is live`;
    stageHint.textContent = `Watching ${name}. More friends can still join with the same invite link.`;
  } else {
    partnerNameLabel.textContent = `${liveCount} screens live`;
    stageHint.textContent = `Multi-watch room active. Everyone in this room can keep the same vibe going.`;
  }
  emptyStage.classList.toggle('hidden', liveCount > 0);
}

function setTileLabel(peerId) {
  const tile = remoteTiles.get(peerId);
  if (!tile) return;
  tile.label.textContent = peerNames.get(peerId) || 'Guest';
}

function layoutRemoteGrid() {
  const count = Math.max(remoteTiles.size, 1);
  remoteGrid.dataset.count = String(count);
}

function createRemoteTile(peerId) {
  if (remoteTiles.has(peerId)) return remoteTiles.get(peerId);

  const card = document.createElement('div');
  card.className = 'remote-tile glass-card';
  card.dataset.peerId = peerId;

  const badge = document.createElement('div');
  badge.className = 'overlay-badge';
  badge.textContent = 'shared screen';

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.controls = true;
  video.muted = false;

  const footer = document.createElement('div');
  footer.className = 'remote-tile-footer';

  const name = document.createElement('strong');
  name.textContent = peerNames.get(peerId) || 'Guest';

  const hint = document.createElement('span');
  hint.textContent = 'Click once if the browser blocks audio.';

  footer.append(name, hint);
  card.append(badge, video, footer);
  remoteGrid.appendChild(card);

  video.addEventListener('click', async () => {
    video.muted = false;
    try { await video.play(); } catch {}
  });

  const tile = { card, video, label: name, hint };
  remoteTiles.set(peerId, tile);
  layoutRemoteGrid();
  return tile;
}

function removeRemoteTile(peerId) {
  const tile = remoteTiles.get(peerId);
  if (!tile) return;
  tile.video.srcObject = null;
  tile.card.remove();
  remoteTiles.delete(peerId);
  layoutRemoteGrid();
}

function renderRemoteStream(peerId) {
  const stream = remoteStreams.get(peerId);
  const tile = createRemoteTile(peerId);
  tile.video.srcObject = stream || null;
  if (stream && stream.getTracks().length > 0) {
    tile.hint.textContent = 'Audio + video coming from shared screen.';
    tile.video.play().catch(() => {
      showToast('Audio may need a click', `Tap ${peerNames.get(peerId) || 'this stream'} once if autoplay is blocked.`);
    });
  } else {
    tile.hint.textContent = 'Joined the room. Waiting for screen share.';
  }
  updateStageMeta();
}

function pushFeed(html) {
  const item = document.createElement('div');
  item.className = 'event-item';
  item.innerHTML = html;
  eventFeed.prepend(item);
}

function addChatItem(text, who = 'system', type = 'system') {
  const item = document.createElement('div');
  item.className = `chat-item ${type}`;
  item.innerHTML = type === 'system'
    ? escapeHtml(text)
    : `<strong>${escapeHtml(who)}:</strong> ${escapeHtml(text)}`;
  chatFeed.prepend(item);
}

function showToast(title, text) {
  const node = document.createElement('div');
  node.className = 'toast';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const span = document.createElement('span');
  span.textContent = text;
  node.append(strong, span);
  toastStack.appendChild(node);
  setTimeout(() => node.remove(), 3600);
}

function burstHearts(count = 1) {
  for (let i = 0; i < count; i += 1) {
    const heart = document.createElement('div');
    heart.className = 'flying-heart';
    heart.textContent = '❤';
    heart.style.left = `${38 + Math.random() * 26}%`;
    heart.style.animationDelay = `${i * 80}ms`;
    heartBurst.appendChild(heart);
    setTimeout(() => heart.remove(), 2200);
  }
}

function updateUrlWithRoom() {
  const url = new URL(window.location.href);
  if (roomId) {
    url.searchParams.set('room', roomId);
  } else {
    url.searchParams.delete('room');
  }
  window.history.replaceState({}, '', url);
}

function updateParticipantList(roomParticipants = []) {
  const me = { id: selfId, username, isHost };
  const participants = roomParticipants.length ? roomParticipants : [me];
  participantList.innerHTML = '';
  participants.forEach((person) => {
    const item = document.createElement('div');
    item.className = 'participant-item';

    const left = document.createElement('div');
    left.className = 'participant-meta';

    const dot = document.createElement('span');
    dot.className = 'participant-dot';
    left.appendChild(dot);

    const nameWrap = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = person.id === selfId ? `${person.username} (you)` : person.username;
    const badge = document.createElement('span');
    badge.textContent = person.isHost ? 'Host' : 'Guest';
    badge.className = person.isHost ? 'role-pill host' : 'role-pill';
    nameWrap.append(title, badge);

    left.appendChild(nameWrap);
    item.appendChild(left);
    participantList.appendChild(item);
  });
}

function applyRoomState(state) {
  if (!state) return;
  roomLocked = !!state.locked;
  isHost = state.hostId === selfId;
  roomTitleLabel.textContent = state.title || 'Movie night';
  roomTitleInput.value = state.title || '';
  lockRoomBtn.textContent = roomLocked ? 'Unlock room' : 'Lock room';
  setButtonsConnected(!!roomId);
  updateParticipantList(state.participants || []);
}

async function fetchNewRoom() {
  const res = await fetch('/api/room/new');
  const data = await res.json();
  return data.roomId;
}

function closeCurrentRoom() {
  for (const peerId of [...peerConnections.keys()]) cleanupPeer(peerId);
  remoteStreams.clear();
  peerNames.clear();
  setPeople(0);
  roomId = '';
  isHost = false;
  roomLocked = false;
  setRoom('Not connected');
  updateInviteLink();
  updateUrlWithRoom();
  updateParticipantList([]);
  if (ws) {
    ws.close();
    ws = null;
  }
  updateStageMeta();
  setButtonsConnected(false);
}

function cleanupPeer(peerId) {
  const pc = peerConnections.get(peerId);
  if (pc) pc.close();
  peerConnections.delete(peerId);
  remoteStreams.delete(peerId);
  makingOffer.delete(peerId);
  politePeers.delete(peerId);
  peerNames.delete(peerId);
  removeRemoteTile(peerId);
  updateStageMeta();
}

function wsSend(data) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(data));
}

function connectWebSocket(targetRoomId) {
  closeCurrentRoom();
  roomId = targetRoomId.trim().toLowerCase();
  if (!roomId) return;
  updateInviteLink();
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${window.location.host}/ws/room/${encodeURIComponent(roomId)}?token=${encodeURIComponent(token)}`);

  ws.onopen = () => {
    setRoom(roomId);
    setStatus('Connected');
    setButtonsConnected(true);
    roomInput.value = roomId;
    updateUrlWithRoom();
    updateInviteLink();
    pushFeed(`<strong>system</strong> room <em>${escapeHtml(roomId)}</em> connected.`);
    showToast('Room ready', 'Copy the link or send it on WhatsApp to invite more people.');
  };

  ws.onmessage = async (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'welcome') {
      selfId = message.selfId;
      const peers = message.peers || [];
      setPeople(peers.length + 1);
      for (const peer of peers) {
        peerNames.set(peer.id, peer.username || 'Guest');
        politePeers.set(peer.id, false);
        createRemoteTile(peer.id);
        setTileLabel(peer.id);
        await ensurePeerConnection(peer.id, true);
      }
      applyRoomState(message.room);
      updateStageMeta();
      return;
    }

    if (message.type === 'room-state') {
      const count = (message.room?.participants || []).length || participantCount;
      setPeople(count);
      applyRoomState(message.room);
      return;
    }

    if (message.type === 'participant-joined') {
      const peerId = message.peer.id;
      peerNames.set(peerId, message.peer.username || 'Guest');
      politePeers.set(peerId, true);
      createRemoteTile(peerId);
      setTileLabel(peerId);
      await ensurePeerConnection(peerId, false);
      setPeople(participantCount + 1);
      pushFeed(`<strong>${escapeHtml(message.peer.username || 'Guest')}</strong> joined the room.`);
      showToast('Someone joined', `${message.peer.username || 'A guest'} is in the room now.`);
      updateStageMeta();
      return;
    }

    if (message.type === 'participant-left') {
      const leftName = peerNames.get(message.peerId) || 'A guest';
      cleanupPeer(message.peerId);
      setPeople(Math.max(0, participantCount - 1));
      pushFeed(`<strong>system</strong> ${escapeHtml(leftName)} left the room.`);
      showToast('Someone left', `${leftName} left, but the room is still open.`);
      updateStageMeta();
      return;
    }

    if (message.type === 'offer') {
      await handleOffer(message.from, message.payload);
      return;
    }

    if (message.type === 'answer') {
      await handleAnswer(message.from, message.payload);
      return;
    }

    if (message.type === 'ice-candidate') {
      await handleIceCandidate(message.from, message.payload);
      return;
    }

    if (message.type === 'event') {
      handleRoomEvent(message);
    }
  };

  ws.onclose = (event) => {
    setStatus('Disconnected');
    setButtonsConnected(false);
    updateStageMeta();
    if (event.code === 4403) {
      showToast('Room is locked', 'The host locked this room. Join before they lock it next time, tragic but orderly.');
      pushFeed('<strong>system</strong> room is locked by the host.');
    }
  };
}

async function ensurePeerConnection(peerId, initiator) {
  if (peerConnections.has(peerId)) return peerConnections.get(peerId);

  const pc = new RTCPeerConnection(STUN_CONFIG);
  peerConnections.set(peerId, pc);
  makingOffer.set(peerId, false);

  const remoteStream = new MediaStream();
  remoteStreams.set(peerId, remoteStream);
  renderRemoteStream(peerId);

  const audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
  const videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
  pc._audioSender = audioTransceiver.sender;
  pc._videoSender = videoTransceiver.sender;

  pc.onicecandidate = (event) => {
    if (event.candidate) wsSend({ type: 'ice-candidate', target: peerId, payload: event.candidate });
  };

  pc.ontrack = (event) => {
    const stream = event.streams[0];
    for (const track of stream.getTracks()) {
      if (!remoteStream.getTracks().find(t => t.id === track.id)) remoteStream.addTrack(track);
    }
    renderRemoteStream(peerId);
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (state === 'connected') {
      setStatus('Streaming');
      showToast('Stream connected', `${peerNames.get(peerId) || 'A guest'} is live.`);
    }
    if (['closed', 'failed', 'disconnected'].includes(state)) updateStageMeta();
  };

  await syncTracksForPeer(peerId);

  if (initiator) {
    try {
      makingOffer.set(peerId, true);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      wsSend({ type: 'offer', target: peerId, payload: pc.localDescription });
    } catch (error) {
      console.error('Initial offer failed:', error);
    } finally {
      makingOffer.set(peerId, false);
    }
  }

  return pc;
}

async function syncTracksForPeer(peerId) {
  const pc = peerConnections.get(peerId);
  if (!pc) return;
  const videoTrack = localStream?.getVideoTracks?.()[0] || null;
  const audioTrack = localStream?.getAudioTracks?.()[0] || null;
  await pc._videoSender.replaceTrack(videoTrack);
  await pc._audioSender.replaceTrack(audioTrack);
}

async function handleOffer(peerId, offer) {
  const pc = await ensurePeerConnection(peerId, false);
  const polite = politePeers.get(peerId) ?? true;
  const offerCollision = (makingOffer.get(peerId) || false) || pc.signalingState !== 'stable';
  if (offerCollision && !polite) return;
  await pc.setRemoteDescription(offer);
  await syncTracksForPeer(peerId);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  wsSend({ type: 'answer', target: peerId, payload: pc.localDescription });
}

async function handleAnswer(peerId, answer) {
  const pc = peerConnections.get(peerId);
  if (!pc) return;
  await pc.setRemoteDescription(answer);
}

async function handleIceCandidate(peerId, candidate) {
  const pc = peerConnections.get(peerId);
  if (!pc) return;
  try {
    await pc.addIceCandidate(candidate);
  } catch (error) {
    console.error('ICE candidate failed:', error);
  }
}

function explainDisplayError(error) {
  if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return {
      status: 'HTTPS needed',
      title: 'Secure context needed',
      text: 'Hosted screen sharing needs HTTPS. Localhost is fine. Random insecure pages are not.'
    };
  }
  const name = error?.name || 'Error';
  if (name === 'NotAllowedError') {
    return {
      status: 'Share cancelled',
      title: 'Share was denied',
      text: 'The browser permission window was closed or denied. Pick the movie tab and allow it.'
    };
  }
  if (name === 'AbortError') {
    return {
      status: 'Share cancelled',
      title: 'Share window closed',
      text: 'The browser share picker was opened and then closed before starting.'
    };
  }
  if (name === 'NotFoundError') {
    return {
      status: 'No source found',
      title: 'Nothing to share',
      text: 'The browser could not find a screen or tab source to share.'
    };
  }
  if (name === 'NotReadableError') {
    return {
      status: 'Share unavailable',
      title: 'Share source busy',
      text: 'Another app or OS setting blocked access to the selected screen or tab.'
    };
  }
  if (name === 'TypeError') {
    return {
      status: 'Browser issue',
      title: 'Browser returned TypeError',
      text: 'Usually this means the browser did not like one of the share options. Retrying the same button normally works.'
    };
  }
  return {
    status: 'Share failed',
    title: 'Share not started',
    text: error?.message || 'The browser blocked or cancelled screen sharing.'
  };
}

async function getDisplayStream() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    throw new Error('This browser does not support screen sharing here.');
  }
  const enhanced = {
    video: { frameRate: { ideal: 30, max: 60 } },
    audio: true,
    preferCurrentTab: true,
    selfBrowserSurface: 'exclude',
    systemAudio: 'include',
    surfaceSwitching: 'include'
  };
  try {
    return await navigator.mediaDevices.getDisplayMedia(enhanced);
  } catch (error) {
    return navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  }
}

async function startShare() {
  setStatus('Choose movie tab...');
  try {
    localStream = await getDisplayStream();
  } catch (error) {
    const detail = explainDisplayError(error);
    setStatus(detail.status);
    showToast(detail.title, detail.text);
    pushFeed(`<strong>system</strong> ${escapeHtml(detail.text)}`);
    return;
  }

  if (!localStream.getAudioTracks().length) {
    showToast('Audio missing', 'Screen share started, but no audio track came through. Pick a browser tab and enable audio.');
  }

  localStream.getVideoTracks().forEach(track => {
    track.onended = () => stopShare();
  });

  updateLocalPreview();
  shareBtn.disabled = true;
  stopShareBtn.disabled = false;
  setStatus('Sharing screen');
  pushFeed('<strong>you</strong> started screen share.');

  for (const peerId of peerConnections.keys()) await syncTracksForPeer(peerId);
}

async function stopShare() {
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  localStream = null;
  updateLocalPreview();
  shareBtn.disabled = false;
  stopShareBtn.disabled = true;
  setStatus('Share stopped');
  pushFeed('<strong>you</strong> stopped screen share.');
  for (const peerId of peerConnections.keys()) await syncTracksForPeer(peerId);
}

function sendRoomEvent(event, payload = {}) {
  wsSend({ type: 'event', event, payload });
}

function handleRoomEvent(message) {
  const who = escapeHtml(message.username || 'Guest');
  if (message.event === 'heart') {
    burstHearts(3);
    pushFeed(`<strong>${who}</strong> sent a heart.`);
    showToast('Heart received', `${message.username || 'Someone'} sent some affection.`);
    return;
  }
  if (message.event === 'ready') {
    pushFeed(`<strong>${who}</strong> asked: ready?`);
    showToast('Ready check', `${message.username || 'Someone'} wants to start.`);
    return;
  }
  if (message.event === 'vibe') {
    const vibe = escapeHtml(message.payload?.label || 'a vibe');
    pushFeed(`<strong>${who}</strong> picked <em>${vibe}</em>.`);
    showToast('Vibe update', `${message.username || 'Someone'} picked ${message.payload?.label || 'a vibe'}.`);
    return;
  }
  if (message.event === 'chat') {
    addChatItem(message.payload?.text || '', message.username || 'Guest', 'user');
    return;
  }
  if (message.event === 'set-title') {
    const title = escapeHtml(message.payload?.title || 'Movie night');
    pushFeed(`<strong>${who}</strong> renamed the room to <em>${title}</em>.`);
    return;
  }
  if (message.event === 'lock-room') {
    pushFeed(`<strong>${who}</strong> locked the room.`);
    showToast('Room locked', `${message.username || 'Host'} stopped new joins.`);
    return;
  }
  if (message.event === 'unlock-room') {
    pushFeed(`<strong>${who}</strong> unlocked the room.`);
    showToast('Room unlocked', `${message.username || 'Host'} opened the room again.`);
    return;
  }
  if (message.event === 'host-changed') {
    pushFeed(`<strong>system</strong> host changed to <em>${escapeHtml(message.payload?.newHostName || 'someone')}</em>.`);
  }
}

async function copyInviteLink() {
  const link = getInviteLink();
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    copyMessage.textContent = 'Invite link copied.';
  } catch {
    copyMessage.textContent = link;
  }
}

function openUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
    window.open(parsed.toString(), '_blank', 'noopener,noreferrer');
  } catch {
    showToast('Invalid link', 'Use a full http or https link.');
  }
}

createRoomBtn.addEventListener('click', async () => {
  const newRoomId = await fetchNewRoom();
  connectWebSocket(newRoomId);
});

joinRoomBtn.addEventListener('click', () => {
  const target = roomInput.value.trim();
  if (target) connectWebSocket(target);
});

shareBtn.addEventListener('click', startShare);
stopShareBtn.addEventListener('click', stopShare);

copyInviteBtn.addEventListener('click', copyInviteLink);

whatsappInviteBtn.addEventListener('click', () => {
  const link = getInviteLink();
  if (!link) return;
  const text = encodeURIComponent(`Join my CosySync room: ${link}`);
  window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer');
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

theaterBtn.addEventListener('click', () => {
  document.body.classList.toggle('theater-mode');
});

fullscreenBtn.addEventListener('click', async () => {
  const stage = document.getElementById('stageContainer');
  if (!document.fullscreenElement) {
    await stage.requestFullscreen?.();
  } else {
    await document.exitFullscreen?.();
  }
});

enableAudioBtn.addEventListener('click', async () => {
  const videos = [...document.querySelectorAll('.remote-tile video')];
  for (const video of videos) {
    try {
      video.muted = false;
      await video.play();
    } catch {}
  }
  showToast('Audio nudge sent', 'Tapped room audio. Browsers still love asking for one more click.');
});

actionButtons.forEach(button => {
  button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (!roomId) return showToast('Join a room first', 'Create or join a room before using extras.');
    if (action === 'heart') {
      burstHearts(3);
      pushFeed('<strong>you</strong> sent a heart.');
    }
    if (action === 'ready') {
      pushFeed('<strong>you</strong> asked if everyone is ready.');
    }
    sendRoomEvent(action);
  });
});

vibeButtons.forEach(button => {
  button.addEventListener('click', () => {
    if (!roomId) return showToast('Join a room first', 'Create or join a room before setting the vibe.');
    const label = button.dataset.vibe;
    pushFeed(`<strong>you</strong> picked <em>${escapeHtml(label)}</em>.`);
    sendRoomEvent('vibe', { label });
  });
});

serviceButtons.forEach(button => {
  button.addEventListener('click', () => openUrl(button.dataset.url));
});

openCustomUrlBtn.addEventListener('click', () => {
  const value = customUrlInput.value.trim();
  if (!value) return;
  openUrl(value);
});

setTitleBtn.addEventListener('click', () => {
  if (!roomId || !isHost) return;
  const title = roomTitleInput.value.trim();
  sendRoomEvent('set-title', { title });
});

lockRoomBtn.addEventListener('click', () => {
  if (!roomId || !isHost) return;
  sendRoomEvent(roomLocked ? 'unlock-room' : 'lock-room');
});

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!roomId) return showToast('Join a room first', 'Create or join a room before chatting.');
  const text = chatInput.value.trim();
  if (!text) return;
  addChatItem(text, username, 'user');
  sendRoomEvent('chat', { text });
  chatInput.value = '';
});

const initialRoom = new URL(window.location.href).searchParams.get('room');
if (initialRoom) {
  roomInput.value = initialRoom;
  connectWebSocket(initialRoom);
} else {
  updateParticipantList([]);
}
updateInviteLink();
updateStageMeta();
