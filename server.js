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
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const PRESENCE_FILE = path.join(DATA_DIR, 'presence.json');
const CREDENTIALS_FILE = path.join(DATA_DIR, 'credentials.json');
const STICKERS_FILE = path.join(DATA_DIR, 'stickers.json');
const AVATARS_DIR = path.join(DATA_DIR, 'avatars');

const AVATAR_CONTAINERS = {
  admin1: path.join(DATA_DIR, 'avatar_container_admin1'),
  admin2: path.join(DATA_DIR, 'avatar_container_admin2')
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

if (!fs.existsSync(MESSAGES_ADMIN1_FILE)) {
  fs.writeFileSync(MESSAGES_ADMIN1_FILE, JSON.stringify([], null, 2));
}
if (!fs.existsSync(MESSAGES_ADMIN2_FILE)) {
  fs.writeFileSync(MESSAGES_ADMIN2_FILE, JSON.stringify([], null, 2));
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

if (!fs.existsSync(CREDENTIALS_FILE)) {
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify({
    admin1: { id: 'admin1', name: 'user1', pass: '1234', partnerName: 'user2' },
    admin2: { id: 'admin2', name: 'user2', pass: '1234', partnerName: 'user1' }
  }, null, 2));
}

if (!fs.existsSync(STICKERS_FILE)) {
  fs.writeFileSync(STICKERS_FILE, JSON.stringify([], null, 2));
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
  const mAll = loadJson(MESSAGES_FILE, []);
  const map = new Map();
  [...m1, ...m2, ...mAll].forEach(m => map.set(m.id, m));
  return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function saveMessageToContainers(msg) {
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  const mAll = loadJson(MESSAGES_FILE, []);
  if (!m1.some(m => m.id === msg.id)) m1.push(msg);
  if (!m2.some(m => m.id === msg.id)) m2.push(msg);
  if (!mAll.some(m => m.id === msg.id)) mAll.push(msg);
  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  saveJson(MESSAGES_FILE, mAll);
}

function getAvatarContainerPath(adminId) {
  const containerDir = AVATAR_CONTAINERS[adminId] || path.join(DATA_DIR, `avatar_container_${adminId}`);
  if (!fs.existsSync(containerDir)) {
    fs.mkdirSync(containerDir, { recursive: true });
  }
  return path.join(containerDir, 'avatar.txt');
}

function getAvatarDataUri(adminId) {
  const containerFile = getAvatarContainerPath(adminId);
  if (fs.existsSync(containerFile)) {
    try { return fs.readFileSync(containerFile, 'utf8'); } catch (e) { return null; }
  }
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

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

app.get('/api/health', (req, res) => res.json({ status: 'ok', serverTime: Date.now() }));

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
    https.get(url, (giphyRes) => {
      let data = '';
      giphyRes.on('data', chunk => data += chunk);
      giphyRes.on('end', () => {
        try {
          res.json(JSON.parse(data));
        } catch (e) {
          res.status(500).json({ error: 'Failed to parse GIPHY response' });
        }
      });
    }).on('error', () => {
      res.status(500).json({ error: 'Failed to fetch GIFs from GIPHY' });
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch GIFs from GIPHY' });
  }
});

app.get('/api/messages', (req, res) => {
  const all = getAllMessages();
  const user = req.query.user;
  if (user) {
    return res.json(all.filter(m => !m.deletedFor || !m.deletedFor.includes(user)));
  }
  res.json(all);
});

app.post('/api/messages', (req, res) => {
  const msg = req.body;
  if (!msg || (!msg.id && !msg.tempId)) return res.status(400).json({ error: 'Invalid message' });
  if (!msg.id) msg.id = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  saveMessageToContainers(msg);
  broadcast({ type: 'new_message', message: msg });
  res.status(201).json(msg);
});

app.post('/api/auth/login', (req, res) => {
  const { passcode } = req.body;
  const creds = loadJson(CREDENTIALS_FILE, {});
  for (const [adminId, data] of Object.entries(creds)) {
    if (data.pass === passcode) {
      const partnerAdminId = adminId === 'admin1' ? 'admin2' : 'admin1';
      const partnerData = creds[partnerAdminId] || {};
      return res.json({
        success: true,
        adminId,
        name: data.name,
        partnerName: partnerData.name || 'Partner',
        avatar: getAvatarDataUri(adminId),
        partnerAvatar: getAvatarDataUri(partnerAdminId)
      });
    }
  }
  res.status(401).json({ success: false, error: 'Incorrect passcode' });
});

app.get('/api/credentials/:adminId', (req, res) => {
  const creds = loadJson(CREDENTIALS_FILE, {});
  const data = creds[req.params.adminId];
  if (data) {
    const partnerAdminId = req.params.adminId === 'admin1' ? 'admin2' : 'admin1';
    const partnerData = creds[partnerAdminId] || {};
    res.json({
      id: req.params.adminId,
      name: data.name,
      pass: data.pass,
      avatar: getAvatarDataUri(req.params.adminId),
      partnerName: partnerData.name || 'Partner'
    });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.post('/api/credentials/:adminId', (req, res) => {
  const { adminId } = req.params;
  const { name, pass } = req.body;
  const creds = loadJson(CREDENTIALS_FILE, {});
  if (creds[adminId]) {
    if (name) creds[adminId].name = name.trim();
    if (pass) creds[adminId].pass = pass.trim();
    saveJson(CREDENTIALS_FILE, creds);
    broadcast({ type: 'profile_updated', adminId, name: creds[adminId].name });
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.get('/api/avatar/:adminId', (req, res) => {
  const avatarDataUri = getAvatarDataUri(req.params.adminId);
  res.json({ avatar: avatarDataUri || null });
});

app.post('/api/avatar/:adminId', (req, res) => {
  const { adminId } = req.params;
  const { avatarDataUri } = req.body;
  const containerFile = getAvatarContainerPath(adminId);
  if (avatarDataUri) {
    fs.writeFileSync(containerFile, avatarDataUri, 'utf8');
  } else {
    if (fs.existsSync(containerFile)) fs.unlinkSync(containerFile);
  }
  const creds = loadJson(CREDENTIALS_FILE, {});
  const name = creds[adminId] ? creds[adminId].name : adminId;
  broadcast({ type: 'avatar_updated', adminId, avatar: avatarDataUri || null, name });
  res.json({ success: true });
});

app.delete('/api/avatar/:adminId', (req, res) => {
  const { adminId } = req.params;
  const containerFile = getAvatarContainerPath(adminId);
  if (fs.existsSync(containerFile)) fs.unlinkSync(containerFile);
  broadcast({ type: 'avatar_updated', adminId, avatar: null });
  res.json({ success: true });
});

app.get('/api/stickers', (req, res) => {
  res.json(loadJson(STICKERS_FILE, []));
});

app.post('/api/stickers', (req, res) => {
  const { sticker, stickerData, createdBy, stickerType } = req.body;
  const stickers = loadJson(STICKERS_FILE, []);
  const newStk = sticker || {
    id: 'stk_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    data: stickerData,
    type: stickerType || 'image',
    createdBy: createdBy || 'Admin',
    timestamp: Date.now()
  };
  if (!stickers.some(s => s.id === newStk.id)) {
    stickers.unshift(newStk);
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
  const mAll = loadJson(MESSAGES_FILE, []);
  let updatedViews = 1, isOpened = false;

  [m1, m2, mAll].forEach(list => {
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
  saveJson(MESSAGES_FILE, mAll);

  broadcast({ type: 'media_viewed', messageId, viewsCount: updatedViews, mediaOpened: isOpened });
  res.json({ success: true, viewsCount: updatedViews, mediaOpened: isOpened });
});

app.post('/api/messages/edit', (req, res) => {
  const { messageId, newText } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  const mAll = loadJson(MESSAGES_FILE, []);
  const editedAt = Date.now();

  [m1, m2, mAll].forEach(list => {
    const m = list.find(x => x.id === messageId);
    if (m) { m.text = newText; m.edited = true; m.editedAt = editedAt; }
  });

  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  saveJson(MESSAGES_FILE, mAll);

  broadcast({ type: 'message_edited', messageId, newText, editedAt });
  res.json({ success: true });
});

app.post('/api/messages/unsend', (req, res) => {
  const { messageId } = req.body;
  let m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  let m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  let mAll = loadJson(MESSAGES_FILE, []);

  m1 = m1.filter(x => x.id !== messageId);
  m2 = m2.filter(x => x.id !== messageId);
  mAll = mAll.filter(x => x.id !== messageId);

  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  saveJson(MESSAGES_FILE, mAll);

  broadcast({ type: 'message_unsent', messageId });
  res.json({ success: true });
});

app.post('/api/messages/delete-for-me', (req, res) => {
  const { messageId, user } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  const mAll = loadJson(MESSAGES_FILE, []);

  [m1, m2, mAll].forEach(list => {
    const m = list.find(x => x.id === messageId);
    if (m) {
      if (!m.deletedFor) m.deletedFor = [];
      if (!m.deletedFor.includes(user)) m.deletedFor.push(user);
    }
  });

  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  saveJson(MESSAGES_FILE, mAll);

  broadcast({ type: 'delete_for_me', messageId, user });
  res.json({ success: true });
});

app.post('/api/messages/pin', (req, res) => {
  const { messageId, pinned } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  const mAll = loadJson(MESSAGES_FILE, []);

  [m1, m2, mAll].forEach(list => {
    const m = list.find(x => x.id === messageId);
    if (m) m.pinned = Boolean(pinned);
  });

  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  saveJson(MESSAGES_FILE, mAll);

  broadcast({ type: 'message_pinned', messageId, pinned: Boolean(pinned) });
  res.json({ success: true, messageId, pinned: Boolean(pinned) });
});

app.post('/api/messages/react', (req, res) => {
  const { messageId, user, reaction } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  const mAll = loadJson(MESSAGES_FILE, []);
  let updatedReactions = {};

  [m1, m2, mAll].forEach(list => {
    const m = list.find(x => x.id === messageId);
    if (m) {
      if (!m.reactions) m.reactions = {};
      if (m.reactions[user] === reaction) {
        delete m.reactions[user];
      } else {
        m.reactions[user] = reaction || '❤️';
      }
      updatedReactions = m.reactions;
    }
  });

  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  saveJson(MESSAGES_FILE, mAll);

  broadcast({ type: 'message_reaction', messageId, reactions: updatedReactions });
  res.json({ success: true, reactions: updatedReactions });
});

app.post('/api/messages/seen', (req, res) => {
  const { user } = req.body;
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  const mAll = loadJson(MESSAGES_FILE, []);
  const now = Date.now();

  [m1, m2, mAll].forEach(list => {
    list.forEach(m => {
      if (m.recipient === user && !m.seen) {
        m.seen = true;
        m.seenAt = now;
      }
    });
  });

  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  saveJson(MESSAGES_FILE, mAll);

  broadcast({ type: 'messages_seen', seenBy: user, seenAt: now });
  res.json({ success: true, seenAt: now });
});

app.post('/api/messages/clear', (req, res) => {
  saveJson(MESSAGES_ADMIN1_FILE, []);
  saveJson(MESSAGES_ADMIN2_FILE, []);
  saveJson(MESSAGES_FILE, []);
  broadcast({ type: 'clear_chat' });
  res.json({ success: true });
});

app.post('/api/presence', (req, res) => {
  const { user, online } = req.body;
  if (!user) return res.status(400).json({ error: 'User required' });
  const presence = loadJson(PRESENCE_FILE, {});
  presence[user] = { lastSeen: Date.now(), online: !!online };
  saveJson(PRESENCE_FILE, presence);
  broadcast({ type: 'presence_update', presence });
  res.json({ success: true, presence });
});

function broadcast(data, excludeWs = null) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
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
        broadcast(data, ws);
      }
    } catch (e) {}
  });

  const avatars = {};
  ['admin1', 'admin2'].forEach(id => {
    const avatarData = getAvatarDataUri(id);
    if (avatarData) {
      avatars[id] = avatarData;
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
  console.log(`Server running successfully on port ${PORT}`);
});
