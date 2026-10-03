import { describe, expect, it } from 'vitest';
import { decodeWall, emptyWall, encodeWall, loadWall, normalise, shareUrl } from './layout';

describe('wall layout', () => {
  it('round-trips through a share link, including non-ASCII labels', () => {
    const wall = emptyWall();
    wall[0] = { label: 'Main stage – Zürich', url: 'https://youtu.be/dQw4w9WgXcQ' };
    const link = shareUrl(wall, 'https://mv.example.com/?a=1');
    const hash = new URL(link).hash;
    expect(loadWall(hash)).toEqual(wall);
    expect(decodeWall(encodeWall(wall))).toEqual(wall);
  });

  it('always yields four tiles from partial or junk input', () => {
    expect(normalise([{ label: 'A', url: 'x' }])).toHaveLength(4);
    expect(normalise('nope')).toBeNull();
    expect(decodeWall('%%%')).toBeNull();
  });
});
