import { describe, expect, it } from 'vitest';
import { hasLiveVideo } from './slate';
import { parseSource } from './sources';

const hls = parseSource('https://example.com/live/index.m3u8');
const youtube = parseSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
const x = parseSource('https://x.com/i/broadcasts/1ABC');
const kaltura = parseSource('https://cdnapisec.kaltura.com/p/1/embedPlaykitJs/uiconf_id/2?iframeembed=true&entry_id=0_abc');

describe('hasLiveVideo', () => {
  it('trusts the player for HLS boxes', () => {
    expect(hasLiveVideo(hls, 'playing', null)).toBe(true);
    expect(hasLiveVideo(hls, 'stalled', null)).toBe(false);
    expect(hasLiveVideo(hls, 'error', null)).toBe(false);
    expect(hasLiveVideo(hls, 'loading', null)).toBe(false);
  });

  it('uses the server relay for embeds', () => {
    expect(hasLiveVideo(youtube, 'loading', { state: 'running', kind: 'meter', message: '' })).toBe(true);
    expect(hasLiveVideo(youtube, 'loading', { state: 'error', kind: 'meter', message: 'offline' })).toBe(false);
    expect(hasLiveVideo(youtube, 'loading', { state: 'starting', kind: 'meter', message: '' })).toBe(false);
    expect(hasLiveVideo(x, 'loading', { state: 'error', kind: 'play', message: 'offline' })).toBe(false);
  });

  it('cannot tell for embeds the server is not pulling', () => {
    expect(hasLiveVideo(youtube, 'loading', null)).toBe(null);
    expect(hasLiveVideo(kaltura, 'loading', null)).toBe(null);
    expect(hasLiveVideo(parseSource(''), 'loading', null)).toBe(null);
  });
});
