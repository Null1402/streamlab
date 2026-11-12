'use strict';

require('dotenv').config();
const http    = require('node:http');
const fs      = require('node:fs');
const path    = require('node:path');
const crypto  = require('node:crypto');
const express = require('express');
const { Server: SocketIO } = require('socket.io');
const bcrypt  = require('bcryptjs');
const db      = require('./db');

// ── Constantes ────────────────────────────────────────────────────────────────
const PORT       = process.env.PORT        || 3000;
const RTMP_PORT  = process.env.RTMP_PORT   || 1935;
const FFMPEG     = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';
const MEDIA      = path.join(__dirname, 'media');
const PUBLIC_HOST = process.env.PUBLIC_HOST || '';
const CATEGORIES = ['Videojuegos', 'Programación', 'Educación', 'Música', 'Charlas', 'Arte'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function genStreamKey() {
  return 'sk_' + crypto.randomBytes(12).toString('hex');
}

function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

function listVods(username) {
  const dir = path.join(MEDIA, 'live', username);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.mp4'))
    .map(f => {
      const full = path.join(dir, f);
      const { size, mtimeMs } = fs.statSync(full);
      return { file: f, size_mb: +(size / 1048576).toFixed(2), mtime: mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ file, size_mb }) => ({ file, size_mb }));
}

function decorate(u, req) {
  const username = u.username;

  // viewers: tamaño de sala socket (puede ser 0 antes de que arranque io)
  const room = `ch:${username}`;
  const viewers = (req.io && req.io.sockets.adapter.rooms.get(room)?.size) || 0;

  // followers
  const { followers } = db.prepare(
    'SELECT COUNT(*) AS followers FROM follows WHERE channel_id = ?'
  ).get(u.id);

  // thumb
  const thumbPath = path.join(MEDIA, 'live', username, 'thumb.jpg');
  const thumb = fs.existsSync(thumbPath)
    ? `/media/live/${username}/thumb.jpg`
    : null;

  return { ...u, viewers, followers, thumb };
}

// ── App ───────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Adjuntar io al request para usarlo en decorate y rutas
app.use((req, _res, next) => { req.io = app.get('io'); next(); });

// ── Middleware de sesión ──────────────────────────────────────────────────────
app.use((req, _res, next) => {
  const token = req.headers.cookie
    ?.split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('sl_token='))
    ?.slice('sl_token='.length);

  if (token) {
    const row = db.prepare(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'
    ).get(token);
    if (row) req.user = row;
  }
  next();
});

function auth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' });
  next();
}

// ── Estáticos ─────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// Es un archivo (no una carpeta): <script src="/vendor/hls.js"> debe devolver el JS
app.get('/vendor/hls.js', (_req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', 'hls.js', 'dist', 'hls.min.js'));
});

app.use('/media', (req, res, next) => {
  if (req.path.endsWith('.m3u8')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
  }
  next();
}, express.static(MEDIA));

// ── Ruta web ──────────────────────────────────────────────────────────────────
app.get('/c/:username', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'channel.html'));
});

// ── API: register ─────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string')
    return res.status(400).json({ error: 'Datos incompletos' });
  if (!username || !/^[a-z0-9_]{3,20}$/.test(username))
    return res.status(400).json({ error: 'Nombre de usuario inválido (3-20 chars, a-z 0-9 _)' });
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'El nombre de usuario ya existe' });

  const password_hash = await bcrypt.hash(password, 10);
  const stream_key    = genStreamKey();

  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO users (username, password_hash, stream_key) VALUES (?, ?, ?)'
  ).run(username, password_hash, stream_key);

  const token = genToken();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, id);

  res.cookie('sl_token', token, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  });
  res.status(201).json({ ok: true, username });
});

// ── API: login ────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string')
    return res.status(400).json({ error: 'Datos incompletos' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas' });

  const token = genToken();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);

  res.cookie('sl_token', token, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  });
  res.json({ ok: true, username: user.username });
});

// ── API: logout ───────────────────────────────────────────────────────────────
app.post('/api/logout', auth, (req, res) => {
  const token = req.headers.cookie
    ?.split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('sl_token='))
    ?.slice('sl_token='.length);

  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie('sl_token');
  res.json({ ok: true });
});

// ── API: me ───────────────────────────────────────────────────────────────────
app.get('/api/me', auth, (req, res) => {
  const { password_hash: _, stream_key: __, ...pub } = req.user;
  res.json(pub);
});

// ── API: categories ───────────────────────────────────────────────────────────
app.get('/api/categories', (_req, res) => {
  const rows = db.prepare(
    `SELECT category, COUNT(*) AS live_count
     FROM users WHERE is_live = 1
     GROUP BY category`
  ).all();
  const liveMap = Object.fromEntries(rows.map(r => [r.category, r.live_count]));
  res.json(CATEGORIES.map(name => ({ name, live: liveMap[name] || 0 })));
});

