import { describe, expect, it } from 'vitest';
import { METER_FLOOR_DB, dbToFraction, peakDb, smooth } from './audio';

describe('meter maths', () => {
  it('reads the peak of a block in dBFS', () => {
    expect(peakDb(new Float32Array([0, 0.5, -1, 0.25]))).toBeCloseTo(0);
    expect(peakDb(new Float32Array([0.1, -0.05]))).toBeCloseTo(-20);
    expect(peakDb(new Float32Array(128))).toBe(METER_FLOOR_DB);
  });

  it('maps dB onto the meter height', () => {
    expect(dbToFraction(0)).toBe(1);
    expect(dbToFraction(-30)).toBeCloseTo(0.5);
    expect(dbToFraction(-90)).toBe(0);
    expect(dbToFraction(6)).toBe(1);
  });

  it('jumps up at once and falls back slowly', () => {
    expect(smooth(-40, -10, 0.016)).toBe(-10);
    expect(smooth(-10, -60, 0.5)).toBeCloseTo(-22);
    expect(smooth(-10, -12, 1)).toBe(-12);
  });
});
