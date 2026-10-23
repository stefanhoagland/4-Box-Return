// Facebook page links (facebook.com/<page>, /<page>/live, /<page>/videos,
// profile.php?id=…) have no fixed video to embed. The server checks whether the
// page is live and hands the viewer the current live video's link.

import { execFile } from 'node:child_process';

// Page paths that are Facebook's own sections, not pages.
const NOT_PAGES = new Set([
  'watch', 'video.php', 'videos', 'reel', 'reels', 'events', 'groups', 'story.php', 'permalink.php',
  'photo.php', 'photo', 'photos', 'plugins', 'share', 'live', 'gaming', 'hashtag', 'login', 'login.php',
  'marketplace', 'people', 'search', 'pages', 'help', 'policies', 'stories', 'posts', 'notes', 'media',
]);
const PAGE_TABS = new Set(['live', 'live_videos', 'videos', 'streams']);

// The page's /live link if this is a link to a Facebook page rather than a
// video or post, else null.
export function facebookPageLive(raw) {
  let u;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const h = u.hostname.replace(/^(www|m|mobile|web)\./, '').toLowerCase();
  if (h !== 'facebook.com') return null;
  const parts = u.pathname.split('/').filter(Boolean);
  let page = null;
  if (parts[0] === 'profile.php' && parts.length === 1) page = u.searchParams.get('id');
  else if (parts[0] === 'pg' && parts.length <= 3 && (parts.length < 3 || PAGE_TABS.has(parts[2]))) page = parts[1];
  else if (parts.length === 1 || (parts.length === 2 && PAGE_TABS.has(parts[1]))) page = parts[0];
  if (!page || NOT_PAGES.has(page.toLowerCase()) || !/^[\w.-]{1,100}$/.test(page)) return null;
  return `https://www.facebook.com/${page}/live`;
}

// A video link found in the page Facebook serves for /<page>/live: where it
// redirected to, or the video named in the page itself.
export function videoFromPage(finalUrl, html, pageLive) {
  const page = pageLive.replace(/\/live$/, '');
  const fromUrl = (s) => {
    const vid = s.match(/\/videos\/(?:[^/?#]+\/)?(\d{5,})/)?.[1] ?? s.match(/[?&]v=(\d{5,})/)?.[1];
    return vid ? `${page}/videos/${vid}/` : null;
  };
  const found = fromUrl(finalUrl);
  if (found) return found;
  const og = html.match(/<meta[^>]+property="og:url"[^>]+content="([^"]+)"/)?.[1];
  if (og && fromUrl(og)) return fromUrl(og);
  // A live broadcast shows up in the page data as a video that is streaming now.
  const live = html.match(/"is_live_streaming":true[^{}]{0,400}?"(?:video_id|id)":"(\d{5,})"/) ??
    html.match(/"(?:video_id|id)":"(\d{5,})"[^{}]{0,400}?"is_live_streaming":true/);
  return live ? `${page}/videos/${live[1]}/` : null;
}

async function fetchCandidate(pageLive) {
  try {
    const res = await fetch(pageLive, {
      redirect: 'follow',
      headers: {
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(15_000),
    });
    return videoFromPage(res.url, res.ok ? await res.text() : '', pageLive);
  } catch {
    return null;
  }
}

// Asks yt-dlp whether a link is live now. Resolves to the video's link, or null.
export function ytdlpLiveVideo(url, ytdlp = process.env.YTDLP_BIN || 'yt-dlp') {
  return new Promise((resolve) => {
    execFile(
      ytdlp,
      ['--quiet', '--no-warnings', '--skip-download', '-I', '1', '--print', '%(live_status)s %(webpage_url)s', '--', url],
      { timeout: 45_000 },
      (_err, stdout) => {
        const line = String(stdout).trim().split('\n').find((l) => l.startsWith('is_live '));
        resolve(line ? line.slice('is_live '.length).trim() || url : null);
      },
    );
  });
}

// The page's current live video link, or null when it is not live.
export async function findFacebookLive(pageLive, ytdlp) {
  const candidate = await fetchCandidate(pageLive);
  // yt-dlp confirms it is live, not the last broadcast Facebook may redirect to.
  if (candidate) {
    const live = await ytdlpLiveVideo(candidate, ytdlp);
    if (live) return live;
  }
  return ytdlpLiveVideo(pageLive, ytdlp);
}
