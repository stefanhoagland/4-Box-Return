import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createServer } from '../index.mjs';
import { WallStore } from '../store.mjs';
import { channelIdFromPage, createHandleResolver, youtubeHandle } from '../youtube.mjs';

const ID = 'UC1234567890abcdefghij_-';

test('youtubeHandle spots @handle links only', () => {
  assert.equal(youtubeHandle('https://www.youtube.com/@libertyuniversity'), '@libertyuniversity');
  assert.equal(youtubeHandle('youtube.com/@NASA/live'), '@NASA');
  assert.equal(youtubeHandle('https://m.youtube.com/@some.name-1/streams'), '@some.name-1');
  assert.equal(youtubeHandle('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(youtubeHandle(`https://www.youtube.com/channel/${ID}`), null);
  assert.equal(youtubeHandle('https://example.com/@someone'), null);
});

test('channelIdFromPage reads the canonical channel link', () => {
  const html = `<html><link rel="canonical" href="https://www.youtube.com/channel/${ID}"><script>"channelId":"UCxxxxxxxxxxxxxxxxxxxxxx"</script>`;
  assert.equal(channelIdFromPage(html), ID);
  assert.equal(channelIdFromPage(`{"externalId":"${ID}"}`), ID);
  assert.equal(channelIdFromPage('<html>nothing here</html>'), null);
});

test('the resolver swaps handles for channel live links and caches lookups', async () => {
  let calls = 0;
  const resolve = createHandleResolver(async (h) => {
    calls++;
    return h === '@good' ? ID : null;
  });
  const wall = {
    streams: [
      { id: 'a', name: 'A', url: 'https://www.youtube.com/@good' },
      { id: 'b', name: 'B', url: 'https://www.youtube.com/@missing' },
      { id: 'c', name: 'C', url: 'https://youtu.be/dQw4w9WgXcQ' },
    ],
  };
  const out = await resolve(wall);
  assert.equal(out.streams[0].url, `https://www.youtube.com/channel/${ID}/live`);
  assert.equal(out.streams[1].url, 'https://www.youtube.com/@missing');
  assert.equal(out.streams[2].url, 'https://youtu.be/dQw4w9WgXcQ');
  await resolve(wall);
  assert.equal(calls, 2); // @good cached, @missing not retried straight away
});

test('a lookup that throws leaves the link as it was', async () => {
  const resolve = createHandleResolver(async () => {
    throw new Error('offline');
  });
  const out = await resolve({ streams: [{ id: 'a', name: 'A', url: 'https://www.youtube.com/@x' }] });
  assert.equal(out.streams[0].url, 'https://www.youtube.com/@x');
});

test('saving the wall stores the channel link in place of the handle', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fbr-yt-'));
  const store = await new WallStore(dir).load();
  const server = createServer(store, { password: '', resolveUrls: createHandleResolver(async () => ID) });
  await new Promise((r) => server.listen(0, r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/wall`, {
    method: 'PUT',
    body: JSON.stringify({ streams: [{ id: 's', name: 'LU', url: 'https://www.youtube.com/@libertyuniversity' }], boxes: ['s'] }),
  });
  const saved = await res.json();
  assert.equal(saved.streams[0].url, `https://www.youtube.com/channel/${ID}/live`);
});
