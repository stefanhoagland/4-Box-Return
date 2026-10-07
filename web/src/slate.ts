import { useEffect, useState } from 'react';
import type { HlsState } from './HlsPlayer';
import type { Source } from './sources';
import type { RelayStatus } from './wall';

// How long a box can go without live video before it shows the platform slate.
export const SLATE_AFTER_MS = 5 * 60_000;

// Whether a box has live video right now: true, false, or null when the page
// cannot tell (an embed the server is not relaying, or an empty box).
export function hasLiveVideo(source: Source, hlsState: HlsState, relay: RelayStatus | null): boolean | null {
  if (source.kind === 'hls') return hlsState === 'playing';
  // Embeds hide their state from the page; the server relay pulling the stream is the sign it is live.
  if (source.kind === 'iframe' || source.kind === 'unsupported') return relay ? relay.state === 'running' : null;
  return null;
}

// True once `live` has been false for SLATE_AFTER_MS without a break. Starts
// over when `key` (the box's link) changes.
export function useNoVideo(live: boolean | null, key: string, afterMs = SLATE_AFTER_MS): number | null {
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => setSince(null), [key]);
  useEffect(() => {
    if (live === false) setSince((s) => s ?? Date.now());
    else setSince(null);
  }, [live, key]);
  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, [since]);

  return since !== null && now - since >= afterMs ? since : null;
}
