const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

// Helper to strip base64 header and get mime type
function parseDataUri(dataUri) {
  if (!dataUri || !dataUri.startsWith('data:')) return { mime: null, data: null };
  const semi = dataUri.indexOf(';');
  const comma = dataUri.indexOf(',');
  const mime = dataUri.substring(5, semi);
  const data = dataUri.substring(comma + 1);
  return { mime, data };
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const MESSAGES_ADMIN1_FILE = path.join(DATA_DIR, 'messages_admin1.json');
const MESSAGES_ADMIN2_FILE = path.join(DATA_DIR, 'messages_admin2.json');

if (!fs.existsSync(MESSAGES_ADMIN1_FILE)) {
  fs.writeFileSync(MESSAGES_ADMIN1_FILE, JSON.stringify([], null, 2));
}
if (!fs.existsSync(MESSAGES_ADMIN2_FILE)) {
  fs.writeFileSync(MESSAGES_ADMIN2_FILE, JSON.stringify([], null, 2));
}

function loadJson(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {}
  return defaultValue;
}

function saveJson(filePath, data) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (e) {}
}

function getAllMessages() {
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  const map = new Map();
  [...m1, ...m2].forEach(m => map.set(m.id, m));
  return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function saveMessageToContainers(msg) {
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  if (!m1.some(m => m.id === msg.id)) m1.push(msg);
  if (!m2.some(m => m.id === msg.id)) m2.push(msg);
  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
}
const PRESENCE_FILE = path.join(DATA_DIR, 'presence.json');
const CREDENTIALS_FILE = path.join(DATA_DIR, 'credentials.json');
const STICKERS_FILE = path.join(DATA_DIR, 'stickers.json');
const AVATARS_DIR = path.join(DATA_DIR, 'avatars');

// Separate isolated storage containers for each user's profile picture
const AVATAR_CONTAINERS = {
  admin1: path.join(DATA_DIR, 'avatar_container_admin1'), // user1's isolated storage
  admin2: path.join(DATA_DIR, 'avatar_container_admin2')  // user2's isolated storage
};

// Ensure data directory and files exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(AVATARS_DIR)) {
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
}

Object.values(AVATAR_CONTAINERS).forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

function getAvatarContainerPath(adminId) {
  const containerDir = AVATAR_CONTAINERS[adminId] || path.join(DATA_DIR, `avatar_container_${adminId}`);
  if (!fs.existsSync(containerDir)) {
    fs.mkdirSync(containerDir, { recursive: true });
  }
  return path.join(containerDir, 'avatar.txt');
}

if (!fs.existsSync(MESSAGES_FILE)) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify([], null, 2));
}

if (!fs.existsSync(PRESENCE_FILE)) {
  fs.writeFileSync(PRESENCE_FILE, JSON.stringify({
    user1: { lastSeen: Date.now(), online: false },
    user2: { lastSeen: Date.now(), online: false }
  }, null, 2));
}

const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
if (!fs.existsSync(MESSAGES_FILE)) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify([], null, 2));
}

if (!fs.existsSync(CREDENTIALS_FILE)) {
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify({
    admin1: { name: 'user1', pass: 'user1', partnerName: 'user2' },
    admin2: { name: 'user2', pass: 'user2', partnerName: 'user1' }
  }, null, 2));
}

if (!fs.existsSync(STICKERS_FILE)) {
  fs.writeFileSync(STICKERS_FILE, JSON.stringify([], null, 2));
}

