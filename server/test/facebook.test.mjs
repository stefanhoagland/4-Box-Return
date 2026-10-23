import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { facebookPageLive, videoFromPage, ytdlpLiveVideo } from '../facebook.mjs';
import { RelayManager, relayTimings } from '../relay.mjs';

test('facebookPageLive spots page links and leaves video links alone', () => {
  assert.equal(facebookPageLive('https://www.facebook.com/libertyuniversity'), 'https://www.facebook.com/libertyuniversity/live');
  assert.equal(facebookPageLive('facebook.com/libertyuniversity/'), 'https://www.facebook.com/libertyuniversity/live');
  assert.equal(facebookPageLive('https://m.facebook.com/NASA/live'), 'https://www.facebook.com/NASA/live');
  assert.equal(facebookPageLive('https://www.facebook.com/NASA/videos'), 'https://www.facebook.com/NASA/live');
  assert.equal(facebookPageLive('https://www.facebook.com/NASA/live_videos/'), 'https://www.facebook.com/NASA/live');
  assert.equal(facebookPageLive('https://www.facebook.com/profile.php?id=100064'), 'https://www.facebook.com/100064/live');
  assert.equal(facebookPageLive('https://www.facebook.com/NASA/videos/1234567890/'), null);
  assert.equal(facebookPageLive('https://www.facebook.com/watch/?v=1234567890'), null);
  assert.equal(facebookPageLive('https://www.facebook.com/watch/live/?v=1234567890'), null);
  assert.equal(facebookPageLive('https://www.facebook.com/reel/1234567890'), null);
  assert.equal(facebookPageLive('https://www.facebook.com/share/v/abc/'), null);
  assert.equal(facebookPageLive('https://fb.watch/abc123/'), null);
  assert.equal(facebookPageLive('https://www.youtube.com/@NASA'), null);
});

test('videoFromPage finds the live video in what Facebook serves', () => {
  const page = 'https://www.facebook.com/NASA/live';
  assert.equal(videoFromPage('https://www.facebook.com/NASA/videos/987654321/', '', page), 'https://www.facebook.com/NASA/videos/987654321/');
  assert.equal(videoFromPage('https://www.facebook.com/watch/live/?v=987654321', '', page), 'https://www.facebook.com/NASA/videos/987654321/');
  assert.equal(
    videoFromPage(page, '<meta property="og:url" content="https://www.facebook.com/NASA/videos/555666777/" />', page),
    'https://www.facebook.com/NASA/videos/555666777/',
  );
  assert.equal(videoFromPage(page, '{"is_live_streaming":true,"video_id":"123456789"}', page), 'https://www.facebook.com/NASA/videos/123456789/');
  assert.equal(videoFromPage(page, '<html>log in</html>', page), null);
});

test('ytdlpLiveVideo only accepts a stream that is live now', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fbr-fb-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const live = path.join(dir, 'live');
  const past = path.join(dir, 'past');
  await writeFile(live, '#!/bin/sh\necho "is_live https://www.facebook.com/NASA/videos/42424242/"\n');
  await writeFile(past, '#!/bin/sh\necho "was_live https://www.facebook.com/NASA/videos/42424242/"\n');
  await chmod(live, 0o755);
  await chmod(past, 0o755);
  assert.equal(await ytdlpLiveVideo('https://www.facebook.com/NASA/live', live), 'https://www.facebook.com/NASA/videos/42424242/');
  assert.equal(await ytdlpLiveVideo('https://www.facebook.com/NASA/live', past), null);
  assert.equal(await ytdlpLiveVideo('https://www.facebook.com/NASA/live', path.join(dir, 'missing')), null);
});

test('a page box shows off air until the page goes live, then pulls the live video', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fbr-page-'));
  const saved = { ...relayTimings };
  Object.assign(relayTimings, { pageCheckMs: 300 });
  t.after(async () => {
    Object.assign(relayTimings, saved);
    await rm(dir, { recursive: true, force: true });
  });
  // Stands in for yt-dlp: records which link it was given, then plays audio.
  const fake = path.join(dir, 'fake-ytdlp');
  const seen = path.join(dir, 'seen');
  await writeFile(
    fake,
    `#!/bin/sh\nfor a; do last="$a"; done\necho "$last" > "${seen}"\nexec ffmpeg -hide_banner -loglevel error -f lavfi -i "sine=f=440:d=3" -ac 2 -f matroska -\n`,
  );
  await chmod(fake, 0o755);

  let checks = 0;
  const video = 'https://www.facebook.com/NASA/videos/42424242/';
  const statuses = [];
  const manager = new RelayManager(
    { onLevels: () => undefined, onStatus: (box, s) => s && statuses.push(s) },
    { ytdlp: fake, ffmpeg: 'ffmpeg', findLive: async (page) => (++checks >= 3 && page === 'https://www.facebook.com/NASA/live' ? video : null) },
  );
  manager.sync({ streams: [{ id: 'a', name: 'FB page', url: 'https://www.facebook.com/NASA' }], boxes: ['a', null, null, null] });
  await new Promise((r) => setTimeout(r, 2500));
  manager.stopAll();

  const states = statuses.map((s) => s.state);
  assert.equal(states.filter((s) => s === 'offline').length, 1, `off air once, no flicker: ${states}`);
  assert.equal(statuses.find((s) => s.state === 'offline').message, 'Page is not live');
  const running = statuses.find((s) => s.state === 'running');
  assert.ok(running, `went live: ${states}`);
  assert.equal(running.liveUrl, video);
  const { readFile } = await import('node:fs/promises');
  assert.equal((await readFile(seen, 'utf8')).trim(), video);
});