// ── API: channels (lista) ─────────────────────────────────────────────────────
app.get('/api/channels', (req, res) => {
  const { category, live } = req.query;
  let sql = 'SELECT * FROM users WHERE 1=1';
  const params = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (live === '1') { sql += ' AND is_live = 1'; }
  sql += ' ORDER BY is_live DESC, username ASC';

  const users = db.prepare(sql).all(...params).map(u => {
    const { password_hash: _, stream_key: __, ...pub } = u;
    return decorate(pub, req);
  });
  res.json(users);
});

// ── API: channels/:username ───────────────────────────────────────────────────
app.get('/api/channels/:username', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!user) return res.status(404).json({ error: 'Canal no encontrado' });

  const { password_hash: _, stream_key: __, ...pub } = user;
  const decorated = decorate(pub, req);

  // ¿el usuario autenticado sigue este canal?
  let following = false;
  if (req.user) {
    following = !!db.prepare(
      'SELECT 1 FROM follows WHERE follower_id = ? AND channel_id = ?'
    ).get(req.user.id, user.id);
  }

  const hls = `/media/live/${user.username}/index.m3u8`;
  const vods = listVods(user.username);

  res.json({ ...decorated, following, hls, vods });
});

// ── API: follow toggle ────────────────────────────────────────────────────────
app.post('/api/channels/:username/follow', auth, (req, res) => {
  const channel = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!channel) return res.status(404).json({ error: 'Canal no encontrado' });
  if (channel.id === req.user.id) return res.status(400).json({ error: 'No puedes seguirte a ti mismo' });

  const existing = db.prepare(
    'SELECT 1 FROM follows WHERE follower_id = ? AND channel_id = ?'
  ).get(req.user.id, channel.id);

  if (existing) {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND channel_id = ?')
      .run(req.user.id, channel.id);
    res.json({ following: false });
  } else {
    db.prepare('INSERT INTO follows (follower_id, channel_id) VALUES (?, ?)')
      .run(req.user.id, channel.id);
    res.json({ following: true });
  }
});

// ── API: following ────────────────────────────────────────────────────────────
app.get('/api/following', auth, (req, res) => {
  const rows = db.prepare(
    `SELECT u.* FROM follows f
     JOIN users u ON u.id = f.channel_id
     WHERE f.follower_id = ?
     ORDER BY u.is_live DESC, u.username ASC`
  ).all(req.user.id);

  const result = rows.map(u => {
    const { password_hash: _, stream_key: __, ...pub } = u;
    return decorate(pub, req);
  });
  res.json(result);
});

// ── API: dashboard GET ────────────────────────────────────────────────────────
app.get('/api/dashboard', auth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const hostname = PUBLIC_HOST || req.hostname;
  const rtmp_url = `rtmp://${hostname}:${RTMP_PORT}/live`;
  res.json({
    username:   user.username,
    stream_key: user.stream_key,
    obs_key:    `${user.username}?key=${user.stream_key}`,
    title:      user.title,
    category:   user.category,
    bio:        user.bio,
    is_live:    user.is_live,
    rtmp_url,
    stream_url: `${rtmp_url}  →  clave: ${user.username}?key=${user.stream_key}`
  });
});

// ── API: dashboard PUT ────────────────────────────────────────────────────────
app.put('/api/dashboard', auth, (req, res) => {
  const { title = '', category = '', bio = '' } = req.body || {};
  if (category && !CATEGORIES.includes(category))
    return res.status(400).json({ error: 'Categoría inválida' });

  db.prepare('UPDATE users SET title = ?, category = ?, bio = ? WHERE id = ?')
    .run(title.slice(0, 120), category, bio.slice(0, 300), req.user.id);

  // Emitir actualización a espectadores del canal
  const io = app.get('io');
  if (io) io.to(`ch:${req.user.username}`).emit('channel:update', { title, category });

  res.json({ ok: true });
});

// ── API: regenerate-key ───────────────────────────────────────────────────────
app.post('/api/dashboard/regenerate-key', auth, (req, res) => {
  const stream_key = genStreamKey();
  db.prepare('UPDATE users SET stream_key = ? WHERE id = ?').run(stream_key, req.user.id);
  res.json({ stream_key, obs_key: `${req.user.username}?key=${stream_key}` });
});

// ── API: health ───────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(app);

module.exports = { app, server, MEDIA, FFMPEG, RTMP_PORT, PUBLIC_HOST, CATEGORIES, genStreamKey };

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = new SocketIO(server);
app.set('io', io);