function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function saveJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {}
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// GIPHY Search proxy endpoint
app.get('/api/giphy/search', async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'Search query parameter "q" is required' });
  }

  const GIPHY_API_KEY = 'GrDHHFZqa3V4qozCJQanXFOgjxsS5ol4';
  const limit = req.query.limit || 16;
  const url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=${limit}&rating=g`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching from GIPHY:', error);
    res.status(500).json({ error: 'Failed to fetch GIFs from GIPHY' });
  }
});

app.get('/api/messages', (req, res) => {
  res.json(getAllMessages());
});

app.post('/api/messages', (req, res) => {
  const msg = req.body;
  if (!msg || !msg.id) return res.status(400).json({ error: 'Invalid message' });
  saveMessageToContainers(msg);
  broadcast({ type: 'new_message', message: msg });
  res.json({ success: true });
});

app.post('/api/auth/login', (req, res) => {
  const { passcode } = req.body;
  const creds = loadJson(CREDENTIALS_FILE, {});
  for (const [adminId, data] of Object.entries(creds)) {
    if (data.pass === passcode) {
      return res.json({ success: true, adminId, name: data.name, partnerName: data.partnerName });
    }
  }
  res.status(401).json({ success: false, error: 'Invalid passcode' });
});

app.get('/api/credentials/:adminId', (req, res) => {
  const creds = loadJson(CREDENTIALS_FILE, {});
  const data = creds[req.params.adminId];
  if (data) {
    const partnerAdminId = req.params.adminId === 'admin1' ? 'admin2' : 'admin1';
    const partnerData = creds[partnerAdminId] || {};
    res.json({ name: data.name, pass: data.pass, partnerName: partnerData.name || 'Partner' });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.post('/api/credentials/:adminId', (req, res) => {
  const { name, pass, invalidateOld } = req.body;
  const creds = loadJson(CREDENTIALS_FILE, {});
  if (creds[req.params.adminId]) {
    if (name) creds[req.params.adminId].name = name;
    if (pass) creds[req.params.adminId].pass = pass;
    saveJson(CREDENTIALS_FILE, creds);
    broadcast({ type: 'profile_updated', adminId: req.params.adminId, name: creds[req.params.adminId].name });
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.get('/api/avatar/:adminId', (req, res) => {
  const avatarPath = getAvatarContainerPath(req.params.adminId);
  if (fs.existsSync(avatarPath)) {
    const avatarData = fs.readFileSync(avatarPath, 'utf8');
    res.json({ avatar: avatarData });
  } else {
    res.json({ avatar: null });
  }
});

app.post('/api/avatar/:adminId', (req, res) => {
  const { avatarDataUri } = req.body;
  const avatarPath = getAvatarContainerPath(req.params.adminId);
  if (avatarDataUri) {
    fs.writeFileSync(avatarPath, avatarDataUri, 'utf8');
  } else if (fs.existsSync(avatarPath)) {
    fs.unlinkSync(avatarPath);
  }
  broadcast({ type: 'avatar_updated', adminId: req.params.adminId, avatar: avatarDataUri || null });
  res.json({ success: true });
});

app.delete('/api/avatar/:adminId', (req, res) => {
  const avatarPath = getAvatarContainerPath(req.params.adminId);
  if (fs.existsSync(avatarPath)) {
    fs.unlinkSync(avatarPath);
  }
  broadcast({ type: 'avatar_updated', adminId: req.params.adminId, avatar: null });
  res.json({ success: true });
});

app.get('/api/stickers', (req, res) => {
  res.json(loadJson(STICKERS_FILE, []));
});

app.post('/api/stickers', (req, res) => {
  const { sticker, stickerData, createdBy } = req.body;
  const stickers = loadJson(STICKERS_FILE, []);
  const newStk = sticker || {
    id: 'stk_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    data: stickerData,
    createdBy: createdBy || 'User',
    timestamp: Date.now()
  };
  if (!stickers.some(s => s.id === newStk.id)) {
    stickers.push(newStk);
    saveJson(STICKERS_FILE, stickers);
    broadcast({ type: 'new_sticker', sticker: newStk });
  }
  res.json({ success: true, sticker: newStk });
});

app.delete('/api/stickers/:id', (req, res) => {
  let stickers = loadJson(STICKERS_FILE, []);
  stickers = stickers.filter(s => s.id !== req.params.id);
  saveJson(STICKERS_FILE, stickers);
  broadcast({ type: 'delete_sticker', stickerId: req.params.id });
  res.json({ success: true });
});

app.post('/api/messages/view-media', (req, res) => {
  const { messageId, user } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  let updatedMsg = null;

  [m1, m2].forEach(container => {
    const msg = container.find(m => m.id === messageId);
    if (msg) {
      msg.viewsCount = (msg.viewsCount || 0) + 1;
      if (msg.maxViews && msg.viewsCount >= msg.maxViews) {
        msg.mediaOpened = true;
      }
      updatedMsg = msg;
    }
  });

  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);

  if (updatedMsg) {
    broadcast({
      type: 'media_viewed',
      messageId,
      viewsCount: updatedMsg.viewsCount,
      mediaOpened: updatedMsg.mediaOpened
    });
    res.json({ success: true, viewsCount: updatedMsg.viewsCount, mediaOpened: updatedMsg.mediaOpened });
  } else {
    res.status(404).json({ error: 'Message not found' });
  }
});

app.post('/api/messages/edit', (req, res) => {
  const { messageId, user, newText } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  const editedAt = Date.now();

  [m1, m2].forEach(container => {
    const msg = container.find(m => m.id === messageId);
    if (msg) {
      msg.text = newText;
      msg.edited = true;
      msg.editedAt = editedAt;
    }
  });

  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);

  broadcast({ type: 'message_edited', messageId, newText, editedAt });
  res.json({ success: true });
});

app.post('/api/messages/unsend', (req, res) => {
  const { messageId } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);

  const filtered1 = m1.filter(m => m.id !== messageId);
  const filtered2 = m2.filter(m => m.id !== messageId);

  saveJson(MESSAGES_ADMIN1_FILE, filtered1);
  saveJson(MESSAGES_ADMIN2_FILE, filtered2);

  broadcast({ type: 'message_unsent', messageId });
  res.json({ success: true });
});

app.post('/api/messages/delete-for-me', (req, res) => {
  const { messageId, user } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);

  [m1, m2].forEach(container => {
    const msg = container.find(m => m.id === messageId);
    if (msg) {
      if (!msg.deletedFor) msg.deletedFor = [];
      if (!msg.deletedFor.includes(user)) msg.deletedFor.push(user);
    }
  });

  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);

  res.json({ success: true });
});

app.post('/api/messages/seen', (req, res) => {
  const { user } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  const seenAt = Date.now();

  [m1, m2].forEach(container => {
    container.forEach(m => {
      if (m.recipient === user && !m.seen) {
        m.seen = true;
        m.seenAt = seenAt;
      }
    });
  });

  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);

  broadcast({ type: 'messages_seen', seenBy: user, seenAt });
  res.json({ success: true });
});

app.post('/api/messages/pin', (req, res) => {
  const { messageId, pinned } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);

  [m1, m2].forEach(container => {
    const msg = container.find(m => m.id === messageId);
    if (msg) {
      msg.pinned = Boolean(pinned);
    }
  });

  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);

  broadcast({ type: 'message_pinned', messageId, pinned });
  res.json({ success: true });
});

app.post('/api/messages/react', (req, res) => {
  const { messageId, user, reaction } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  let updatedReactions = {};

  [m1, m2].forEach(container => {
    const msg = container.find(m => m.id === messageId);
    if (msg) {
      if (!msg.reactions) msg.reactions = {};
      if (msg.reactions[user] === reaction) {
        delete msg.reactions[user];
      } else {
        msg.reactions[user] = reaction;
      }
      updatedReactions = msg.reactions;
    }
  });

  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);

  broadcast({ type: 'message_reaction', messageId, reactions: updatedReactions });
  res.json({ success: true, reactions: updatedReactions });
});

app.post('/api/messages/clear', (req, res) => {
  saveJson(MESSAGES_ADMIN1_FILE, []);
  saveJson(MESSAGES_ADMIN2_FILE, []);
  broadcast({ type: 'clear_chat' });
  res.json({ success: true });
});

app.post('/api/presence', (req, res) => {
  const { user, online } = req.body;
  const presence = loadJson(PRESENCE_FILE, {});
  if (presence[user]) {
    presence[user].online = Boolean(online);
    presence[user].lastSeen = Date.now();
    saveJson(PRESENCE_FILE, presence);
    broadcast({ type: 'presence_update', presence });
  }
  res.json({ success: true });
});

function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'auth') {
        ws.username = data.user;
      } else {
        broadcast(data);
      }
    } catch (e) {}
  });

  const avatars = {};
  ['admin1', 'admin2'].forEach(id => {
    const p = getAvatarContainerPath(id);
    if (fs.existsSync(p)) {
      avatars[id] = fs.readFileSync(p, 'utf8');
    }
  });

  ws.send(JSON.stringify({
    type: 'init',
    messages: getAllMessages(),
    stickers: loadJson(STICKERS_FILE, []),
    avatars
  }));
});

server.listen(PORT, () => {
  console.log(`Server running smoothly on port ${PORT}`);
});

app.get('/api/stickers', (req, res) => {
  res.json(loadJson(STICKERS_FILE, []));
});

app.post('/api/stickers', (req, res) => {
const stks = loadJson(STICKERS_FILE, []);
  const newStk = req.body.sticker || { id: 'stk_' + Date.now(), data: req.body.stickerData };
  if (!stks.some(s => s.id === newStk.id)) {
    stks.unshift(newStk);
    saveJson(STICKERS_FILE, stks);
    broadcast({ type: 'new_sticker', sticker: newStk });
  }
  res.json({ success: true });
});

app.delete('/api/stickers/:id', (req, res) => {
  let stks = loadJson(STICKERS_FILE, []);
  stks = stks.filter(s => s.id !== req.params.id);
  saveJson(STICKERS_FILE, stks);
  broadcast({ type: 'delete_sticker', stickerId: req.params.id });
  res.json({ success: true });
});

app.post('/api/messages/view-media', (req, res) => {
  const { messageId, user } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  let updatedViews = 1, isOpened = false;

  [m1, m2].forEach(list => {
    const m = list.find(x => x.id === messageId);
    if (m) {
      m.viewsCount = (m.viewsCount || 0) + 1;
      updatedViews = m.viewsCount;
      if (m.maxViews && m.viewsCount >= m.maxViews) {
        m.mediaOpened = true;
        isOpened = true;
      }
    }
  });
  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  broadcast({ type: 'media_viewed', messageId, viewsCount: updatedViews, mediaOpened: isOpened });
  res.json({ success: true, viewsCount: updatedViews, mediaOpened: isOpened });
});

app.post('/api/messages/edit', (req, res) => {
  const { messageId, newText } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  const editedAt = Date.now();
  [m1, m2].forEach(list => {
    const m = list.find(x => x.id === messageId);
    if (m) { m.text = newText; m.edited = true; m.editedAt = editedAt; }
  });
  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  broadcast({ type: 'message_edited', messageId, newText, editedAt });
  res.json({ success: true });
});

app.post('/api/messages/unsend', (req, res) => {
  const { messageId } = req.body;
  let m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  let m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  m1 = m1.filter(x => x.id !== messageId);
  m2 = m2.filter(x => x.id !== messageId);
  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  broadcast({ type: 'message_unsent', messageId });
  res.json({ success: true });
});

app.post('/api/messages/delete-for-me', (req, res) => {
  const { messageId, user } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  [m1, m2].forEach(list => {
    const m = list.find(x => x.id === messageId);
    if (m) {
      if (!m.deletedFor) m.deletedFor = [];
      if (!m.deletedFor.includes(user)) m.deletedFor.push(user);
    }
  });
  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  broadcast({ type: 'delete_for_me', messageId, user });
  res.json({ success: true });
});

app.post('/api/messages/pin', (req, res) => {
  const { messageId, pinned } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  [m1, m2].forEach(list => {
    const m = list.find(x => x.id === messageId);
    if (m) m.pinned = pinned;
  });
  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  broadcast({ type: 'message_pinned', messageId, pinned });
  res.json({ success: true });
});

app.post('/api/messages/react', (req, res) => {
  const { messageId, user, reaction } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  let updatedReactions = {};
  [m1, m2].forEach(list => {
    const m = list.find(x => x.id === messageId);
    if (m) {
      if (!m.reactions) m.reactions = {};
      if (m.reactions[user] === reaction) {
        delete m.reactions[user];
      } else {
        m.reactions[user] = reaction;
      }
      updatedReactions = m.reactions;
    }
  });
  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  broadcast({ type: 'message_reaction', messageId, reactions: updatedReactions });
  res.json({ success: true, reactions: updatedReactions });
});

app.post('/api/messages/seen', (req, res) => {
  const { user } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  const now = Date.now();
  [m1, m2].forEach(list => {
    list.forEach(m => {
      if (m.recipient === user && !m.seen) {
        m.seen = true;
        m.seenAt = now;
      }
    });
  });
  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  broadcast({ type: 'messages_seen', seenBy: user, seenAt: now });
  res.json({ success: true });
});

app.post('/api/messages/clear', (req, res) => {
  saveJson(MESSAGES_ADMIN1_FILE, []);
  saveJson(MESSAGES_ADMIN2_FILE, []);
  broadcast({ type: 'clear_chat' });
  res.json({ success: true });
});

app.post('/api/presence', (req, res) => {
  const { user, online } = req.body;
  const presence = loadJson(PRESENCE_FILE, {});
  if (presence[user]) {
    presence[user].online = Boolean(online);
    presence[user].lastSeen = Date.now();
    saveJson(PRESENCE_FILE, presence);
    broadcast({ type: 'presence_update', presence });
  }
  res.json({ success: true });
});

function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'auth') {
        ws.username = data.user;
      } else {
        broadcast(data);
      }
    } catch (e) {}
  });

  const avatars = {};
  ['admin1', 'admin2'].forEach(id => {
    const p = getAvatarContainerPath(id);
    if (fs.existsSync(p)) {
      avatars[id] = fs.readFileSync(p, 'utf8');
    }
  });

  ws.send(JSON.stringify({
    type: 'init',
    messages: getAllMessages(),
    stickers: loadJson(STICKERS_FILE, []),
    avatars
  }));
});

server.listen(PORT, () => {
  console.log(`Server running smoothly on port ${PORT}`);
});

app.get('/api/stickers', (req, res) => {
  res.json(loadJson(STICKERS_FILE, []));
});

app.post('/api/stickers', (req, res) => {
  const stks = loadJson(STICKERS_FILE, []);
  const newStk = req.body.sticker || { id: 'stk_' + Date.now(), data: req.body.stickerData };
  if (!stks.some(s => s.id === newStk.id)) {
    stks.unshift(newStk);
    saveJson(STICKERS_FILE, stks);
    broadcast({ type: 'new_sticker', sticker: newStk });
  }
  res.json({ success: true });
});

app.delete('/api/stickers/:id', (req, res) => {
  let stks = loadJson(STICKERS_FILE, []);
  stks = stks.filter(s => s.id !== req.params.id);
  saveJson(STICKERS_FILE, stks);
  broadcast({ type: 'delete_sticker', stickerId: req.params.id });
  res.json({ success: true });
});

app.post('/api/messages/view-media', (req, res) => {
  const { messageId, user } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  let updatedViews = 1, isOpened = false;

  [m1, m2].forEach(list => {
    const m = list.find(x => x.id === messageId);
    if (m) {
      m.viewsCount = (m.viewsCount || 0) + 1;
      updatedViews = m.viewsCount;
      if (m.maxViews && m.viewsCount >= m.maxViews) {
        m.mediaOpened = true;
        isOpened = true;
      }
    }
  });
  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  broadcast({ type: 'media_viewed', messageId, viewsCount: updatedViews, mediaOpened: isOpened });
  res.json({ success: true, viewsCount: updatedViews, mediaOpened: isOpened });
});

app.post('/api/messages/edit', (req, res) => {
  const { messageId, newText } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  const editedAt = Date.now();
  [m1, m2].forEach(list => {
    const m = list.find(x => x.id === messageId);
    if (m) { m.text = newText; m.edited = true; m.editedAt = editedAt; }
  });
  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  broadcast({ type: 'message_edited', messageId, newText, editedAt });
  res.json({ success: true });
});

app.post('/api/messages/unsend', (req, res) => {
  const { messageId } = req.body;
  let m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  let m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  m1 = m1.filter(x => x.id !== messageId);
  m2 = m2.filter(x => x.id !== messageId);
  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  broadcast({ type: 'message_unsent', messageId });
  res.json({ success: true });
});

app.post('/api/messages/delete-for-me', (req, res) => {
  const { messageId, user } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  [m1, m2].forEach(list => {
    const m = list.find(x => x.id === messageId);
    if (m) {
      if (!m.deletedFor) m.deletedFor = [];
      if (!m.deletedFor.includes(user)) m.deletedFor.push(user);
    }
  });
  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  broadcast({ type: 'delete_for_me', messageId, user });
  res.json({ success: true });
});

app.post('/api/messages/pin', (req, res) => {
  const { messageId, pinned } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  [m1, m2].forEach(list => {
    const m = list.find(x => x.id === messageId);
    if (m) m.pinned = pinned;
  });
  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  broadcast({ type: 'message_pinned', messageId, pinned });
  res.json({ success: true });
});

app.post('/api/messages/react', (req, res) => {
  const { messageId, user, reaction } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  let updatedReactions = {};
  [m1, m2].forEach(list => {
    const m = list.find(x => x.id === messageId);
    if (m) {
      if (!m.reactions) m.reactions = {};
      if (m.reactions[user] === reaction) {
        delete m.reactions[user];
      } else {
        m.reactions[user] = reaction;
      }
      updatedReactions = m.reactions;
    }
  });
  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  broadcast({ type: 'message_reaction', messageId, reactions: updatedReactions });
  res.json({ success: true, reactions: updatedReactions });
});

app.post('/api/messages/seen', (req, res) => {
  const { user } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  const now = Date.now();
  [m1, m2].forEach(list => {
    list.forEach(m => {
      if (m.recipient === user && !m.seen) {
        m.seen = true;
        m.seenAt = now;
      }
    });
  });
  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  broadcast({ type: 'messages_seen', seenBy: user, seenAt: now });
  res.json({ success: true });
});

app.post('/api/messages/clear', (req, res) => {
  saveJson(MESSAGES_ADMIN1_FILE, []);
  saveJson(MESSAGES_ADMIN2_FILE, []);
  broadcast({ type: 'clear_chat' });
  res.json({ success: true });
});

app.get('/api/avatar/:adminId', (req, res) => {
  const p = getAvatarContainerPath(req.params.adminId);
  if (fs.existsSync(p)) {
    const avatar = fs.readFileSync(p, 'utf8');
    res.json({ avatar: avatar || null });
  } else {
    res.json({ avatar: null });
  }
});

app.post('/api/avatar/:adminId', (req, res) => {
  const { avatarDataUri } = req.body;
  const p = getAvatarContainerPath(req.params.adminId);
  fs.writeFileSync(p, avatarDataUri || '', 'utf8');
  broadcast({ type: 'avatar_updated', adminId: req.params.adminId, avatar: avatarDataUri });
  res.json({ success: true });
});

app.delete('/api/avatar/:adminId', (req, res) => {
  const p = getAvatarContainerPath(req.params.adminId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  broadcast({ type: 'avatar_updated', adminId: req.params.adminId, avatar: null });
  res.json({ success: true });
});

const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      broadcast(data, ws);
    } catch (e) {}
  });
  ws.on('close', () => clients.delete(ws));
});

function broadcast(data, excludeWs = null) {
  const payload = JSON.stringify(data);
  clients.forEach(client => {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

if (!fs.existsSync(CREDENTIALS_FILE)) {
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify({
    admin1: { id: 'admin1', name: 'user1', pass: '1234' },
    admin2: { id: 'admin2', name: 'user2', pass: '4321' }
  }, null, 2));
}

if (!fs.existsSync(STICKERS_FILE)) {
  fs.writeFileSync(STICKERS_FILE, JSON.stringify([], null, 2));
}

function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Error reading ${file}:`, err);
    return fallback;
  }
}

function saveJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`Error writing ${file}:`, err);
  }
}

// Support large payloads (up to 50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname)));

// Standardize error response
function sendError(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

// Global async error wrapper
const asyncHandler = (fn) => (req, res, next) => {
  return Promise.resolve(fn(req, res, next)).catch(next);
};

// Broadcast helper for WebSockets
function broadcast(data, excludeWs = null) {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// REST API Endpoints
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', serverTime: Date.now() });
});

function getAvatarDataUri(adminId) {
  const containerFile = getAvatarContainerPath(adminId);
  if (fs.existsSync(containerFile)) {
    try { return fs.readFileSync(containerFile, 'utf8'); } catch (e) { return null; }
  }
  // Auto-migrate from legacy path if exists
  const legacyB64Path = path.join(AVATARS_DIR, `${adminId}.txt`);
  if (fs.existsSync(legacyB64Path)) {
    try {
      const data = fs.readFileSync(legacyB64Path, 'utf8');
      fs.writeFileSync(containerFile, data, 'utf8');
      return data;
    } catch (e) {}
  }
  return null;
}

// Credentials: Login check
app.post('/api/auth/login', (req, res) => {
  const { passcode } = req.body;
  if (!passcode) return res.status(400).json({ error: 'Passcode required' });

  const creds = loadJson(CREDENTIALS_FILE, {
    admin1: { id: 'admin1', name: 'user1', pass: '1234' },
    admin2: { id: 'admin2', name: 'user2', pass: '1234' }
  });

  if (passcode === creds.admin1.pass) {
    return res.json({
      success: true,
      adminId: 'admin1',
      name: creds.admin1.name,
      partnerName: creds.admin2.name,
      avatar: getAvatarDataUri('admin1'),
partnerAvatar: getAvatarDataUri('admin2')
    });
  } else if (passcode === creds.admin2.pass) {
    return res.json({
      success: true,
      adminId: 'admin2',
      name: creds.admin2.name,
      partnerName: creds.admin1.name,
      avatar: getAvatarDataUri('admin2'),
      partnerAvatar: getAvatarDataUri('admin1')
    });
  }

  res.status(401).json({ error: 'Incorrect passcode' });
});

