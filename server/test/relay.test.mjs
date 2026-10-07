import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { RelayManager, blockLevels, kalturaManifest, relayKind, relayTimings, ytdlpArgs, ytdlpUrl } from '../relay.mjs';

test('relayKind picks which links the server has to pull', () => {
  assert.equal(relayKind('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'meter');
  assert.equal(relayKind('youtu.be/dQw4w9WgXcQ'), 'meter');
  assert.equal(relayKind('https://www.facebook.com/NASA/videos/123/'), 'meter');
  assert.equal(relayKind('https://x.com/i/broadcasts/1ZkJzbdvLgRJv'), 'play');
  assert.equal(relayKind('https://twitter.com/i/broadcasts/1ZkJzbdvLgRJv'), 'play');
  assert.equal(relayKind('https://example.com/live.m3u8'), null);
  assert.equal(relayKind('kaltura:1/2/3'), 'meter');
  assert.equal(relayKind('kaltura:not-a-shorthand'), null);
  assert.equal(relayKind('not a link'), null);
});

test('blockLevels reads each channel peak in dBFS', () => {
  const buf = Buffer.alloc(8);
  buf.writeInt16LE(16384, 0); // left, half scale
  buf.writeInt16LE(-3277, 2); // right, a tenth
  buf.writeInt16LE(100, 4);
  buf.writeInt16LE(0, 6);
  const [l, r] = blockLevels(buf);
  assert.ok(Math.abs(l - -6) < 0.1, `left ${l}`);
  assert.ok(Math.abs(r - -20) < 0.1, `right ${r}`);
  assert.deepEqual(blockLevels(Buffer.alloc(8)), [-60, -60]);
});

test('the stream link always comes after --, so it cannot be read as an option', () => {
  const args = ytdlpArgs('--exec=rm -rf /', 'meter');
  assert.equal(args.at(-2), '--');
  assert.equal(args.at(-1), '--exec=rm -rf /');
});

test('YouTube channel links are pulled from their /live page', () => {
  const id = 'UC1234567890abcdefghij_-';
  assert.equal(ytdlpUrl(`https://www.youtube.com/channel/${id}`), `https://www.youtube.com/channel/${id}/live`);
  assert.equal(ytdlpUrl(`https://www.youtube.com/channel/${id}/live`), `https://www.youtube.com/channel/${id}/live`);
  assert.equal(ytdlpUrl('https://www.youtube.com/@NASA/streams'), 'https://www.youtube.com/@NASA/live');
  assert.equal(ytdlpUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(ytdlpUrl('https://x.com/i/broadcasts/1'), 'https://x.com/i/broadcasts/1');
});

test('Kaltura player links are metered from the entry HLS', () => {
  const hls = 'https://cdnapisec.kaltura.com/p/123/sp/12300/playManifest/entryId/1_abc/format/applehttp/protocol/https/a.m3u8';
  assert.equal(kalturaManifest('kaltura:123/456/1_abc'), hls);
  assert.equal(kalturaManifest('https://cdnapisec.kaltura.com/p/123/embedPlaykitJs/uiconf_id/456?iframeembed=true&entry_id=1_abc'), hls);
  assert.equal(kalturaManifest('https://cdnapisec.kaltura.com/p/123/sp/12300/embedIframeJs/uiconf_id/456/partner_id/123?iframeembed=true&entryId=1_abc'), hls);
  assert.equal(kalturaManifest('https://cdnapisec.kaltura.com/p/123/embedPlaykitJs/uiconf_id/456'), null);
  assert.equal(kalturaManifest('https://example.com/p/123?entry_id=1_abc'), null);
  assert.equal(relayKind('kaltura:123/456/1_abc'), 'meter');
  assert.equal(relayKind('https://cdnapisec.kaltura.com/p/123/embedPlaykitJs/uiconf_id/456?iframeembed=true&entry_id=1_abc'), 'meter');
  assert.equal(relayKind(hls), null); // the browser plays Kaltura HLS itself
  assert.equal(ytdlpUrl('kaltura:123/456/1_abc'), hls);
});

test('a relay pipes the stream through ffmpeg and reports live levels', async (t) => {
  // Stands in for yt-dlp: writes a few seconds of loud-left, quiet-right audio to stdout.
  const dir = await mkdtemp(path.join(tmpdir(), 'fbr-relay-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fake = path.join(dir, 'fake-ytdlp');
  await writeFile(
    fake,
    '#!/bin/sh\nexec ffmpeg -hide_banner -loglevel error -f lavfi -i "sine=f=440:d=4,volume=6dB" -f lavfi -i "sine=f=880:d=4,volume=-12dB" ' +
      '-filter_complex "[0:a][1:a]amerge=inputs=2" -ac 2 -f matroska -\n',
  );
  await chmod(fake, 0o755);

  const levels = [];
  const statuses = [];
  const manager = new RelayManager(
    { onLevels: (box, v) => v && levels.push([box, v]), onStatus: (box, s) => s && statuses.push(s.state) },
    { ytdlp: fake, ffmpeg: 'ffmpeg' },
  );
  manager.sync({
    streams: [{ id: 'a', name: 'YT', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }],
    boxes: [null, 'a', null, null],
  });
  await new Promise((r) => setTimeout(r, 2500));
  manager.stopAll();

  assert.ok(statuses.includes('running'), `statuses: ${statuses}`);
  assert.ok(levels.length >= 10, `only ${levels.length} readings`);
  const [box, [l, r]] = levels.at(-1);
  assert.equal(box, 1);
  assert.ok(l > -15 && l < -9, `left ${l}`); // sine at 1/8 scale +6 dB ≈ -12 dBFS
  assert.ok(r > -33 && r < -27, `right ${r}`); // -12 dB ≈ -30 dBFS
});

test('a relay that goes quiet is restarted, and a quick reconnect after a good run is hidden', async (t) => {
  // Stands in for yt-dlp: 1.5 s of audio, then hangs without exiting.
  const dir = await mkdtemp(path.join(tmpdir(), 'fbr-stall-'));
  const saved = { ...relayTimings };
  Object.assign(relayTimings, { stallMs: 800, firstAudioMs: 5000, healthyRunMs: 1000, holdMs: 4000, watchdogMs: 200 });
  t.after(async () => {
    Object.assign(relayTimings, saved);
    await rm(dir, { recursive: true, force: true });
  });
  const fake = path.join(dir, 'fake-ytdlp');
  await writeFile(
    fake,
    '#!/bin/sh\nffmpeg -hide_banner -loglevel error -f lavfi -i "sine=f=440:d=1.5" -ac 2 -f matroska -\nexec sleep 30\n',
  );
  await chmod(fake, 0o755);

  const events = [];
  const manager = new RelayManager(
    {
      onLevels: (box, v) => events.push(v ? 'level' : 'null'),
      onStatus: (box, s) => events.push(s ? s.state : 'cleared'),
    },
    { ytdlp: fake, ffmpeg: 'ffmpeg' },
  );
  manager.sync({ streams: [{ id: 'a', name: 'FB', url: 'https://www.facebook.com/x/videos/1/' }], boxes: ['a', null, null, null] });
  await new Promise((r) => setTimeout(r, 5000));
  manager.stopAll();

  const starts = events.filter((e) => e === 'starting').length;
  const runs = events.filter((e) => e === 'running').length;
  assert.equal(starts, 1, `the reconnect is not announced: ${events.join(' ')}`);
  assert.ok(runs >= 2, `it came back after the stall: ${events.join(' ')}`);
  assert.ok(!events.includes('error') && !events.includes('null'), `viewers saw no drop: ${events.join(' ')}`);
});
