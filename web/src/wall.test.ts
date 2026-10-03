import { describe, expect, it } from 'vitest';
import { emptyWall, parseImport, streamInBox } from './wall';

describe('parseImport', () => {
  it('reads names and links in the common formats', () => {
    const { streams, skipped } = parseImport(
      [
        'Main stage, https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'Facebook feed | https://www.facebook.com/NASA/videos/123/',
        'X\thttps://x.com/i/broadcasts/1ZkJzbdvLgRJv',
        'Kaltura room - kaltura:1234567/45678901/1_abcd1234',
        'https://example.com/live.m3u8',
        'youtu.be/dQw4w9WgXcQ',
        '# a comment',
        '',
        'just some words',
      ].join('\n'),
    );
    expect(streams).toEqual([
      { name: 'Main stage', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      { name: 'Facebook feed', url: 'https://www.facebook.com/NASA/videos/123/' },
      { name: 'X', url: 'https://x.com/i/broadcasts/1ZkJzbdvLgRJv' },
      { name: 'Kaltura room', url: 'kaltura:1234567/45678901/1_abcd1234' },
      { name: 'https://example.com/live.m3u8', url: 'https://example.com/live.m3u8' },
      { name: 'youtu.be/dQw4w9WgXcQ', url: 'youtu.be/dQw4w9WgXcQ' },
    ]);
    expect(skipped).toBe(1);
  });
});

describe('streamInBox', () => {
  it('finds the stream assigned to a box', () => {
    const wall = emptyWall();
    wall.streams = [{ id: 'a', name: 'A', url: 'https://youtu.be/dQw4w9WgXcQ' }];
    wall.boxes[2] = 'a';
    expect(streamInBox(wall, 2)?.name).toBe('A');
    expect(streamInBox(wall, 0)).toBeNull();
  });
});
