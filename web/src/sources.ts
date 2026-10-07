// Turns whatever URL someone pastes into a tile into something a player can show.

export type Platform = 'youtube' | 'facebook' | 'x' | 'kaltura' | 'hls' | 'iframe';

export type Source =
  | { kind: 'empty' }
  | { kind: 'iframe'; platform: Platform; embedUrl: (muted: boolean) => string; openUrl: string }
  | { kind: 'hls'; platform: Platform; manifestUrl: string; openUrl: string }
  | { kind: 'unsupported'; platform: Platform; reason: string; openUrl: string };

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;

function tryUrl(raw: string): URL | null {
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

function host(u: URL): string {
  return u.hostname.replace(/^(www|m|mobile)\./, '').toLowerCase();
}

export function youtubeEmbed(u: URL): Source | null {
  const h = host(u);
  if (h !== 'youtube.com' && h !== 'youtu.be' && h !== 'youtube-nocookie.com') return null;
  const parts = u.pathname.split('/').filter(Boolean);
  let videoId: string | null = null;
  let channelId: string | null = null;

  if (h === 'youtu.be') videoId = parts[0] ?? null;
  else if (parts[0] === 'watch') videoId = u.searchParams.get('v');
  else if (['live', 'embed', 'shorts', 'v'].includes(parts[0]) && parts[1] === 'live_stream') {
    channelId = u.searchParams.get('channel');
  } else if (['live', 'embed', 'shorts', 'v'].includes(parts[0])) videoId = parts[1] ?? null;
  else if (parts[0] === 'channel') channelId = parts[1] ?? null;

  const openUrl = u.toString();
  if (videoId && YT_ID.test(videoId)) {
    return {
      kind: 'iframe',
      platform: 'youtube',
      openUrl,
      embedUrl: (muted) =>
        `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=${muted ? 1 : 0}&playsinline=1&enablejsapi=1&controls=0&disablekb=1&fs=0&rel=0&iv_load_policy=3`,
    };
  }
  if (channelId && YT_CHANNEL.test(channelId)) {
    // Plays whatever the channel currently has live.
    return {
      kind: 'iframe',
      platform: 'youtube',
      openUrl,
      embedUrl: (muted) =>
        `https://www.youtube.com/embed/live_stream?channel=${channelId}&autoplay=1&mute=${muted ? 1 : 0}&playsinline=1&enablejsapi=1&controls=0&disablekb=1&fs=0&rel=0&iv_load_policy=3`,
    };
  }
  return {
    kind: 'unsupported',
    platform: 'youtube',
    openUrl,
    reason: 'Save this @handle link on the admin page and the server will swap in the channel link. Or use a video link (watch?v=…) or a channel link (/channel/UC…).',
  };
}

export function facebookEmbed(u: URL): Source | null {
  const h = host(u);
  if (h !== 'facebook.com' && h !== 'fb.watch') return null;
  const href = u.toString();
  return {
    kind: 'iframe',
    platform: 'facebook',
    openUrl: href,
    embedUrl: (muted) =>
      `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false&autoplay=true&mute=${muted ? 1 : 0}`,
  };
}

export function xSource(u: URL): Source | null {
  const h = host(u);
  if (h !== 'x.com' && h !== 'twitter.com') return null;
  return {
    kind: 'unsupported',
    platform: 'x',
    openUrl: u.toString(),
    reason: 'X live broadcasts cannot be embedded. They will play here once the backend relay is added.',
  };
}

// Kaltura: an iframe embed URL is used as-is, or the shorthand
// kaltura:<partnerId>/<uiConfId>/<entryId> builds a Player v7 embed.
export function kalturaEmbed(raw: string, u: URL | null): Source | null {
  const short = raw.trim().match(/^kaltura:(\d+)\/(\d+)\/([A-Za-z0-9_]+)$/);
  if (short) {
    const [, partner, uiconf, entry] = short;
    const openUrl = `https://cdnapisec.kaltura.com/p/${partner}/embedPlaykitJs/uiconf_id/${uiconf}?iframeembed=true&entry_id=${entry}`;
    return {
      kind: 'iframe',
      platform: 'kaltura',
      openUrl,
      embedUrl: (muted) =>
        `${openUrl}&config[playback]=${encodeURIComponent(JSON.stringify({ autoplay: true, muted }))}`,
    };
  }
  if (u && host(u).endsWith('kaltura.com') && !isHls(u)) {
    return { kind: 'iframe', platform: 'kaltura', openUrl: u.toString(), embedUrl: () => u.toString() };
  }
  return null;
}

function isHls(u: URL): boolean {
  return /\.m3u8$/i.test(u.pathname) || /format\/applehttp/i.test(u.pathname);
}

export function parseSource(raw: string): Source {
  const text = raw.trim();
  if (!text) return { kind: 'empty' };

  const kaltShort = kalturaEmbed(text, null);
  if (kaltShort) return kaltShort;

  const u = tryUrl(text);
  if (!u) return { kind: 'unsupported', platform: 'iframe', openUrl: text, reason: 'That does not look like a link.' };

  if (isHls(u)) {
    const platform: Platform = host(u).endsWith('kaltura.com') ? 'kaltura' : 'hls';
    return { kind: 'hls', platform, manifestUrl: u.toString(), openUrl: u.toString() };
  }

  return (
    youtubeEmbed(u) ??
    facebookEmbed(u) ??
    xSource(u) ??
    kalturaEmbed(text, u) ?? {
      kind: 'iframe',
      platform: 'iframe',
      openUrl: u.toString(),
      embedUrl: () => u.toString(),
    }
  );
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: 'YouTube',
  facebook: 'Facebook',
  x: 'X',
  kaltura: 'Kaltura',
  hls: 'HLS',
  iframe: 'Web',
};
