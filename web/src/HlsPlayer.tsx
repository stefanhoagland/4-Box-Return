import Hls from 'hls.js';
import { useEffect, useRef } from 'react';
import { getAudioContext, useAudioEnabled, type StereoAnalysers } from './audio';

export type HlsState = 'loading' | 'playing' | 'stalled' | 'error';

interface Props {
  src: string;
  muted: boolean;
  captions?: boolean;
  onState: (state: HlsState) => void;
  onAnalysers?: (analysers: StereoAnalysers | null) => void;
}

// createMediaElementSource can only be called once per element.
const elementSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

const STALL_MS = 10_000;

function showCaptions(video: HTMLVideoElement, hls: Hls | null, on: boolean) {
  if (hls) {
    hls.subtitleDisplay = on;
    if (on && hls.subtitleTrack === -1 && hls.subtitleTracks.length) hls.subtitleTrack = 0;
  }
  const tracks = Array.from(video.textTracks).filter((t) => t.kind === 'captions' || t.kind === 'subtitles');
  tracks.forEach((t, i) => {
    t.mode = on && i === 0 ? 'showing' : on ? 'hidden' : 'disabled';
  });
}
const RETRY_MS = 10_000;

// Plays an HLS manifest and reports whether video is actually moving.
// A stream whose playhead stops advancing for STALL_MS counts as stalled.
export function HlsPlayer({ src, muted, captions = false, onState, onAnalysers }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  const hlsRef = useRef<Hls | null>(null);
  const captionsRef = useRef(captions);
  captionsRef.current = captions;

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
        hls.subtitleDisplay = captionsRef.current;
        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => showCaptions(video, hls, captionsRef.current));
        hlsRef.current = hls;
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
      hlsRef.current = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [src]);

  // Captions: HLS subtitle tracks and captions carried in the video (CEA-608)
  // both arrive as text tracks on the video element.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    showCaptions(video, hlsRef.current, captions);
    const onAdd = () => showCaptions(video, hlsRef.current, captionsRef.current);
    video.textTracks.addEventListener('addtrack', onAdd);
    return () => video.textTracks.removeEventListener('addtrack', onAdd);
  }, [captions, src]);

  // Once audio is enabled the video's sound goes through Web Audio: a splitter
  // feeds the left/right meters, and a gain node does the muting so the meters
  // keep moving on muted boxes. Before that the video plays muted, which is the
  // only way browsers allow it to start on its own.
  const audioEnabled = useAudioEnabled();
  const gainRef = useRef<GainNode | null>(null);
  const onAnalysersRef = useRef(onAnalysers);
  onAnalysersRef.current = onAnalysers;

  useEffect(() => {
    const video = videoRef.current;
    const ctx = getAudioContext();
    if (!video || !ctx) return;
    let source = elementSources.get(video);
    if (!source) {
      source = ctx.createMediaElementSource(video);
      elementSources.set(video, source);
    }
    // Forces two channels so a mono stream lights both meters.
    const stereo = ctx.createGain();
    stereo.channelCount = 2;
    stereo.channelCountMode = 'explicit';
    stereo.channelInterpretation = 'speakers';
    const splitter = ctx.createChannelSplitter(2);
    const left = ctx.createAnalyser();
    const right = ctx.createAnalyser();
    left.fftSize = right.fftSize = 1024;
    const gain = ctx.createGain();
    source.connect(stereo).connect(splitter);
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    source.connect(gain).connect(ctx.destination);
    gainRef.current = gain;
    video.muted = false;
    void video.play().catch(() => undefined);
    onAnalysersRef.current?.({ left, right });
    return () => {
      onAnalysersRef.current?.(null);
      source?.disconnect();
      stereo.disconnect();
      gain.disconnect();
      gainRef.current = null;
    };
  }, [audioEnabled]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (gainRef.current) gainRef.current.gain.value = muted ? 0 : 1;
    else video.muted = muted;
  }, [muted, audioEnabled]);

  return <video ref={videoRef} className="player" muted playsInline autoPlay />;
}