// Get ONLY own credentials
app.get('/api/credentials/:adminId', (req, res) => {
  const { adminId } = req.params;
  const creds = loadJson(CREDENTIALS_FILE, {
    admin1: { id: 'admin1', name: 'user1', pass: '1234' },
    admin2: { id: 'admin2', name: 'user2', pass: '1234' }
  });

  if (adminId && creds[adminId]) {
    // Also check if avatar file exists
    const avatarPath = path.join(AVATARS_DIR, `${adminId}.jpg`);
    const avatarB64Path = path.join(AVATARS_DIR, `${adminId}.txt`);
    let avatarDataUri = null;

    if (fs.existsSync(avatarB64Path)) {
      try {
        avatarDataUri = fs.readFileSync(avatarB64Path, 'utf8');
      } catch (e) {}
    }

    res.json({
      id: adminId,
      name: creds[adminId].name,
      pass: creds[adminId].pass,
      avatar: avatarDataUri,
      partnerName: adminId === 'admin1' ? creds.admin2.name : creds.admin1.name
    });
  } else {
    res.status(404).json({ error: 'Account not found' });
  }
});

// Update ONLY own credentials
app.post('/api/credentials/:adminId', (req, res) => {
  const { adminId } = req.params;
  const { name, pass } = req.body;

  if (!name || !pass) {
    return res.status(400).json({ error: 'Name and passcode are required' });
  }

  const creds = loadJson(CREDENTIALS_FILE, {
    admin1: { id: 'admin1', name: 'user1', pass: '1234' },
    admin2: { id: 'admin2', name: 'user2', pass: '1234' }
  });

  if (!creds[adminId]) {
    return res.status(404).json({ error: 'Account not found' });
  }

  const oldName = creds[adminId].name;
  creds[adminId].name = name.trim();
  creds[adminId].pass = pass.trim();

  saveJson(CREDENTIALS_FILE, creds);

  // Check if avatar exists for broadcast
  const avatarB64Path = path.join(AVATARS_DIR, `${adminId}.txt`);
  let avatarDataUri = null;
  if (fs.existsSync(avatarB64Path)) {
    try { avatarDataUri = fs.readFileSync(avatarB64Path, 'utf8'); } catch (e) {}
  }

  // Broadcast update to all clients in real-time
  broadcast({
    type: 'profile_updated',
    adminId,
    name: creds[adminId].name,
    oldName,
    avatar: avatarDataUri
  });

  res.json({
    success: true,
    id: adminId,
    name: creds[adminId].name,
    partnerName: adminId === 'admin1' ? creds.admin2.name : creds.admin1.name
  });
});

