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
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const MESSAGES_ADMIN1_FILE = path.join(DATA_DIR, 'messages_admin1.json');
const MESSAGES_ADMIN2_FILE = path.join(DATA_DIR, 'messages_admin2.json');
const PRESENCE_FILE = path.join(DATA_DIR, 'presence.json');
const CREDENTIALS_FILE = path.join(DATA_DIR, 'credentials.json');
const STICKERS_FILE = path.join(DATA_DIR, 'stickers.json');
const AVATARS_DIR = path.join(DATA_DIR, 'avatars');

// Separate isolated storage containers for each user's profile picture
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
if (!fs.existsSync(MESSAGES_ADMIN1_FILE)) {
  fs.writeFileSync(MESSAGES_ADMIN1_FILE, JSON.stringify([], null, 2));
}
if (!fs.existsSync(MESSAGES_ADMIN2_FILE)) {
  fs.writeFileSync(MESSAGES_ADMIN2_FILE, JSON.stringify([], null, 2));
}

if (!fs.existsSync(PRESENCE_FILE)) {
  fs.writeFileSync(PRESENCE_FILE, JSON.stringify({
    user1: { lastSeen: Date.now(), online: false },
    user2: { lastSeen: Date.now(), online: false }
  }, null, 2));
}

if (!fs.existsSync(CREDENTIALS_FILE)) {
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify({
    admin1: { id: 'admin1', name: 'Ankur', pass: 'Ankur', partnerName: 'Aanya' },
    admin2: { id: 'admin2', name: 'Aanya', pass: 'Aanya', partnerName: 'Ankur' }
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

function getAllMessages() {
  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  const main = loadJson(MESSAGES_FILE, []);
  const map = new Map();
  [...main, ...m1, ...m2].forEach(m => {
    if (m && m.id) map.set(m.id, m);
  });
  return Array.from(map.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

function saveMessageToContainers(msg) {
  const messages = loadJson(MESSAGES_FILE, []);
  if (!messages.some(m => m.id === msg.id)) {
    messages.push(msg);
  }
  saveJson(MESSAGES_FILE, messages);

  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  if (!m1.some(m => m.id === msg.id)) m1.push(msg);
  if (!m2.some(m => m.id === msg.id)) m2.push(msg);
  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
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

  res.status(401).json({ success: false, error: 'Invalid passcode' });
});

// Get credentials
app.get('/api/credentials/:adminId', (req, res) => {
  const { adminId } = req.params;
  const creds = loadJson(CREDENTIALS_FILE, {});
  const data = creds[adminId];

  if (data) {
    const partnerAdminId = adminId === 'admin1' ? 'admin2' : 'admin1';
    const partnerData = creds[partnerAdminId] || {};
    res.json({
      id: adminId,
      name: data.name,
      pass: data.pass,
      avatar: getAvatarDataUri(adminId),
      partnerName: partnerData.name || 'Partner'
    });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Update credentials
app.post('/api/credentials/:adminId', (req, res) => {
  const { adminId } = req.params;
  const { name, pass } = req.body;
  const creds = loadJson(CREDENTIALS_FILE, {});

  if (creds[adminId]) {
    const oldName = creds[adminId].name;
    if (name) creds[adminId].name = name.trim();
    if (pass) creds[adminId].pass = pass.trim();
    saveJson(CREDENTIALS_FILE, creds);

    const partnerAdminId = adminId === 'admin1' ? 'admin2' : 'admin1';
    const partnerData = creds[partnerAdminId] || {};

    broadcast({
      type: 'profile_updated',
      adminId,
      name: creds[adminId].name,
      oldName,
      avatar: getAvatarDataUri(adminId)
    });

    res.json({
      success: true,
      id: adminId,
      name: creds[adminId].name,
      partnerName: partnerData.name || 'Partner'
    });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Avatar Endpoints
app.get('/api/avatar/:adminId', (req, res) => {
  const { adminId } = req.params;
  const avatarDataUri = getAvatarDataUri(adminId);
  res.json({ success: true, adminId, avatar: avatarDataUri || null });
});

app.post('/api/avatar/:adminId', (req, res) => {
  const { adminId } = req.params;
  const { avatarDataUri } = req.body;
  const containerFile = getAvatarContainerPath(adminId);

  if (avatarDataUri) {
    try {
      fs.writeFileSync(containerFile, avatarDataUri, 'utf8');
    } catch (e) {
      return res.status(500).json({ error: 'Failed to save avatar' });
    }
  } else {
    if (fs.existsSync(containerFile)) fs.unlinkSync(containerFile);
  }

  const creds = loadJson(CREDENTIALS_FILE, {});
  const userName = creds[adminId]?.name || adminId;

  broadcast({
    type: 'avatar_updated',
    adminId,
    avatar: avatarDataUri || null,
    name: userName
  });

  res.json({ success: true, adminId });
});

app.delete('/api/avatar/:adminId', (req, res) => {
  const { adminId } = req.params;
  const containerFile = getAvatarContainerPath(adminId);
  if (fs.existsSync(containerFile)) {
    try { fs.unlinkSync(containerFile); } catch (e) {}
  }
  const legacyB64Path = path.join(AVATARS_DIR, `${adminId}.txt`);
  if (fs.existsSync(legacyB64Path)) {
    try { fs.unlinkSync(legacyB64Path); } catch (e) {}
  }
  broadcast({ type: 'avatar_updated', adminId, avatar: null, name: adminId });
  res.json({ success: true });
});

// Messages API
app.get('/api/messages', (req, res) => {
  const all = getAllMessages();
  const user = req.query.user;
  if (user) {
    return res.json(all.filter(m => !m.deletedFor || !m.deletedFor.includes(user)));
  }
  res.json(all);
});

app.post('/api/messages', asyncHandler(async (req, res) => {
  const msg = req.body;
  if (!msg || (!msg.id && !msg.tempId) || (!msg.text && !msg.media && !msg.voice && !msg.sticker && !msg.sender)) {
    return res.status(400).json({ error: 'Invalid message payload' });
  }

  if (msg.tempId) {
    const messages = getAllMessages();
    const existing = messages.find(m => m.tempId === msg.tempId);
    if (existing) {
      existing.status = 'sent';
      return res.json(existing);
    }
  }

  const newMessage = {
    id: msg.id || ('msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8)),
    tempId: msg.tempId || null,
    sender: msg.sender,
    recipient: msg.recipient || '',
    text: msg.text || '',
    media: msg.media || null,
    mediaType: msg.mediaType || null,
    viewMode: msg.viewMode || 'unlimited',
    maxViews: msg.maxViews || (msg.viewMode === 'once' ? 1 : (msg.viewMode === 'replay' ? 2 : null)),
    viewsCount: msg.viewsCount || 0,
    mediaOpened: msg.mediaOpened || false,
    voice: msg.voice || null,
    voiceDuration: msg.voiceDuration || null,
    sticker: msg.sticker || null,
    replyTo: msg.replyTo || null,
    reactions: msg.reactions || {},
    pinned: Boolean(msg.pinned),
    seen: Boolean(msg.seen),
    seenAt: msg.seenAt || null,
    edited: Boolean(msg.edited),
    editedAt: msg.editedAt || null,
    deletedFor: msg.deletedFor || [],
    timestamp: msg.timestamp || Date.now()
  };

  saveMessageToContainers(newMessage);
  broadcast({ type: 'new_message', message: newMessage });
  res.status(201).json(newMessage);
}));

// View Once / Media Viewed Handler
app.post('/api/messages/view-media', (req, res) => {
  const { messageId, user } = req.body;
  if (!messageId) return res.status(400).json({ error: 'Missing messageId' });

  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  const main = loadJson(MESSAGES_FILE, []);
  let updatedViews = 1, isOpened = false;

  [m1, m2, main].forEach(list => {
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
  saveJson(MESSAGES_FILE, main);

  broadcast({ type: 'media_viewed', messageId, viewsCount: updatedViews, mediaOpened: isOpened });
  res.json({ success: true, viewsCount: updatedViews, mediaOpened: isOpened });
});

// Edit Message
app.post('/api/messages/edit', (req, res) => {
  const { messageId, newText } = req.body;
  if (!messageId || typeof newText !== 'string') {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  const main = loadJson(MESSAGES_FILE, []);
  const editedAt = Date.now();

  [m1, m2, main].forEach(list => {
    const m = list.find(x => x.id === messageId);
    if (m) {
      m.text = newText;
      m.edited = true;
      m.editedAt = editedAt;
    }
  });

  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  saveJson(MESSAGES_FILE, main);

  broadcast({ type: 'message_edited', messageId, newText, editedAt });
  res.json({ success: true });
});

// Unsend Message
app.post('/api/messages/unsend', (req, res) => {
  const { messageId } = req.body;
  if (!messageId) return res.status(400).json({ error: 'Missing messageId' });

  let m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  let m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  let main = loadJson(MESSAGES_FILE, []);

  m1 = m1.filter(x => x.id !== messageId);
  m2 = m2.filter(x => x.id !== messageId);
  main = main.filter(x => x.id !== messageId);

  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  saveJson(MESSAGES_FILE, main);

  broadcast({ type: 'message_unsent', messageId });
  res.json({ success: true });
});

// Delete For Me
app.post('/api/messages/delete-for-me', (req, res) => {
  const { messageId, user } = req.body;
  if (!messageId || !user) return res.status(400).json({ error: 'Missing parameters' });

  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  const main = loadJson(MESSAGES_FILE, []);

  [m1, m2, main].forEach(list => {
    const m = list.find(x => x.id === messageId);
    if (m) {
      if (!m.deletedFor) m.deletedFor = [];
      if (!m.deletedFor.includes(user)) m.deletedFor.push(user);
    }
  });

  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  saveJson(MESSAGES_FILE, main);

  broadcast({ type: 'delete_for_me', messageId, user });
  res.json({ success: true });
});

// Pin Message
app.post('/api/messages/pin', (req, res) => {
  const { messageId, pinned } = req.body;
  if (!messageId) return res.status(400).json({ error: 'Missing messageId' });

  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  const main = loadJson(MESSAGES_FILE, []);

  [m1, m2, main].forEach(list => {
    const m = list.find(x => x.id === messageId);
    if (m) m.pinned = Boolean(pinned);
  });

  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  saveJson(MESSAGES_FILE, main);

  broadcast({ type: 'message_pinned', messageId, pinned: Boolean(pinned) });
  res.json({ success: true });
});

// Reactions
app.post('/api/messages/react', (req, res) => {
  const { messageId, user, reaction } = req.body;
  if (!messageId || !user) return res.status(400).json({ error: 'Missing parameters' });

  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  const main = loadJson(MESSAGES_FILE, []);
  let updatedReactions = {};

  [m1, m2, main].forEach(list => {
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
  saveJson(MESSAGES_FILE, main);

  broadcast({ type: 'message_reaction', messageId, reactions: updatedReactions });
  res.json({ success: true, reactions: updatedReactions });
});

// Seen Status
app.post('/api/messages/seen', (req, res) => {
  const { user } = req.body;
  if (!user) return res.status(400).json({ error: 'User required' });

  const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
  const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
  const main = loadJson(MESSAGES_FILE, []);
  const now = Date.now();

  [m1, m2, main].forEach(list => {
    list.forEach(m => {
      if (m.recipient === user && !m.seen) {
        m.seen = true;
        m.seenAt = now;
      }
    });
  });

  saveJson(MESSAGES_ADMIN1_FILE, m1);
  saveJson(MESSAGES_ADMIN2_FILE, m2);
  saveJson(MESSAGES_FILE, main);

  broadcast({ type: 'messages_seen', seenBy: user, seenAt: now });
  res.json({ success: true });
});

// Clear Chat
app.post('/api/messages/clear', (req, res) => {
  saveJson(MESSAGES_ADMIN1_FILE, []);
  saveJson(MESSAGES_ADMIN2_FILE, []);
  saveJson(MESSAGES_FILE, []);
  broadcast({ type: 'clear_chat' });
  res.json({ success: true });
});

// Stickers API
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

// Presence API
app.get('/api/presence', (req, res) => {
  res.json(loadJson(PRESENCE_FILE, {}));
});

app.post('/api/presence', asyncHandler(async (req, res) => {
  const { user, online, status } = req.body;
  if (!user) return sendError(res, 400, 'User is required');
  const presence = loadJson(PRESENCE_FILE, {});
  const isOnline = online !== undefined ? Boolean(online) : status !== 'offline';
  presence[user] = { lastSeen: Date.now(), online: isOnline };
  saveJson(PRESENCE_FILE, presence);
  broadcast({ type: 'presence_update', presence });
  res.json({ success: true, presence });
}));

// GIPHY & Animated Stickers Proxy / Fallback API
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
  } catch (err) {}

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
  } catch (err) {}

  const qLower = q.toLowerCase();
  const filtered = CURATED_GIPHY_STICKERS.filter(item => {
    return item.title.toLowerCase().includes(qLower) || item.tags.some(t => t.includes(qLower) || qLower.includes(t));
  });

  res.json({ data: filtered.length > 0 ? filtered : CURATED_GIPHY_STICKERS.slice(0, 12) });
});

// WebSocket Connection handling
wss.on('connection', (ws) => {
  let currentUser = null;

  function loadAvatars() {
    const avatars = {};
    ['admin1', 'admin2'].forEach(adminId => {
      const uri = getAvatarDataUri(adminId);
      if (uri) avatars[adminId] = uri;
    });
    return avatars;
  }

  ws.send(JSON.stringify({
    type: 'init',
    messages: getAllMessages(),
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
        const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
        const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
        const main = loadJson(MESSAGES_FILE, []);
        [m1, m2, main].forEach(list => {
          const msg = list.find(m => m.id === data.messageId);
          if (msg) {
            if (!msg.deletedFor) msg.deletedFor = [];
            if (!msg.deletedFor.includes(data.user)) msg.deletedFor.push(data.user);
          }
        });
        saveJson(MESSAGES_ADMIN1_FILE, m1);
        saveJson(MESSAGES_ADMIN2_FILE, m2);
        saveJson(MESSAGES_FILE, main);
        broadcast({ type: 'delete_for_me', messageId: data.messageId, user: data.user });
      } else if (data.type === 'message_reaction') {
        const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
        const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
        const main = loadJson(MESSAGES_FILE, []);
        [m1, m2, main].forEach(list => {
          const msg = list.find(m => m.id === data.messageId);
          if (msg) msg.reactions = data.reactions || {};
        });
        saveJson(MESSAGES_ADMIN1_FILE, m1);
        saveJson(MESSAGES_ADMIN2_FILE, m2);
        saveJson(MESSAGES_FILE, main);
        broadcast({
          type: 'message_reaction',
          messageId: data.messageId,
          reactions: data.reactions || {}
        });
      } else if (data.type === 'media_viewed') {
        const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
        const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
        const main = loadJson(MESSAGES_FILE, []);
        [m1, m2, main].forEach(list => {
          const msg = list.find(m => m.id === data.messageId);
          if (msg) {
            msg.viewsCount = data.viewsCount;
            msg.mediaOpened = data.mediaOpened;
          }
        });
        saveJson(MESSAGES_ADMIN1_FILE, m1);
        saveJson(MESSAGES_ADMIN2_FILE, m2);
        saveJson(MESSAGES_FILE, main);
        broadcast({
          type: 'media_viewed',
          messageId: data.messageId,
          viewsCount: data.viewsCount,
          mediaOpened: data.mediaOpened
        });
      } else if (data.type === 'messages_seen') {
        const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
        const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
        const main = loadJson(MESSAGES_FILE, []);
        [m1, m2, main].forEach(list => {
          list.forEach(m => {
            if (m.recipient === data.seenBy && !m.seen) {
              m.seen = true;
              m.seenAt = data.seenAt || Date.now();
            }
          });
        });
        saveJson(MESSAGES_ADMIN1_FILE, m1);
        saveJson(MESSAGES_ADMIN2_FILE, m2);
        saveJson(MESSAGES_FILE, main);
        broadcast({
          type: 'messages_seen',
          seenBy: data.seenBy,
          seenAt: data.seenAt || Date.now()
        });
      } else if (data.type === 'message_edited') {
        const m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
        const m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
        const main = loadJson(MESSAGES_FILE, []);
        [m1, m2, main].forEach(list => {
          const msg = list.find(m => m.id === data.messageId);
          if (msg) {
            msg.text = data.newText;
            msg.edited = true;
            msg.editedAt = data.editedAt || Date.now();
          }
        });
        saveJson(MESSAGES_ADMIN1_FILE, m1);
        saveJson(MESSAGES_ADMIN2_FILE, m2);
        saveJson(MESSAGES_FILE, main);
        broadcast({
          type: 'message_edited',
          messageId: data.messageId,
          newText: data.newText,
          editedAt: data.editedAt || Date.now()
        });
      } else if (data.type === 'message_unsent') {
        let m1 = loadJson(MESSAGES_ADMIN1_FILE, []);
        let m2 = loadJson(MESSAGES_ADMIN2_FILE, []);
        let main = loadJson(MESSAGES_FILE, []);
        m1 = m1.filter(m => m.id !== data.messageId);
        m2 = m2.filter(m => m.id !== data.messageId);
        main = main.filter(m => m.id !== data.messageId);
        saveJson(MESSAGES_ADMIN1_FILE, m1);
        saveJson(MESSAGES_ADMIN2_FILE, m2);
        saveJson(MESSAGES_FILE, main);
        broadcast({
          type: 'message_unsent',
          messageId: data.messageId
        });
      } else {
        broadcast(data, ws);
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
  console.log(` Server Running Smoothly on port ${PORT}`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
