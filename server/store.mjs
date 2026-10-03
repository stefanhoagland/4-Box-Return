// The wall: a library of streams and which stream sits in each of the four boxes.
// Saved as JSON in CONFIG_DIR so it survives container restarts.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const BOX_COUNT = 4;
const MAX_STREAMS = 500;
const MAX_TEXT = 2000;

export function emptyWall() {
  return { title: '4-Box Return', streams: [], boxes: Array(BOX_COUNT).fill(null) };
}

const text = (v, max = MAX_TEXT) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Accepts anything and returns a valid wall, or throws with a reason.
export function validateWall(input) {
  if (!input || typeof input !== 'object') throw new Error('Wall must be an object');
  const streams = Array.isArray(input.streams) ? input.streams.slice(0, MAX_STREAMS) : [];
  const seen = new Set();
  const clean = [];
  for (const s of streams) {
    if (!s || typeof s !== 'object') continue;
    const url = text(s.url);
    if (!url) continue;
    let id = text(s.id, 64) || randomUUID();
    if (seen.has(id)) id = randomUUID();
    seen.add(id);
    clean.push({ id, name: text(s.name, 200) || url, url });
  }
  const boxesIn = Array.isArray(input.boxes) ? input.boxes : [];
  const boxes = Array.from({ length: BOX_COUNT }, (_, i) =>
    typeof boxesIn[i] === 'string' && seen.has(boxesIn[i]) ? boxesIn[i] : null,
  );
  return { title: text(input.title, 200) || emptyWall().title, streams: clean, boxes };
}

export class WallStore {
  constructor(dir) {
    this.file = path.join(dir, 'wall.json');
    this.dir = dir;
    this.wall = emptyWall();
    this.version = 0;
  }

  async load() {
    await mkdir(this.dir, { recursive: true });
    try {
      this.wall = validateWall(JSON.parse(await readFile(this.file, 'utf8')));
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`Could not read ${this.file}, starting empty:`, err.message);
      this.wall = emptyWall();
    }
    return this;
  }

  async save(input) {
    const wall = validateWall(input);
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(wall, null, 2));
    await rename(tmp, this.file);
    this.wall = wall;
    this.version += 1;
    return wall;
  }
}
