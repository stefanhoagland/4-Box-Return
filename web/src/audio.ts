// One shared AudioContext for the viewer. Browsers only let a page play sound
// or analyse audio after the viewer has clicked or pressed a key, so audio
// starts disabled and is switched on by the first interaction.

import { useSyncExternalStore } from 'react';

let context: AudioContext | null = null;
let enabled = false;
const listeners = new Set<() => void>();

export function getAudioContext(): AudioContext | null {
  return enabled ? context : null;
}

export async function enableAudio(): Promise<void> {
  if (!context) context = new AudioContext();
  if (context.state === 'suspended') await context.resume();
  if (!enabled) {
    enabled = true;
    listeners.forEach((l) => l());
  }
}

export function useAudioEnabled(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => enabled,
  );
}

export interface StereoAnalysers {
  left: AnalyserNode;
  right: AnalyserNode;
}

// Meter scale and ballistics, shared by the meter drawing and the tests.
export const METER_FLOOR_DB = -60;

export function peakDb(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  return peak > 0 ? Math.max(METER_FLOOR_DB, 20 * Math.log10(peak)) : METER_FLOOR_DB;
}

// Fraction of the meter height for a dB value (0 at the floor, 1 at 0 dBFS).
export function dbToFraction(db: number): number {
  return Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));
}

// Rises instantly, falls at fallDbPerSec, like a PPM-style meter.
export function smooth(previous: number, next: number, dtSec: number, fallDbPerSec = 24): number {
  return next >= previous ? next : Math.max(next, previous - fallDbPerSec * dtSec);
}
