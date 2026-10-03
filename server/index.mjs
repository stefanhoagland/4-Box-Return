// 4-Box Return server: serves the built web app, stores the wall in CONFIG_DIR,
// and pushes every change to open viewers over Server-Sent Events.
//
//   PORT            port to listen on (default 8080)
//   CONFIG_DIR      where wall.json is kept (default /config)
//   STATIC_DIR      built web app (default ./public)
//   ADMIN_PASSWORD  if set, /admin and saving require this password (user name: admin)

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WallStore } from './store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const CONFIG_DIR = path.resolve(process.env.CONFIG_DIR ?? '/config');
const STATIC_DIR = path.resolve(here, process.env.STATIC_DIR ?? 'public');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
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

export function createServer(store, { password = ADMIN_PASSWORD } = {}) {
  const viewers = new Set();
  const broadcast = () => {
    const msg = `data: ${JSON.stringify(store.wall)}\n\n`;
    for (const res of viewers) res.write(msg);
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
        viewers.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
        req.on('close', () => {
          clearInterval(ping);
          viewers.delete(res);
        });
        return;
      }

      if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });

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
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const store = await new WallStore(CONFIG_DIR).load();
  createServer(store).listen(PORT, () => {
    console.log(`4-Box Return on http://0.0.0.0:${PORT} (config in ${CONFIG_DIR}${ADMIN_PASSWORD ? ', admin password on' : ''})`);
  });
}
