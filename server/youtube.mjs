// Turns YouTube @handle links (youtube.com/@name, /@name/live, …) into channel
// links (youtube.com/channel/UC…/live). YouTube only embeds a channel's live
// stream by channel ID, so the viewer cannot play @handle links directly.

import { execFile } from 'node:child_process';

const CHANNEL_ID = /^UC[\w-]{22}$/;
const RETRY_MS = 5 * 60_000;

// The @handle in a YouTube link, or null if it is not one.
export function youtubeHandle(raw) {
  let u;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const h = u.hostname.replace(/^(www|m|mobile)\./, '').toLowerCase();
  if (h !== 'youtube.com') return null;
  const first = u.pathname.split('/').filter(Boolean)[0] ?? '';
  return /^@[\w.-]{1,100}$/.test(first) ? decodeURIComponent(first) : null;
}

// Finds the channel ID in a YouTube channel page.
export function channelIdFromPage(html) {
  const patterns = [
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/,
    /"externalId":"(UC[\w-]{22})"/,
    /"channelId":"(UC[\w-]{22})"/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && CHANNEL_ID.test(m[1])) return m[1];
  }
  return null;
}

export async function fetchChannelId(handle) {
  const res = await fetch(`https://www.youtube.com/${encodeURIComponent(handle).replace('%40', '@')}`, {
    headers: {
      'Accept-Language': 'en-US,en;q=0.9',
      // Skips the cookie consent page YouTube shows in some regions.
      Cookie: 'CONSENT=YES+1; SOCS=CAI',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`YouTube answered ${res.status} for ${handle}`);
  return channelIdFromPage(await res.text());
}

// Backup lookup through yt-dlp, which keeps up with YouTube page changes.
export function ytdlpChannelId(handle, ytdlp = process.env.YTDLP_BIN || 'yt-dlp') {
  return new Promise((resolve, reject) => {
    execFile(
      ytdlp,
      ['--quiet', '--no-warnings', '--flat-playlist', '-I', '1', '--print', 'channel_id', '--', `https://www.youtube.com/${handle}/videos`],
      { timeout: 30_000 },
      (err, stdout) => {
        const id = String(stdout).trim().split('\n')[0];
        if (CHANNEL_ID.test(id)) resolve(id);
        else reject(err ?? new Error(`yt-dlp found no channel for ${handle}`));
      },
    );
  });
}

async function lookupChannelId(handle) {
  try {
    const id = await fetchChannelId(handle);
    if (id) return id;
  } catch {
    // Fall through to yt-dlp.
  }
  return ytdlpChannelId(handle);
}

// Rewrites the @handle links in a wall to channel links. A handle that cannot be
// looked up is left as it was, so a save never fails because YouTube is down.
export function createHandleResolver(lookup = lookupChannelId) {
  const cache = new Map();
  const failedAt = new Map(); // a handle that failed is not retried for a while, so saves stay quick
  return async function resolveHandles(wall) {
    if (!wall || !Array.isArray(wall.streams)) return wall;
    const streams = await Promise.all(
      wall.streams.map(async (s) => {
        const handle = s && typeof s.url === 'string' ? youtubeHandle(s.url) : null;
        if (!handle) return s;
        const key = handle.toLowerCase();
        if (!cache.has(key) && Date.now() - (failedAt.get(key) ?? 0) > RETRY_MS) {
          try {
            const id = await lookup(handle);
            if (id) cache.set(key, id);
            else failedAt.set(key, Date.now());
          } catch (err) {
            failedAt.set(key, Date.now());
            console.warn(`Could not look up YouTube channel ${handle}: ${err.message}`);
          }
        }
        const id = cache.get(key);
        return id ? { ...s, url: `https://www.youtube.com/channel/${id}/live` } : s;
      }),
    );
    return { ...wall, streams };
  };
}
