import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from '../index.mjs';
import { WallStore, validateWall } from '../store.mjs';

test('validateWall drops bad streams and box ids that are not in the library', () => {
  const wall = validateWall({
    title: '  Sunday service ',
    streams: [{ id: 'a', name: 'Main', url: 'https://youtu.be/dQw4w9WgXcQ' }, { name: 'no url' }, 'junk'],
    boxes: ['a', 'missing', 7],
  });
  assert.equal(wall.title, 'Sunday service');
  assert.deepEqual(wall.streams, [{ id: 'a', name: 'Main', url: 'https://youtu.be/dQw4w9WgXcQ' }]);
  assert.deepEqual(wall.boxes, ['a', null, null, null]);
});

test('validateWall names a stream after its URL when the name is blank', () => {
  const wall = validateWall({ streams: [{ url: 'https://example.com/a.m3u8' }] });
  assert.equal(wall.streams[0].name, 'https://example.com/a.m3u8');
  assert.ok(wall.streams[0].id);
});

let dir, server, base;
const auth = (pw) => ({ Authorization: `Basic ${Buffer.from(`admin:${pw}`).toString('base64')}` });

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'fbr-'));
  const store = await new WallStore(dir).load();
  server = createServer(store, { password: 'secret' });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  for (const res of server.viewers) res.end();
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

test('anyone can read the wall; saving needs the admin password', async () => {
  const empty = await (await fetch(`${base}/api/wall`)).json();
  assert.deepEqual(empty.boxes, [null, null, null, null]);

  const body = JSON.stringify({ streams: [{ id: 's1', name: 'Main', url: 'https://youtu.be/dQw4w9WgXcQ' }], boxes: ['s1'] });
  assert.equal((await fetch(`${base}/api/wall`, { method: 'PUT', body })).status, 401);
  assert.equal((await fetch(`${base}/api/wall`, { method: 'PUT', body, headers: auth('wrong') })).status, 401);

  const ok = await fetch(`${base}/api/wall`, { method: 'PUT', body, headers: auth('secret') });
  assert.equal(ok.status, 200);
  const saved = JSON.parse(await readFile(path.join(dir, 'wall.json'), 'utf8'));
  assert.deepEqual(saved.boxes, ['s1', null, null, null]);
});

test('the admin page asks for a password', async () => {
  assert.equal((await fetch(`${base}/admin`)).status, 401);
});

test('viewers get the current wall and every saved change over SSE', async () => {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/events`, { signal: controller.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const nextWall = async () => {
    let buf = '';
    for (;;) {
      const { value } = await reader.read();
      buf += decoder.decode(value);
      const m = buf.match(/data: (.*)\n\n/);
      if (m) return JSON.parse(m[1]);
    }
  };
  await nextWall();
  await fetch(`${base}/api/wall`, {
    method: 'PUT',
    headers: auth('secret'),
    body: JSON.stringify({ title: 'Live now', streams: [], boxes: [] }),
  });
  assert.equal((await nextWall()).title, 'Live now');
  controller.abort();
});

test('rejects invalid JSON and path traversal', async () => {
  assert.equal((await fetch(`${base}/api/wall`, { method: 'PUT', body: '{', headers: auth('secret') })).status, 400);
  const res = await fetch(`${base}/..%2f..%2fetc%2fpasswd`);
  assert.notEqual(await res.text(), await readFile('/etc/passwd', 'utf8'));
});