// Pin / Unpin message endpoint
app.post('/api/messages/pin', (req, res) => {
  const { messageId, pinned } = req.body;
  const all = loadJson(MESSAGES_FILE, []);
  const msg = all.find(m => m.id === messageId);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  msg.pinned = Boolean(pinned);saveJson(MESSAGES_FILE, all);
  broadcast({ type: 'message_pinned', messageId, pinned: msg.pinned });
  res.json({ success: true, messageId, pinned: msg.pinned });
});

// Remove avatar (profile picture) from isolated container
app.delete('/api/avatar/:adminId', (req, res) => {
  const { adminId } = req.params;
  const containerFile = getAvatarContainerPath(adminId);
  if (fs.existsSync(containerFile)) {
    try { fs.unlinkSync(containerFile); } catch(e) {}
  }
  // Also clean up legacy file if present
  const legacyB64Path = path.join(AVATARS_DIR, `${adminId}.txt`);
  if (fs.existsSync(legacyB64Path)) {
    try { fs.unlinkSync(legacyB64Path); } catch(e) {}
  }
  broadcast({ type: 'avatar_updated', adminId, avatar: null, name: adminId });
  res.json({ success: true });
});

// Upload / Update avatar (profile picture) — stored as base64 text file
app.post('/api/avatar/:adminId', (req, res) => {
  const { adminId } = req.params;
  const { avatarDataUri } = req.body;

  if (!avatarDataUri || !avatarDataUri.startsWith('data:image')) {
    return res.status(400).json({ error: 'Invalid image data' });
  }

  const creds = loadJson(CREDENTIALS_FILE, {
    admin1: { id: 'admin1', name: 'user1', pass: '1234' },
    admin2: { id: 'admin2', name: 'user2', pass: '1234' }
  });
  if (!creds[adminId]) return res.status(404).json({ error: 'Account not found' });

  const containerFile = getAvatarContainerPath(adminId);
  try {
    fs.writeFileSync(containerFile, avatarDataUri, 'utf8');
  } catch (e) {
    return res.status(500).json({ error: 'Failed to save avatar in container' });
  }

  // Broadcast avatar change so all clients update immediately
  broadcast({
    type: 'avatar_updated',
    adminId,
    avatar: avatarDataUri,
    name: creds[adminId].name
  });

  res.json({ success: true, adminId });
});

// Get avatar from isolated container
app.get('/api/avatar/:adminId', (req, res) => {
  const { adminId } = req.params;
  const avatarDataUri = getAvatarDataUri(adminId);

  if (!avatarDataUri) {
    return res.status(404).json({ error: 'No avatar' });
  }

  res.json({ success: true, adminId, avatar: avatarDataUri });
});

// Messages List (Filtered by user if specified for delete-for-me)
app.get('/api/messages', (req, res) => {
  const all = getAllMessages();
  const user = req.query.user;
  if (user) {
    return res.json(all.filter(m => !m.deletedFor || !m.deletedFor.includes(user)));
  }
  res.json(all);
});

// Update Presence State
app.post('/api/presence', asyncHandler(async (req, res) => {
  const { user, online } = req.body;
  if (!user) return sendError(res, 400, 'User is required');
  const pres = loadJson(PRESENCE_FILE, {});
  pres[user] = { lastSeen: Date.now(), online: !!online };
  saveJson(PRESENCE_FILE, pres);
  broadcast({ type: 'presence_update', presence: pres });
  res.json({ success: true, presence: pres });
}));

