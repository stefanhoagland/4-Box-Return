// The wall as stored on the server: a library of streams and which stream
// fills each of the four boxes. The admin page edits it; viewers follow it live.

export interface Stream {
  id: string;
  name: string;
  url: string;
}

export interface Wall {
  title: string;
  streams: Stream[];
  boxes: (string | null)[];
}

export const BOX_COUNT = 4;

export function emptyWall(): Wall {
  return { title: '4-Box Return', streams: [], boxes: Array(BOX_COUNT).fill(null) };
}

export function streamInBox(wall: Wall, box: number): Stream | null {
  const id = wall.boxes[box];
  return (id && wall.streams.find((s) => s.id === id)) || null;
}

export async function fetchWall(): Promise<Wall> {
  const res = await fetch('/api/wall', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return res.json();
}

export async function saveWall(wall: Wall): Promise<Wall> {
  const res = await fetch('/api/wall', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(wall),
  });
  if (!res.ok) throw new Error(`Save failed (${res.status})`);
  return res.json();
}

// Calls onWall with the current wall and again after every admin save.
export function followWall(onWall: (wall: Wall) => void, onOnline: (online: boolean) => void): () => void {
  const events = new EventSource('/api/events');
  events.onmessage = (e) => {
    onOnline(true);
    try {
      onWall(JSON.parse(e.data));
    } catch {
      // Ignore a malformed message; the next one replaces it.
    }
  };
  events.onerror = () => onOnline(false);
  return () => events.close();
}

const URL_AT_END = /(kaltura:\S+|[a-z][a-z0-9+.-]*:\/\/\S+|(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*)\s*$/i;

// Bulk import: one stream per line, as "Name, link", "Name | link",
// "Name<tab>link" or just a link. Lines without a link are skipped.
export function parseImport(text: string): { streams: Omit<Stream, 'id'>[]; skipped: number } {
  const streams: Omit<Stream, 'id'>[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(URL_AT_END);
    if (!m) {
      skipped += 1;
      continue;
    }
    const url = m[1];
    const name = line
      .slice(0, m.index)
      .replace(/[\s,|;\t-]+$/, '')
      .trim();
    streams.push({ name: name || url, url });
  }
  return { streams, skipped };
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}
