import { describe, expect, it } from 'vitest';
import { parseSource } from './sources';

const embed = (raw: string, muted = true) => {
  const s = parseSource(raw);
  if (s.kind !== 'iframe') throw new Error(`expected iframe, got ${s.kind}`);
  return s.embedUrl(muted);
};

describe('parseSource', () => {
  it('treats blank input as empty', () => {
    expect(parseSource('   ').kind).toBe('empty');
  });

  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ?si=abc',
    'youtube.com/embed/dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=10',
  ])('embeds YouTube video %s', (raw) => {
    expect(embed(raw)).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1&playsinline=1&enablejsapi=1&controls=0&disablekb=1&fs=0&rel=0&iv_load_policy=3',
    );
  });

  it('embeds a YouTube channel as its current live stream', () => {
    expect(embed('https://www.youtube.com/channel/UC4R8DWoMoI7CAwX8_LjQHig', false)).toBe(
      'https://www.youtube.com/embed/live_stream?channel=UC4R8DWoMoI7CAwX8_LjQHig&autoplay=1&mute=0&playsinline=1&enablejsapi=1&controls=0&disablekb=1&fs=0&rel=0&iv_load_policy=3',
    );
  });

  it('explains YouTube handles are not embeddable yet', () => {
    const s = parseSource('https://www.youtube.com/@NASA/live');
    expect(s.kind).toBe('unsupported');
  });

  it('wraps Facebook videos in the video plugin', () => {
    const url = embed('https://www.facebook.com/NASA/videos/1234567890/');
    expect(url).toContain('https://www.facebook.com/plugins/video.php?href=');
    expect(url).toContain(encodeURIComponent('https://www.facebook.com/NASA/videos/1234567890/'));
    expect(url).toContain('mute=1');
  });

  it('marks X broadcasts as needing the relay', () => {
    const s = parseSource('https://x.com/i/broadcasts/1ZkJzbdvLgRJv');
    expect(s).toMatchObject({ kind: 'unsupported', platform: 'x' });
  });

  it('builds a Kaltura player from the kaltura: shorthand', () => {
    const url = embed('kaltura:1234567/45678901/1_abcd1234');
    expect(url).toMatch(
      /^https:\/\/cdnapisec\.kaltura\.com\/p\/1234567\/embedPlaykitJs\/uiconf_id\/45678901\?iframeembed=true&entry_id=1_abcd1234&config\[playback\]=/,
    );
    expect(decodeURIComponent(url)).toContain('{"autoplay":true,"muted":true}');
  });

  it('plays a Kaltura playManifest as HLS', () => {
    const s = parseSource(
      'https://cdnapisec.kaltura.com/p/1234567/sp/123456700/playManifest/entryId/1_abcd1234/format/applehttp/protocol/https/a.m3u8',
    );
    expect(s).toMatchObject({ kind: 'hls', platform: 'kaltura' });
  });

  it('plays any .m3u8 link as HLS', () => {
    expect(parseSource('https://example.com/live/stream.m3u8?token=x')).toMatchObject({
      kind: 'hls',
      platform: 'hls',
    });
  });

  it('falls back to a plain iframe for other links', () => {
    expect(embed('https://example.com/player')).toBe('https://example.com/player');
  });
});
