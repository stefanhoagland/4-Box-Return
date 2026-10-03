import { useEffect, useMemo, useRef, useState } from 'react';
import { useAudioEnabled, type StereoAnalysers } from './audio';
import { HlsPlayer, type HlsState } from './HlsPlayer';
import { Meter } from './Meter';
import { PLATFORM_LABEL, parseSource } from './sources';

interface Props {
  index: number;
  label: string;
  url: string;
  muted: boolean;
  onToggleAudio: () => void;
}

type Status = HlsState | 'embed' | 'unsupported' | 'none';

const STATUS_TEXT: Record<Status, string> = {
  loading: 'Loading',
  playing: 'Playing',
  stalled: 'Stalled',
  error: 'No signal',
  embed: 'Embed',
  unsupported: 'Not playable',
  none: 'Empty',
};

export function Tile({ index, label, url, muted, onToggleAudio }: Props) {
  const source = useMemo(() => parseSource(url), [url]);
  const [hlsState, setHlsState] = useState<HlsState>('loading');
  const [analysers, setAnalysers] = useState<StereoAnalysers | null>(null);
  const audioEnabled = useAudioEnabled();
  const tileRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const isYoutube = source.kind === 'iframe' && source.platform === 'youtube';
  // YouTube is muted and unmuted over postMessage so the stream does not reload.
  const iframeSrc =
    source.kind === 'iframe' ? source.embedUrl(isYoutube ? true : muted) : undefined;

  useEffect(() => {
    if (!isYoutube) return;
    frameRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func: muted ? 'mute' : 'unMute', args: [] }),
      'https://www.youtube.com',
    );
  }, [muted, isYoutube]);

  const status: Status =
    source.kind === 'hls'
      ? hlsState
      : source.kind === 'iframe'
        ? 'embed'
        : source.kind === 'unsupported'
          ? 'unsupported'
          : 'none';

  const toggleFullscreen = () => {
    const el = tileRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  return (
    <section
      ref={tileRef}
      className={`tile status-${status} ${muted ? '' : 'tile-audio'}`}
      aria-label={label || `Box ${index + 1}`}
    >
      <header className="tile-bar" onDoubleClick={toggleFullscreen}>
        <span className="tile-number">{index + 1}</span>
        <span className="tile-label">{label}</span>
        {source.kind !== 'empty' && (
          <span className="tile-platform">{PLATFORM_LABEL[source.platform]}</span>
        )}
        <span className="tile-status">
          <span className="dot" />
          {STATUS_TEXT[status]}
        </span>
        {source.kind !== 'empty' && source.kind !== 'unsupported' && (
          <button
            className="tile-audio-btn"
            onClick={onToggleAudio}
            aria-pressed={!muted}
            title={muted ? 'Listen to this box' : 'Mute this box'}
          >
            {muted ? '🔇' : '🔊'}
          </button>
        )}
        <button className="tile-fs-btn" onClick={toggleFullscreen} title="Full screen">
          ⛶
        </button>
      </header>

      <div className="tile-body">
        {source.kind === 'iframe' && (
          <iframe
            ref={frameRef}
            key={isYoutube ? source.openUrl : iframeSrc}
            className="player"
            src={iframeSrc}
            title={label}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
          />
        )}
        {/* Keeps the mouse off the YouTube player so its title and controls never pop up. */}
        {isYoutube && <div className="embed-shield" />}
        {source.kind === 'hls' && (
          <HlsPlayer
            src={source.manifestUrl}
            muted={muted}
            onState={setHlsState}
            onAnalysers={setAnalysers}
          />
        )}
        {source.kind === 'hls' && (
          <Meter
            analysers={analysers}
            note={audioEnabled ? undefined : 'Click anywhere to turn on audio meters'}
          />
        )}
        {source.kind === 'iframe' && (
          <Meter analysers={null} note={`No meter: ${PLATFORM_LABEL[source.platform]} embeds hide their audio`} />
        )}
        {source.kind === 'unsupported' && (
          <div className="tile-message">
            <p>{source.reason}</p>
            <a href={source.openUrl} target="_blank" rel="noreferrer">
              Open stream in a new tab
            </a>
          </div>
        )}
        {source.kind === 'empty' && (
          <div className="tile-message">
            <p>No stream assigned. Pick one on the admin page.</p>
          </div>
        )}
      </div>
    </section>
  );
}
