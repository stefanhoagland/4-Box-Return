// The wall's saved state: four tiles, each a label and a source URL.
// Kept in localStorage, and can be shared as a link (#wall=...) so a
// second screen opens with the same streams.

export interface TileConfig {
  label: string;
  url: string;
}

export const TILE_COUNT = 4;
const STORAGE_KEY = 'four-box-return:wall';
const HASH_KEY = 'wall';

export function emptyWall(): TileConfig[] {
  return Array.from({ length: TILE_COUNT }, (_, i) => ({ label: `Box ${i + 1}`, url: '' }));
}

export function normalise(value: unknown): TileConfig[] | null {
  if (!Array.isArray(value)) return null;
  const wall = emptyWall();
  value.slice(0, TILE_COUNT).forEach((t, i) => {
    if (t && typeof t === 'object') {
      const { label, url } = t as Record<string, unknown>;
      if (typeof label === 'string') wall[i].label = label;
      if (typeof url === 'string') wall[i].url = url;
    }
  });
  return wall;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeWall(wall: TileConfig[]): string {
  return toBase64Url(JSON.stringify(wall));
}

export function decodeWall(encoded: string): TileConfig[] | null {
  try {
    return normalise(JSON.parse(fromBase64Url(encoded)));
  } catch {
    return null;
  }
}

export function shareUrl(wall: TileConfig[], base: string): string {
  const u = new URL(base);
  u.hash = `${HASH_KEY}=${encodeWall(wall)}`;
  return u.toString();
}

export function loadWall(hash: string): TileConfig[] {
  const fromHash = new URLSearchParams(hash.replace(/^#/, '')).get(HASH_KEY);
  if (fromHash) {
    const wall = decodeWall(fromHash);
    if (wall) return wall;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return normalise(JSON.parse(stored)) ?? emptyWall();
  } catch {
    // Private window or blocked storage: start empty.
  }
  return emptyWall();
}

export function saveWall(wall: TileConfig[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wall));
  } catch {
    // Not fatal; the share link still carries the layout.
  }
}
