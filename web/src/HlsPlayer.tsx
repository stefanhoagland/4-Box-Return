import Hls from 'hls.js';
import { useEffect, useRef } from 'react';

export type HlsState = 'loading' | 'playing' | 'stalled' | 'error';

interface Props {
  src: string;
  muted: boolean;
  onState: (state: HlsState) => void;
}

const STALL_MS = 10_000;
const RETRY_MS = 10_000;

// Plays an HLS manifest and reports whether video is actually moving.
// A stream whose playhead stops advancing for STALL_MS counts as stalled.
export function HlsPlayer({ src, muted, onState }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | null = null;
    let retryTimer: number | undefined;
    let lastTime = -1;
    let lastMove = Date.now();
    let current: HlsState | null = null;
    const report = (s: HlsState) => {
      if (s !== current) {
        current = s;
        onStateRef.current(s);
      }
    };

    const start = () => {
      report('loading');
      if (Hls.isSupported()) {
        hls = new Hls({ liveDurationInfinity: true, lowLatencyMode: true });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          report('error');
          hls?.destroy();
          hls = null;
          retryTimer = window.setTimeout(start, RETRY_MS);
        });
        hls.loadSource(src);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src; // Safari plays HLS natively.
      } else {
        report('error');
        return;
      }
      video.play().catch(() => {
        // Autoplay can be refused; the stall check will flag it.
      });
    };

    const watchdog = window.setInterval(() => {
      if (current === 'error') return;
      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        lastMove = Date.now();
        if (video.currentTime > 0) report('playing');
      } else if (Date.now() - lastMove > STALL_MS) {
        report('stalled');
      }
    }, 1000);

    start();
    return () => {
      window.clearInterval(watchdog);
      window.clearTimeout(retryTimer);
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [src]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  return <video ref={videoRef} className="player" muted playsInline autoPlay />;
}
