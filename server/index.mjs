// 4-Box Return server: serves the built web app, stores the wall in CONFIG_DIR,
// and pushes every change to open viewers over Server-Sent Events.
//
//   CONFIG_DIR      where wall.json is kept (default /config)
//   STATIC_DIR      built web app (default ./public)
//   ADMIN_PASSWORD  if set, /admin and saving require this password (user name: admin)
//   RELAY           set to "off" to stop the server pulling YouTube/Facebook/X streams
//   YTDLP_BIN, FFMPEG_BIN  paths to yt-dlp and ffmpeg (default: found on PATH)

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RELAY_DIR, RelayManager } from './relay.mjs';
import { WallStore } from './store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// Always 8080 inside the container; pick the outside port in the Docker/Unraid port mapping.
const PORT = 8080;
const CONFIG_DIR = path.resolve(process.env.CONFIG_DIR ?? '/config');
const STATIC_DIR = path.resolve(here, process.env.STATIC_DIR ?? 'public');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
const RELAY_ON = (process.env.RELAY ?? 'on').toLowerCase() !== 'off';
const MAX_BODY = 1_000_000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
};

export function isAdmin(req, password = ADMIN_PASSWORD) {
  if (!password) return true;
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Basic ')) return false;
  const given = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const sep = given.indexOf(':');
  const pass = Buffer.from(sep === -1 ? '' : given.slice(sep + 1));
  const want = Buffer.from(password);
  return pass.length === want.length && timingSafeEqual(pass, want);
}

function askForLogin(res) {
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="4-Box Return admin"', 'Content-Type': 'text/plain' });
  res.end('Admin password required\n');
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveStatic(req, res, pathname) {
  const decoded = decodeURIComponent(pathname);
  let file = path.join(STATIC_DIR, path.normalize(decoded));
  if (file !== STATIC_DIR && !file.startsWith(STATIC_DIR + path.sep)) return sendJson(res, 400, { error: 'Bad path' });
  let info = await stat(file).catch(() => null);
  if (!info || info.isDirectory()) {
    // Client-side routes (/, /admin) all load the app shell.
    file = path.join(STATIC_DIR, 'index.html');
    info = await stat(file).catch(() => null);
    if (!info) return sendJson(res, 404, { error: 'Web app not built' });
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': decoded.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

async function serveRelayFile(res, box, name) {
  if (!/^\d+$/.test(box) || !/^[\w.-]+$/.test(name)) return sendJson(res, 400, { error: 'Bad path' });
  const file = path.join(RELAY_DIR, box, name);
  const info = await stat(file).catch(() => null);
  if (!info) return sendJson(res, 404, { error: 'Not found' });
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(name)] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': 'no-store',
  });
  createReadStream(file).pipe(res);
}

export function createServer(store, { password = ADMIN_PASSWORD, relays = null } = {}) {
  const viewers = new Set();
  const send = (event, data) => {
    const msg = `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
    for (const res of viewers) res.write(msg);
  };
  const broadcast = () => send(null, store.wall);

  // Relay readings arrive ten times a second per box; send them in one batch.
  let levels = {};
  let levelsDirty = false;
  const levelTimer = setInterval(() => {
    if (!levelsDirty) return;
    levelsDirty = false;
    send('levels', levels);
  }, 100);
  levelTimer.unref();
  const relayEvents = {
    onLevels(box, value) {
      levels = { ...levels, [box]: value };
      levelsDirty = true;
    },
    onStatus(box, status) {
      send('relay', { box, status });
    },
  };

  const server = http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url ?? '/', 'http://localhost');

      if (pathname === '/healthz') return sendJson(res, 200, { ok: true });

      if (pathname === '/api/wall' && req.method === 'GET') return sendJson(res, 200, store.wall);

      if (pathname === '/api/wall' && req.method === 'PUT') {
        if (!isAdmin(req, password)) return askForLogin(res);
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return sendJson(res, 400, { error: 'Invalid JSON' });
        }
        try {
          const wall = await store.save(body);
          broadcast();
          server.relays?.sync(wall);
          return sendJson(res, 200, wall);
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }

      if (pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(`retry: 3000\ndata: ${JSON.stringify(store.wall)}\n\n`);
        for (const [box, status] of Object.entries(server.relays?.statuses() ?? {})) {
          res.write(`event: relay\ndata: ${JSON.stringify({ box: Number(box), status })}\n\n`);
        }
        viewers.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
        req.on('close', () => {
          clearInterval(ping);
          viewers.delete(res);
        });
        return;
      }

      if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });

      const relayFile = pathname.match(/^\/relay\/([^/]+)\/([^/]+)$/);
      if (relayFile) return await serveRelayFile(res, relayFile[1], relayFile[2]);

      if ((pathname === '/admin' || pathname.startsWith('/admin/')) && !isAdmin(req, password)) {
        return askForLogin(res);
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
      return await serveStatic(req, res, pathname);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Server error' });
      else res.end();
    }
  });
  server.viewers = viewers;
  server.relayEvents = relayEvents;
  server.relays = relays ? relays(relayEvents) : null;
  server.relays?.sync(store.wall);
  server.on('close', () => {
    clearInterval(levelTimer);
    server.relays?.stopAll();
  });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const store = await new WallStore(CONFIG_DIR).load();
  const tools = { ytdlp: process.env.YTDLP_BIN || 'yt-dlp', ffmpeg: process.env.FFMPEG_BIN || 'ffmpeg' };
  const relays = RELAY_ON ? (events) => new RelayManager(events, tools) : null;
  createServer(store, { relays }).listen(PORT, () => {
    console.log(
      `4-Box Return on http://0.0.0.0:${PORT} (config in ${CONFIG_DIR}` +
        `${ADMIN_PASSWORD ? ', admin password on' : ''}${RELAY_ON ? ', relay on' : ', relay off'})`,
    );
  });
}
