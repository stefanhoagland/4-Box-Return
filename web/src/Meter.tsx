import { useEffect, useRef } from 'react';
import { METER_FLOOR_DB, dbToFraction, peakDb, smooth, type StereoAnalysers } from './audio';

interface Props {
  analysers: StereoAnalysers | null;
  // Why there is no reading, shown as a tooltip on the empty bars.
  note?: string;
}

const PEAK_HOLD_SEC = 1.5;
const TICKS_DB = [0, -6, -12, -18, -24, -36, -48];

// Two vertical bars (left, right) drawn on a canvas over the video.
export function Meter({ analysers, note }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const level = [METER_FLOOR_DB, METER_FLOOR_DB];
    const hold = [METER_FLOOR_DB, METER_FLOOR_DB];
    const holdAt = [0, 0];
    const buffers = analysers
      ? [new Float32Array(analysers.left.fftSize), new Float32Array(analysers.right.fftSize)]
      : [];
    let last = performance.now();
    let frame = 0;

    const draw = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const pad = 4;
      const gap = 3;
      const barW = (w - pad * 2 - gap) / 2;
      const top = pad;
      const height = h - pad * 2;

      const grad = ctx.createLinearGradient(0, top + height, 0, top);
      grad.addColorStop(0, 'rgba(46, 204, 113, 0.85)');
      grad.addColorStop(dbToFraction(-18), 'rgba(46, 204, 113, 0.85)');
      grad.addColorStop(dbToFraction(-9), 'rgba(245, 166, 35, 0.9)');
      grad.addColorStop(dbToFraction(-3), 'rgba(229, 72, 77, 0.95)');
      grad.addColorStop(1, 'rgba(229, 72, 77, 0.95)');

      for (let ch = 0; ch < 2; ch++) {
        const x = pad + ch * (barW + gap);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fillRect(x, top, barW, height);

        if (analysers) {
          const node = ch === 0 ? analysers.left : analysers.right;
          node.getFloatTimeDomainData(buffers[ch]);
          level[ch] = smooth(level[ch], peakDb(buffers[ch]), dt);
          if (level[ch] >= hold[ch] || now - holdAt[ch] > PEAK_HOLD_SEC * 1000) {
            hold[ch] = level[ch];
            holdAt[ch] = now;
          }
          const fill = dbToFraction(level[ch]) * height;
          ctx.fillStyle = grad;
          ctx.fillRect(x, top + height - fill, barW, fill);
          if (hold[ch] > METER_FLOOR_DB) {
            const y = top + height - dbToFraction(hold[ch]) * height;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.fillRect(x, Math.max(top, y - 1), barW, 2);
          }
        }
      }

      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      for (const db of TICKS_DB) {
        const y = Math.round(top + height - dbToFraction(db) * height);
        ctx.fillRect(pad, y, w - pad * 2, 1);
      }

      if (analysers) frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [analysers]);

  return (
    <div className={`meter ${analysers ? '' : 'meter-off'}`} title={note ?? 'Audio level, left and right'}>
      <canvas ref={canvasRef} />
      <div className="meter-labels">
        <span>L</span>
        <span>R</span>
      </div>
    </div>
  );
}
