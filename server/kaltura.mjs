// Follows a Kaltura MediaSpace site (such as watch.liberty.edu): every minute the
// server reads the site, asks Kaltura which of its streams is live, and hands
// viewers that stream's HLS link. Viewers show the Kaltura slate when nothing is live.

const API = 'https://cdnapisec.kaltura.com/api_v3';
const ENTRY_ID = /\b[01]_[a-z0-9]{8}\b/gi;
const LIVE_STREAM_TYPE = 7; // KalturaEntryType.LIVE_STREAM

export function manifestFor(partner, entry) {
  return `https://cdnapisec.kaltura.com/p/${partner}/sp/${partner}00/playManifest/entryId/${entry}/format/applehttp/protocol/https/a.m3u8`;
}

// The Kaltura account and the entry IDs named in a MediaSpace page, or null if
// the page is not a Kaltura site.
export function readKalturaSite(html) {
  const partner = html.match(/partner_?id["']?\s*[:=]\s*["']?(\d{3,})/i)?.[1];
  if (!partner) return null;
  const entries = [...new Set(html.match(ENTRY_ID) ?? [])];
  return { partner, entries };
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Kaltura answered ${res.status}`);
  return res.json();
}

async function api(service, action, params, fetchImpl) {
  const q = new URLSearchParams({ format: '1', ...params });
  const out = await getJson(`${API}/service/${service}/action/${action}?${q}`, fetchImpl);
  if (out && out.objectType === 'KalturaAPIException') throw new Error(out.message || out.code);
  return out;
}

// A live HLS stream has no end marker in its media playlist; a recording does.
// Null when Kaltura could not be reached at all.
async function manifestIsLive(url, fetchImpl) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return false;
    let text = await res.text();
    if (!text.startsWith('#EXTM3U')) return false;
    const variant = text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    if (variant && text.includes('#EXT-X-STREAM-INF')) {
      const v = await fetchImpl(new URL(variant, res.url || url).toString(), { signal: AbortSignal.timeout(10_000) });
      if (!v.ok) return false;
      text = await v.text();
    }
    return text.includes('#EXTINF') && !text.includes('#EXT-X-ENDLIST');
  } catch {
    return null;
  }
}

// Which entry of the site is live now: { partner, entry, name, manifest } or
// null. Throws { notKaltura: true } when the page is not a Kaltura site.
export async function findKalturaLive(siteUrl, fetchImpl = fetch) {
  const res = await fetchImpl(siteUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${new URL(siteUrl).hostname} answered ${res.status}`);
  const site = readKalturaSite(await res.text());
  if (!site) throw Object.assign(new Error('No Kaltura player on this page'), { notKaltura: true });
  const { partner, entries } = site;
  const found = (entry, name = '') => ({ partner, entry, name, manifest: manifestFor(partner, entry) });

  // Kaltura's player API, with the same anonymous session the site's own player uses.
  let ks = null;
  try {
    ks = (await api('session', 'startWidgetSession', { widgetId: `_${partner}` }, fetchImpl)).ks;
  } catch (err) {
    console.warn(`Kaltura ${partner}: no player session (${err.message})`);
  }
  if (ks) {
    try {
      const list = await api('livestream', 'list', {
        ks,
        'filter:objectType': 'KalturaLiveStreamEntryFilter',
        'filter:isLive': '1',
        'pager:pageSize': '50',
      }, fetchImpl);
      const live = list.objects ?? [];
      const pick = live.find((e) => entries.includes(e.id)) ?? live[0];
      if (pick) return found(pick.id, pick.name);
      if (Array.isArray(list.objects)) return null; // Kaltura answered: nothing live
    } catch (err) {
      console.warn(`Kaltura ${partner}: could not list live streams (${err.message}); checking the site's entries`);
    }
    try {
      const list = await api('baseentry', 'list', {
        ks,
        'filter:idIn': entries.join(','),
        'pager:pageSize': '100',
      }, fetchImpl);
      for (const e of (list.objects ?? []).filter((o) => Number(o.type) === LIVE_STREAM_TYPE)) {
        const live = await api('livestream', 'isLive', { ks, id: e.id, protocol: 'applehttp' }, fetchImpl).catch(() => false);
        if (live === true) return found(e.id, e.name);
      }
      return null;
    } catch (err) {
      console.warn(`Kaltura ${partner}: could not read entries (${err.message}); checking stream links`);
    }
  }

  // Last resort: try each entry's stream link.
  let reached = false;
  for (const entry of entries) {
    const live = await manifestIsLive(manifestFor(partner, entry), fetchImpl);
    if (live) return found(entry);
    if (live === false) reached = true;
  }
  if (!reached && entries.length) throw new Error('Could not reach Kaltura');
  return null;
}
