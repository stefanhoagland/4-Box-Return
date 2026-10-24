import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitFor } from './wait.mjs';
import { findKalturaLive, manifestFor, readKalturaSite } from '../kaltura.mjs';
import { RelayManager, relayKind, relayTimings } from '../relay.mjs';

const SITE = '<script>var cfg = {"partnerId":2167581};</script><a href="/media/t/1_abcd1234">A</a><a href="/media/t/1_live5678">B</a><a href="/media/t/1_abcd1234">A</a>';

// Answers like Kaltura's API, from a table of action name -> result.
function fakeFetch(answers) {
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    if (String(url) === 'https://watch.example.edu/') return new Response(answers.site ?? SITE);
    const action = String(url).match(/service\/(\w+)\/action\/(\w+)/);
    const key = action ? `${action[1]}.${action[2]}` : String(url);
    const v = typeof answers[key] === 'function' ? answers[key](String(url)) : answers[key];
    if (v === undefined) return new Response('not found', { status: 404 });
    return new Response(typeof v === 'string' ? v : JSON.stringify(v));
  };
  fn.calls = calls;
  return fn;
}

test('readKalturaSite finds the account and entries in a MediaSpace page', () => {
  assert.deepEqual(readKalturaSite(SITE), { partner: '2167581', entries: ['1_abcd1234', '1_live5678'] });
  assert.equal(readKalturaSite('<html>plain site</html>'), null);
});

test('relayKind follows plain web pages, which may be Kaltura sites', () => {
  assert.equal(relayKind('https://watch.liberty.edu/'), 'follow');
  assert.equal(relayKind('https://cdnapisec.kaltura.com/p/1/embedPlaykitJs/uiconf_id/2'), null);
});

test('findKalturaLive takes the live stream Kaltura lists', async () => {
  const f = fakeFetch({
    'session.startWidgetSession': { ks: 'KS' },
    'livestream.list': (u) => {
      assert.match(u, /filter%3AisLive=1/);
      return { objects: [{ id: '0_other999', name: 'Other' }, { id: '1_live5678', name: 'Convocation' }] };
    },
  });
  assert.deepEqual(await findKalturaLive('https://watch.example.edu/', f), {
    partner: '2167581', entry: '1_live5678', name: 'Convocation', manifest: manifestFor('2167581', '1_live5678'),
  });
});

test('findKalturaLive returns null when Kaltura lists nothing live', async () => {
  const f = fakeFetch({ 'session.startWidgetSession': { ks: 'KS' }, 'livestream.list': { objects: [], totalCount: 0 } });
  assert.equal(await findKalturaLive('https://watch.example.edu/', f), null);
});

test('findKalturaLive falls back to checking the page entries', async () => {
  const f = fakeFetch({
    'session.startWidgetSession': { ks: 'KS' },
    'livestream.list': { objectType: 'KalturaAPIException', code: 'SERVICE_FORBIDDEN', message: 'forbidden' },
    'baseentry.list': { objects: [{ id: '1_abcd1234', type: 1 }, { id: '1_live5678', type: 7, name: 'Chapel' }] },
    'livestream.isLive': 'true',
  });
  const live = await findKalturaLive('https://watch.example.edu/', f);
  assert.equal(live.entry, '1_live5678');
  assert.ok(!f.calls.some((u) => u.includes('isLive') && u.includes('1_abcd1234')), 'only live entries are asked');
});

test('findKalturaLive tries stream links when the API is closed', async () => {
  const live = manifestFor('2167581', '1_live5678');
  const f = fakeFetch({
    [manifestFor('2167581', '1_abcd1234')]: '#EXTM3U\n#EXTINF:6,\na.ts\n#EXT-X-ENDLIST\n',
    [live]: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nchunk.m3u8\n',
    'https://cdnapisec.kaltura.com/p/2167581/sp/216758100/playManifest/entryId/1_live5678/format/applehttp/protocol/https/chunk.m3u8': '#EXTM3U\n#EXTINF:6,\na.ts\n',
  });
  assert.equal((await findKalturaLive('https://watch.example.edu/', f)).entry, '1_live5678');
});

test('a page that is not a Kaltura site is reported as such', async () => {
  const f = fakeFetch({ site: '<html>hello</html>' });
  await assert.rejects(findKalturaLive('https://watch.example.edu/', f), (e) => e.notKaltura === true);
});

test('a site box goes from off air to the live stream and back', async (t) => {
  const saved = { ...relayTimings };
  Object.assign(relayTimings, { pageCheckMs: 100 });
  t.after(() => Object.assign(relayTimings, saved));
  const answers = [null, null, { entry: '1_live5678', name: 'Chapel', manifest: 'https://k/a.m3u8' }, { entry: '1_live5678', name: 'Chapel', manifest: 'https://k/a.m3u8' }, null];
  let i = 0;
  const statuses = [];
  const manager = new RelayManager(
    { onLevels: () => undefined, onStatus: (box, s) => statuses.push(s) },
    { ytdlp: 'yt-dlp', ffmpeg: 'ffmpeg', findSiteLive: async () => answers[Math.min(i++, answers.length - 1)] },
  );
  manager.sync({ streams: [{ id: 'k', name: 'K', url: 'https://watch.example.edu/' }], boxes: [null, null, 'k', null] });
  await waitFor(() => statuses.filter((s) => s?.state === 'offline').length >= 2, 5000);
  manager.stopAll();
  const states = statuses.map((s) => s?.state);
  assert.deepEqual(states.slice(0, 3), ['offline', 'running', 'running'], states.join(' '));
  assert.equal(statuses[1].liveUrl, 'https://k/a.m3u8');
  assert.equal(states[3], 'offline');
});