// Send Message (Supports View Once / View Twice / Unlimited Views)
app.post('/api/messages', asyncHandler(async (req, res) => {
  const {
    id,
    sender,
    recipient,
    text,
    media,
    mediaType,
    viewMode,       // 'unlimited' | 'replay' | 'once'
    maxViews,       // 1 for once, 2 for replay, null for unlimited
    voice,
    voiceDuration,
    sticker,
    replyTo,
    tempId
  } = req.body;

  if (!sender || (!text && !media && !voice && !sticker)) {
    return sendError(res, 400, 'Invalid message payload');
  }

  const messages = loadJson(MESSAGES_FILE, []);

  // DEDUP logic...
  if (tempId) {
    const existingIdx = messages.findIndex(m => m.tempId === tempId);
    if (existingIdx !== -1) {
      const existing = messages[existingIdx];
      existing.status = 'sent';
      saveJson(MESSAGES_FILE, messages);
      broadcast({ type: 'new_message', message: existing });
      return res.json(existing);
    }
  }

  const newMessage = {
    id: id || ('msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8)),
    tempId: tempId || null,
    sender,
    recipient: recipient || '',
    text: text || '',
    media: media || null,
    mediaType: mediaType || null,
    viewMode: viewMode || 'unlimited',
    maxViews: maxViews || (viewMode === 'once' ? 1 : (viewMode === 'replay' ? 2 : null)),
    viewsCount: 0,
    mediaOpened: false,
    voice: voice || null,
    voiceDuration: voiceDuration || null,
    sticker: sticker || null,
    replyTo: replyTo || null,
    reactions: {},
    seen: false,
    seenAt: null,
    edited: false,
    editedAt: null,
    deletedFor: [],
    timestamp: Date.now()
  };

  messages.push(newMessage);
  saveJson(MESSAGES_FILE, messages);

  broadcast({
    type: 'new_message',
    message: newMessage
  });

  res.status(201).json(newMessage);
}));

// View Once / View Twice Expire Handler
app.post('/api/messages/view-media', (req, res) => {
  const { messageId, user } = req.body;
  if (!messageId || !user) return res.status(400).json({ error: 'Missing parameters' });

  const messages = loadJson(MESSAGES_FILE, []);
  const msg = messages.find(m => m.id === messageId);
  if (!msg) return res.status(404).json({ error: 'Message not found' });

  // Senders cannot view their own disappearing photos (Instagram behavior)
  if (msg.sender === user) {
    return res.status(403).json({ error: "Sender cannot view own disappearing photo" });
  }

  if (msg.viewMode && msg.viewMode !== 'unlimited') {
    if (!msg.viewsCount) msg.viewsCount = 0;
    msg.viewsCount += 1;

    if (msg.maxViews && msg.viewsCount >= msg.maxViews) {
      msg.mediaOpened = true;
    }

    saveJson(MESSAGES_FILE, messages);

    broadcast({
      type: 'media_viewed',
      messageId: msg.id,
      viewsCount: msg.viewsCount,
      mediaOpened: msg.mediaOpened
    });

    return res.json({
      success: true,
      viewsCount: msg.viewsCount,
      mediaOpened: msg.mediaOpened
    });
  }

  res.json({ success: true, viewsCount: msg.viewsCount || 0, mediaOpened: false });
});

// Edit Message
app.post('/api/messages/edit', (req, res) => {
  const { messageId, user, newText } = req.body;
  if (!messageId || !user || typeof newText !== 'string') {
    return res.status(400).json({ error: 'Invalid edit payload' });
  }

  const messages = loadJson(MESSAGES_FILE, []);
  const msg = messages.find(m => m.id === messageId);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (msg.sender !== user) return res.status(403).json({ error: 'Can only edit own messages' });

  msg.text = newText;
  msg.edited = true;
  msg.editedAt = Date.now();

  saveJson(MESSAGES_FILE, messages);
  broadcast({
    type: 'message_edited',
    messageId,
    newText,
    editedAt: msg.editedAt
  });

  res.json({ success: true, message: msg });
});

// Unsend Message
app.post('/api/messages/unsend', (req, res) => {
  const { messageId, user } = req.body;
  if (!messageId || !user) {
    return res.status(400).json({ error: 'Invalid unsend payload' });
  }

  let messages = loadJson(MESSAGES_FILE, []);
  const msg = messages.find(m => m.id === messageId);
  if (!msg) return res.status(404).json({ error: 'Message not found' });

  messages = messages.filter(m => m.id !== messageId);
  saveJson(MESSAGES_FILE, messages);

  broadcast({
    type: 'message_unsent',
    messageId,
    unsentBy: user
  });

  res.json({ success: true, messageId });
});

// Delete For Me — only marks the message as deleted for requesting user
app.post('/api/messages/delete-for-me', (req, res) => {
  const { messageId, user } = req.body;
  if (!messageId || !user) return res.status(400).json({ error: 'Missing parameters' });

  const messages = loadJson(MESSAGES_FILE, []);
  const msg = messages.find(m => m.id === messageId);
  if (!msg) return res.status(404).json({ error: 'Message not found' });

  if (!msg.deletedFor) msg.deletedFor = [];
  if (!msg.deletedFor.includes(user)) {
    msg.deletedFor.push(user);
    saveJson(MESSAGES_FILE, messages);
  }

  // Notify the requesting user's other sessions (tabs) that this was deleted for them
  broadcast({ type: 'delete_for_me', messageId, user });

  res.json({ success: true });
});

// Seen status
app.post('/api/messages/seen', (req, res) => {
  const { user } = req.body;
  if (!user) return res.status(400).json({ error: 'User is required' });

  const messages = loadJson(MESSAGES_FILE, []);
  let updatedCount = 0;
  const now = Date.now();

  messages.forEach((msg) => {
    if (msg.recipient === user && !msg.seen) {
      msg.seen = true;
      msg.seenAt = now;
      updatedCount++;
    }
  });

  if (updatedCount > 0) {
    saveJson(MESSAGES_FILE, messages);
    broadcast({
      type: 'messages_seen',
      seenBy: user,
      seenAt: now
    });
  }

  res.json({ updated: updatedCount, seenAt: now });
});

// Reactions
app.post('/api/messages/react', (req, res) => {
  const { messageId, user, reaction } = req.body;
  if (!messageId || !user) return res.status(400).json({ error: 'Invalid reaction payload' });

  const messages = loadJson(MESSAGES_FILE, []);
  const msg = messages.find(m => m.id === messageId);
  if (!msg) return res.status(404).json({ error: 'Message not found' });

  if (!msg.reactions) msg.reactions = {};
  if (msg.reactions[user] === reaction) {
    delete msg.reactions[user];
  } else {
    msg.reactions[user] = reaction || '❤️';
  }

  saveJson(MESSAGES_FILE, messages);
  broadcast({
    type: 'message_reaction',
    messageId,
    reactions: msg.reactions
  });

  res.json({ success: true, reactions: msg.reactions });
});

// Custom Stickers
app.get('/api/stickers', (req, res) => {
  res.json(loadJson(STICKERS_FILE, []));
});

app.post('/api/stickers', (req, res) => {
  const { stickerData, createdBy, stickerType } = req.body;
  if (!stickerData) return res.status(400).json({ error: 'Sticker data required' });

  const stickers = loadJson(STICKERS_FILE, []);
  const newSticker = {
    id: 'stk_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    data: stickerData,
    type: stickerType || 'image',
    createdBy: createdBy || 'Admin',
    timestamp: Date.now()
  };

  stickers.push(newSticker);
  saveJson(STICKERS_FILE, stickers);

  broadcast({
    type: 'new_sticker',
    sticker: newSticker
  });

  res.status(201).json(newSticker);
});

app.delete('/api/stickers/:id', (req, res) => {
  const stickerId = req.params.id;
  let stickers = loadJson(STICKERS_FILE, []);
  stickers = stickers.filter(s => s.id !== stickerId);
  saveJson(STICKERS_FILE, stickers);

  broadcast({
    type: 'delete_sticker',
    stickerId
  });

  res.json({ success: true, stickerId });
});

// Clear Chat
app.post('/api/messages/clear', (req, res) => {
  saveJson(MESSAGES_FILE, []);
  broadcast({ type: 'clear_chat' });
  res.json({ success: true });
});

// GIPHY & Animated Stickers Proxy / Fallback API (24 Unique High-Quality Stickers)
const CURATED_GIPHY_STICKERS = [
  { id: 'gs1', title: 'Heart love red', tags: ['love', 'heart', 'red', 'romance'], url: 'https://media.giphy.com/media/M90mJvfWfd5mbUuFUh/giphy.gif' },
  { id: 'gs2', title: 'Cute party crab', tags: ['crab', 'party', 'cute', 'birthday', 'dance'], url: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif' },
  { id: 'gs3', title: 'Good night sleep', tags: ['night', 'sleep', 'good night', 'bye', 'bed'], url: 'https://media.giphy.com/media/l4pT07K8iN0Jz2744/giphy.gif' },
  { id: 'gs4', title: 'You are enough', tags: ['quote', 'love', 'care', 'positive', 'happy'], url: 'https://media.giphy.com/media/3o7btUg31OCi0NXdkY/giphy.gif' },
  { id: 'gs5', title: 'Floating hearts pink', tags: ['heart', 'love', 'cute', 'pink', 'romance'], url: 'https://media.giphy.com/media/26FLdmIp6wJr91JAI/giphy.gif' },
  { id: 'gs6', title: 'Dance girl celebration', tags: ['dance', 'party', 'girl', 'vibe', 'happy'], url: 'https://media.giphy.com/media/blSTtZehjAZ8I/giphy.gif' },
  { id: 'gs7', title: 'Winnie pooh bear dance', tags: ['pooh', 'bear', 'dance', 'cute', 'happy'], url: 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif' },
  { id: 'gs8', title: 'Cat vibing cute', tags: ['cat', 'kitty', 'cute', 'vibing', 'dance'], url: 'https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif' },
  { id: 'gs9', title: 'Popcorn watching', tags: ['popcorn', 'movie', 'drama', 'watching'], url: 'https://media.giphy.com/media/gl0mkIZOW6Nwc/giphy.gif' },
  { id: 'gs10', title: 'Eye roll mood', tags: ['eye roll', 'whatever', 'mood', 'annoyed'], url: 'https://media.giphy.com/media/Rhhr8D5mKSXL9cXoyp/giphy.gif' },
  { id: 'gs11', title: 'Fire flame hot lit', tags: ['fire', 'flame', 'hot', 'lit'], url: 'https://media.giphy.com/media/Lopx9eUi34rbq/giphy.gif' },
  { id: 'gs12', title: 'Laughing funny LOL', tags: ['laugh', 'lol', 'funny', 'haha', 'lmao'], url: 'https://media.giphy.com/media/Q7ozWVYCR0nyW2rvPW/giphy.gif' },
  { id: 'gs13', title: 'Shocked OMG wow', tags: ['omg', 'wow', 'shocked', 'surprised'], url: 'https://media.giphy.com/media/5VKbvrjxpVJCM/giphy.gif' },
  { id: 'gs14', title: 'Clapping applause bravo', tags: ['clap', 'applause', 'bravo', 'congrats', 'cheer'], url: 'https://media.giphy.com/media/l4q8cJzGdR9J8w3hS/giphy.gif' },
  { id: 'gs15', title: 'Yes nod agree', tags: ['yes', 'nod', 'agree', 'correct'], url: 'https://media.giphy.com/media/10UeedrT5MIfPG/giphy.gif' },
  { id: 'gs16', title: 'Cry sad tears', tags: ['cry', 'sad', 'tears', 'upset', 'sorry'], url: 'https://media.giphy.com/media/d2lcHJTG5Tscg/giphy.gif' },
  { id: 'gs17', title: 'Party disco dancing', tags: ['party', 'dance', 'disco', 'fun', 'happy'], url: 'https://media.giphy.com/media/l0amJzVHIAfl7jMDos/giphy.gif' },
  { id: 'gs18', title: 'High five partner', tags: ['high five', 'team', 'congrats', 'cheers'], url: 'https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif' },
  { id: 'gs19', title: 'Sparkle star shine', tags: ['star', 'sparkle', 'magic', 'glitter'], url: 'https://media.giphy.com/media/xT9IgzoKnwFNmISR8I/giphy.gif' },
  { id: 'gs20', title: 'Mind blown boom', tags: ['mind blown', 'boom', 'shock', 'brain'], url: 'https://media.giphy.com/media/3o6Zt6KHxJTbXCnSvu/giphy.gif' },
  { id: 'gs21', title: 'Cool shades sunglasses', tags: ['cool', 'shades', 'sunglasses', 'boss'], url: 'https://media.giphy.com/media/62PP2yEIAZF6g/giphy.gif' },
  { id: 'gs22', title: 'Hug cuddle warm', tags: ['hug', 'cuddle', 'love', 'comfort', 'care'], url: 'https://media.giphy.com/media/l2QDM9Jnim1YVWLsc/giphy.gif' },
  { id: 'gs23', title: 'Kiss mwah romantic', tags: ['kiss', 'love', 'romance', 'couple'], url: 'https://media.giphy.com/media/26BRv0ThflsHCqDrG/giphy.gif' },
  { id: 'gs24', title: 'Thumbs up awesome', tags: ['thumbs up', 'yes', 'ok', 'good', 'approved'], url: 'https://media.giphy.com/media/mgqefOvJJWLp0HZ5hE/giphy.gif' }
];

app.get('/api/giphy/trending', (req, res) => {
  res.json({ data: CURATED_GIPHY_STICKERS });
});

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

app.get('/api/giphy/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ data: CURATED_GIPHY_STICKERS });

  // 1. Try Giphy Internet Search
  try {
    const giphyApiKey = 'sXpGFDGZs0Dv1mmNFvYaGUvYwKX0P4Ww';
    const type = req.query.type === 'gif' ? 'gifs' : 'stickers';
    const url = `https://api.giphy.com/v1/${type}/search?api_key=${giphyApiKey}&q=${encodeURIComponent(q)}&limit=24&rating=g`;
    
    const json = await httpsGetJson(url);
    if (json && json.data && json.data.length > 0) {
      const results = json.data.map(item => ({
        id: item.id,
        title: item.title || q,
        url: item.images?.fixed_height?.url || item.images?.fixed_width?.url || item.images?.original?.url || item.images?.downsized?.url,
        tags: [q]
      })).filter(item => Boolean(item.url));

      if (results.length > 0) {
        return res.json({ data: results });
      }
    }
  } catch (err) {
    // Giphy failed, try Tenor next
  }

  // 2. Try Tenor Internet Search as backup/alternative
  try {
    const tenorUrl = `https://g.tenor.com/v1/search?q=${encodeURIComponent(q)}&key=LIVDSRZULELA&limit=24`;
    const tenorJson = await httpsGetJson(tenorUrl);
    if (tenorJson && tenorJson.results && tenorJson.results.length > 0) {
      const tenorResults = tenorJson.results.map(item => {
        const mediaObj = item.media && item.media[0] ? item.media[0] : null;
        const gifUrl = mediaObj?.gif?.url || mediaObj?.mediumgif?.url || mediaObj?.nanogif?.url;
        return {
          id: item.id || 'tenor_' + Math.random(),
          title: item.title || q,
          url: gifUrl,
          tags: [q]
        };
      }).filter(item => Boolean(item.url));

      if (tenorResults.length > 0) {
        return res.json({ data: tenorResults });
      }
    }
  } catch (err) {
    // Tenor failed, fallback to local curated
  }

  // 3. Fallback to local curated stickers if both APIs fail
  const qLower = q.toLowerCase();
  const filtered = CURATED_GIPHY_STICKERS.filter(item => {
    return item.title.toLowerCase().includes(qLower) || item.tags.some(t => t.includes(qLower) || qLower.includes(t));
  });

  res.json({ data: filtered.length > 0 ? filtered : CURATED_GIPHY_STICKERS.slice(0, 12) });
});

// Presence & Accurate Last Seen
app.get('/api/presence', (req, res) => {
  res.json(loadJson(PRESENCE_FILE, {}));
});

app.post('/api/presence', (req, res) => {
  const { user, status } = req.body;
  if (!user) return res.status(400).json({ error: 'User required' });

  const presence = loadJson(PRESENCE_FILE, {});
  presence[user] = {
    lastSeen: Date.now(),
    online: status !== 'offline'
  };
  saveJson(PRESENCE_FILE, presence);

broadcast({
    type: 'presence_update',
    presence
  });

  res.json({ success: true, presence });
});

// WebSocket Connection handling
wss.on('connection', (ws) => {
  let currentUser = null;

  // Load avatars for init payload
  function loadAvatars() {
    const avatars = {};
    ['admin1', 'admin2'].forEach(adminId => {
      const uri = getAvatarDataUri(adminId);
      if (uri) avatars[adminId] = uri;
    });
    return avatars;
  }

  // Send current message history, presence, stickers and avatars on connection
  ws.send(JSON.stringify({
    type: 'init',
    messages: loadJson(MESSAGES_FILE, []),
    presence: loadJson(PRESENCE_FILE, {}),
    stickers: loadJson(STICKERS_FILE, []),
    avatars: loadAvatars()
  }));

  ws.on('message', (messageRaw) => {
    try {
      const data = JSON.parse(messageRaw);

      if (data.type === 'auth') {
        currentUser = data.user;
        const pres = loadJson(PRESENCE_FILE, {});
        pres[currentUser] = { lastSeen: Date.now(), online: true };
        saveJson(PRESENCE_FILE, pres);
        broadcast({ type: 'presence_update', presence: pres });
      } else if (data.type === 'typing') {
        // Exclude sender so sender NEVER receives their own typing indicator
        broadcast({
          type: 'typing',
          user: data.user,
          isTyping: !!data.isTyping
        }, ws);
      } else if (data.type === 'heartbeat' || data.type === 'presence') {
        if (data.user) {
          const pres = loadJson(PRESENCE_FILE, {});
          pres[data.user] = {
            lastSeen: data.timestamp || Date.now(),
            online: data.online !== false
          };
          saveJson(PRESENCE_FILE, pres);
          broadcast({ type: 'presence_update', presence: pres });
        }
      } else if (data.type === 'delete_for_me') {
        const messages = loadJson(MESSAGES_FILE, []);
        const msg = messages.find(m => m.id === data.messageId);
        if (msg) {
          if (!msg.deletedFor) msg.deletedFor = [];
          if (!msg.deletedFor.includes(data.user)) {
            msg.deletedFor.push(data.user);
            saveJson(MESSAGES_FILE, messages);
          }
        }
        broadcast({ type: 'delete_for_me', messageId: data.messageId, user: data.user });
      } else if (data.type === 'message_reaction') {
        const messages = loadJson(MESSAGES_FILE, []);
        const msg = messages.find(m => m.id === data.messageId);
        if (msg) {
          msg.reactions = data.reactions || {};
          saveJson(MESSAGES_FILE, messages);
        }
        broadcast({
          type: 'message_reaction',
          messageId: data.messageId,
          reactions: data.reactions || {}
        });
      } else if (data.type === 'media_viewed') {
        const messages = loadJson(MESSAGES_FILE, []);
        const msg = messages.find(m => m.id === data.messageId);
        if (msg) {
          msg.viewsCount = data.viewsCount;
          msg.mediaOpened = data.mediaOpened;
          saveJson(MESSAGES_FILE, messages);
        }
        broadcast({
          type: 'media_viewed',
          messageId: data.messageId,
          viewsCount: data.viewsCount,
          mediaOpened: data.mediaOpened
        });
      } else if (data.type === 'messages_seen') {
        const messages = loadJson(MESSAGES_FILE, []);
        let updated = false;
        messages.forEach(m => {
          if (m.recipient === data.seenBy && !m.seen) {
            m.seen = true;
            m.seenAt = data.seenAt || Date.now();
            updated = true;
          }
        });
        if (updated) saveJson(MESSAGES_FILE, messages);
        broadcast({
          type: 'messages_seen',
          seenBy: data.seenBy,
          seenAt: data.seenAt || Date.now()
        });
      } else if (data.type === 'message_edited') {
        const messages = loadJson(MESSAGES_FILE, []);
        const msg = messages.find(m => m.id === data.messageId);
        if (msg) {
          msg.text = data.newText;
          msg.edited = true;
          msg.editedAt = data.editedAt || Date.now();
          saveJson(MESSAGES_FILE, messages);
        }
        broadcast({
          type: 'message_edited',
          messageId: data.messageId,
          newText: data.newText,
          editedAt: data.editedAt || Date.now()
        });
      } else if (data.type === 'message_unsent') {
        let messages = loadJson(MESSAGES_FILE, []);
        messages = messages.filter(m => m.id !== data.messageId);
        saveJson(MESSAGES_FILE, messages);
        broadcast({
          type: 'message_unsent',
          messageId: data.messageId
        });
      }
    } catch (err) {
      console.error('WS Error:', err);
    }
  });

  ws.on('close', () => {
    if (currentUser) {
      const pres = loadJson(PRESENCE_FILE, {});
      pres[currentUser] = { lastSeen: Date.now(), online: false };
      saveJson(PRESENCE_FILE, pres);
      broadcast({ type: 'presence_update', presence: pres });
    }
  });
});

// Global Express Error Handler Middleware
app.use((err, req, res, next) => {
  console.error('Express Error:', err);
  res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(` Instagram Direct Messaging Server Running on port ${PORT}`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