// Color estable por usuario (hash simple del username)
function userColor(username) {
  let h = 0;
  for (const c of username) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue},70%,65%)`;
}

// Parsea la cookie sl_token del handshake
function tokenFromHandshake(socket) {
  const raw = socket.handshake.headers.cookie || '';
  return raw.split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('sl_token='))
    ?.slice('sl_token='.length) || null;
}

io.on('connection', socket => {
  // Identificar usuario por sesión
  const token = tokenFromHandshake(socket);
  let socketUser = null;
  if (token) {
    socketUser = db.prepare(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'
    ).get(token) || null;
  }

  let currentRoom = null;
  const lastMsg = new Map(); // socket-level anti-spam

  socket.on('join', channel => {
    if (typeof channel !== 'string') return;
    const room = `ch:${channel.toLowerCase()}`;
    if (currentRoom) socket.leave(currentRoom);
    socket.join(room);
    currentRoom = room;

    // Emitir viewers actualizados a toda la sala
    const size = io.sockets.adapter.rooms.get(room)?.size || 0;
    io.to(room).emit('viewers', { n: size });
  });

  socket.on('chat', text => {
    if (!socketUser) {
      socket.emit('chat:error', { texto: 'Debes iniciar sesión para chatear' });
      return;
    }
    if (!currentRoom) return;
    if (typeof text !== 'string') return;

    const trimmed = text.trim().slice(0, 300);
    if (!trimmed) return;

    // Anti-spam: 1 mensaje cada 700 ms
    const now = Date.now();
    const last = lastMsg.get(socketUser.id) || 0;
    if (now - last < 700) {
      socket.emit('chat:error', { texto: 'Estás escribiendo demasiado rápido' });
      return;
    }
    lastMsg.set(socketUser.id, now);

    io.to(currentRoom).emit('chat', {
      user:  socketUser.username,
      text:  trimmed,
      color: userColor(socketUser.username),
      at:    new Date().toISOString()
    });
  });

  socket.on('disconnect', () => {
    if (currentRoom) {
      // Esperar un tick para que el socket salga de la sala antes de contar
      setImmediate(() => {
        const size = io.sockets.adapter.rooms.get(currentRoom)?.size || 0;
        io.to(currentRoom).emit('viewers', { n: size });
      });
    }
  });
});

// ── node-media-server ─────────────────────────────────────────────────────────
const NodeMediaServer = require('node-media-server');

const RECORD_VOD = process.env.RECORD_VOD !== 'false';

// ffmpeg recibe las rutas de salida dentro del muxer "tee", que trata la barra
// invertida como carácter de escape. En Windows hay que darle barras normales.
const MEDIA_FFMPEG = MEDIA.replace(/\\/g, '/');

const nmsConfig = {
  // 2 = normal (por defecto) · 3 = depuración · 4 = incluye la salida de ffmpeg
  logType: Number(process.env.NMS_LOG_TYPE ?? 2),
  rtmp: {
    port: Number(RTMP_PORT),
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60
  },
  http: {
    port: 8000,
    host: '127.0.0.1',
    mediaroot: MEDIA_FFMPEG,
    allow_origin: '*'
  },
  trans: {
    ffmpeg: FFMPEG,
    tasks: [
      // HLS
      {
        app: 'live',
        hls: true,
        hlsFlags: '[hls_time=2:hls_list_size=4:hls_flags=delete_segments]',
        hlsKeepSegments: 4,
        dash: false
      },
      // VOD MP4
      ...(RECORD_VOD ? [{
        app: 'live',
        mp4: true,
        mp4Flags: '[movflags=frag_keyframe+empty_moov]'
      }] : [])
    ]
  }
};

const nms = new NodeMediaServer(nmsConfig);

// Intervalos de miniatura activos por username
const thumbIntervals = new Map();

function startThumb(username) {
  if (thumbIntervals.has(username)) return;
  const streamPath = path.join(MEDIA, 'live', username);
  const thumbOut   = path.join(streamPath, 'thumb.jpg');
  fs.mkdirSync(streamPath, { recursive: true });

  const interval = setInterval(() => {
    const m3u8 = path.join(streamPath, 'index.m3u8');
    if (!fs.existsSync(m3u8)) return;
    const { spawnSync } = require('node:child_process');
    spawnSync(FFMPEG, [
      '-y', '-i', m3u8,
      '-frames:v', '1',
      '-q:v', '5',
      thumbOut
    ], { timeout: 10000 });
  }, 30_000);

  thumbIntervals.set(username, interval);
}

function stopThumb(username) {
  const iv = thumbIntervals.get(username);
  if (iv) { clearInterval(iv); thumbIntervals.delete(username); }
}

// prePublish: validar usuario + stream_key
nms.on('prePublish', (id, StreamPath, args) => {
  // StreamPath: /live/USUARIO
  const username = StreamPath.split('/').pop();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !args.key || args.key !== user.stream_key) {
    const session = nms.getSession(id);
    if (session) session.reject();
    return;
  }
});

// postPublish: is_live=1, emitir, miniatura
nms.on('postPublish', (_id, StreamPath, _args) => {
  const username = StreamPath.split('/').pop();
  db.prepare('UPDATE users SET is_live = 1 WHERE username = ?').run(username);
  io.emit('live', { username, live: true });
  startThumb(username);
});

// donePublish: is_live=0, emitir, detener miniatura
nms.on('donePublish', (_id, StreamPath, _args) => {
  const username = StreamPath.split('/').pop();
  db.prepare('UPDATE users SET is_live = 0 WHERE username = ?').run(username);
  io.emit('live', { username, live: false });
  stopThumb(username);
});

// ── Arranque ──────────────────────────────────────────────────────────────────
db.exec('UPDATE users SET is_live = 0');
nms.run();
server.listen(PORT, () => {
  console.log(`StreamLab escuchando en http://localhost:${PORT}`);
  console.log(`RTMP en rtmp://localhost:${RTMP_PORT}/live`);
});

