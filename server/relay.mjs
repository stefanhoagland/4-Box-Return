// Server-side relay for streams the browser cannot read on its own.
//
// For each box showing a YouTube, Facebook or X link, the server runs
// yt-dlp (to fetch the stream) piped into ffmpeg, which
//   - decodes the audio to 8 kHz stereo PCM so the server can measure
//     left/right peak levels and push them to viewers, and
//   - for X, also repackages the stream as HLS under /relay/<box>/ so the
//     viewer can play it (X broadcasts cannot be embedded).
// A relay that dies is restarted with a growing delay.

import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const RELAY_DIR = path.join(os.tmpdir(), '4br-relay');
const SAMPLE_RATE = 8000;
const BLOCK_FRAMES = SAMPLE_RATE / 10; // one level reading every 100 ms
const FLOOR_DB = -60;
const MAX_BACKOFF_MS = 60_000;

const host = (u) => u.hostname.replace(/^(www|m|mobile)\./, '').toLowerCase();

// Which boxes need the relay, and what for.
export function relayKind(raw) {
  let u;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (/\.m3u8$/i.test(u.pathname)) return null; // the browser plays and meters HLS itself
  const h = host(u);
  if (['youtube.com', 'youtu.be', 'facebook.com', 'fb.watch'].includes(h)) return 'meter';
  if (['x.com', 'twitter.com'].includes(h)) return 'play';
  return null;
}

// Peak level in dBFS of each channel in a block of interleaved s16le stereo.
export function blockLevels(buf) {
  let l = 0;
  let r = 0;
  for (let i = 0; i + 3 < buf.length; i += 4) {
    const a = Math.abs(buf.readInt16LE(i));
    const b = Math.abs(buf.readInt16LE(i + 2));
    if (a > l) l = a;
    if (b > r) r = b;
  }
  const db = (v) => (v > 0 ? Math.max(FLOOR_DB, Math.round(20 * Math.log10(v / 32768) * 10) / 10) : FLOOR_DB);
  return [db(l), db(r)];
}

export function ytdlpArgs(url, kind) {
  // Metering only needs the audio, so take the smallest stream that has it.
  const format = kind === 'play' ? 'best[acodec!=none]/best' : 'bestaudio/worst[acodec!=none]/best';
  return ['--quiet', '--no-warnings', '--no-part', '--js-runtimes', 'node', '-f', format, '-o', '-', '--', url];
}

export function ffmpegArgs(kind, hlsDir) {
  const args = ['-hide_banner', '-loglevel', 'error', '-re', '-i', 'pipe:0'];
  args.push('-map', '0:a:0?', '-ac', '2', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1');
  if (kind === 'play') {
    args.push(
      '-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy',
      '-f', 'hls', '-hls_time', '2', '-hls_list_size', '6', '-hls_segment_type', 'fmp4',
      '-hls_flags', 'delete_segments+omit_endlist+independent_segments',
      path.join(hlsDir, 'index.m3u8'),
    );
  }
  return args;
}

class Relay {
  constructor(box, url, kind, events, tools) {
    Object.assign(this, { box, url, kind, events, tools });
    this.dir = path.join(RELAY_DIR, String(box));
    this.backoff = 2000;
    this.stopped = false;
    this.status = { state: 'starting', kind, message: '' };
    void this.start();
  }

  setStatus(state, message = '') {
    this.status = { state, kind: this.kind, message, hls: this.kind === 'play' ? `/relay/${this.box}/index.m3u8` : undefined };
    this.events.onStatus(this.box, this.status);
  }

  async start() {
    if (this.stopped) return;
    this.setStatus('starting');
    await rm(this.dir, { recursive: true, force: true });
    await mkdir(this.dir, { recursive: true });
    if (this.stopped) return;

    // yt-dlp keeps temporary fragment files in its working directory.
    const dl = spawn(this.tools.ytdlp, ytdlpArgs(this.url, this.kind), {
      cwd: this.dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const ff = spawn(this.tools.ffmpeg, ffmpegArgs(this.kind, this.dir), { stdio: ['pipe', 'pipe', 'pipe'] });
    this.procs = [dl, ff];
    dl.stdout.pipe(ff.stdin);
    ff.stdin.on('error', () => undefined); // ffmpeg exiting first is handled below

    let errText = '';
    const keepErr = (d) => (errText = (errText + d).slice(-500));
    dl.stderr.on('data', keepErr);
    ff.stderr.on('data', keepErr);
    dl.on('error', (e) => keepErr(`yt-dlp: ${e.message}`));
    ff.on('error', (e) => keepErr(`ffmpeg: ${e.message}`));

    const blockBytes = BLOCK_FRAMES * 4;
    let pending = Buffer.alloc(0);
    let live = false;
    ff.stdout.on('data', (chunk) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= blockBytes) {
        this.events.onLevels(this.box, blockLevels(pending.subarray(0, blockBytes)));
        pending = pending.subarray(blockBytes);
        if (!live) {
          live = true;
          this.backoff = 2000;
          this.setStatus('running');
        }
      }
    });

    ff.on('close', () => {
      dl.kill('SIGKILL');
      this.procs = [];
      if (this.stopped) return;
      const message = errText.trim().split('\n').pop() || 'Stream ended';
      this.setStatus('error', message);
      this.events.onLevels(this.box, null);
      this.retry = setTimeout(() => void this.start(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    for (const p of this.procs ?? []) p.kill('SIGKILL');
    void rm(this.dir, { recursive: true, force: true });
  }
}

// Keeps one relay per box in step with the wall.
export class RelayManager {
  constructor(events, tools = { ytdlp: 'yt-dlp', ffmpeg: 'ffmpeg' }) {
    this.events = events;
    this.tools = tools;
    this.relays = new Map();
  }

  sync(wall) {
    wall.boxes.forEach((id, box) => {
      const stream = id ? wall.streams.find((s) => s.id === id) : null;
      const kind = stream ? relayKind(stream.url) : null;
      const current = this.relays.get(box);
      if (current && current.url === stream?.url && current.kind === kind) return;
      if (current) {
        current.stop();
        this.relays.delete(box);
        this.events.onLevels(box, null);
        this.events.onStatus(box, null);
      }
      if (kind) this.relays.set(box, new Relay(box, stream.url, kind, this.events, this.tools));
    });
  }

  statuses() {
    const out = {};
    for (const [box, relay] of this.relays) out[box] = relay.status;
    return out;
  }

  stopAll() {
    for (const relay of this.relays.values()) relay.stop();
    this.relays.clear();
  }
}
