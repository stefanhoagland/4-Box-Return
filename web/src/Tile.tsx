import { useEffect, useMemo, useRef, useState } from 'react';
import { HlsPlayer, type HlsState } from './HlsPlayer';
import type { TileConfig } from './layout';
import { PLATFORM_LABEL, parseSource } from './sources';

interface Props {
  index: number;
  config: TileConfig;
  editing: boolean;
  muted: boolean;
  onToggleAudio: () => void;
  onChange: (config: TileConfig) => void;
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

export function Tile({ index, config, editing, muted, onToggleAudio, onChange }: Props) {
  const source = useMemo(() => parseSource(config.url), [config.url]);
  const [hlsState, setHlsState] = useState<HlsState>('loading');
  // The link is applied on Enter or when the field loses focus, so players
  // do not reload on every keystroke.
  const [draftUrl, setDraftUrl] = useState(config.url);
  useEffect(() => setDraftUrl(config.url), [config.url]);
  const commitUrl = () => {
    if (draftUrl.trim() !== config.url) onChange({ ...config, url: draftUrl.trim() });
  };
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
      aria-label={config.label || `Box ${index + 1}`}
    >
      <header className="tile-bar" onDoubleClick={toggleFullscreen}>
        <span className="tile-number">{index + 1}</span>
        <span className="tile-label">{config.label}</span>
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
            title={config.label}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
          />
        )}
        {source.kind === 'hls' && (
          <HlsPlayer src={source.manifestUrl} muted={muted} onState={setHlsState} />
        )}
        {source.kind === 'unsupported' && (
          <div className="tile-message">
            <p>{source.reason}</p>
            <a href={source.openUrl} target="_blank" rel="noreferrer">
              Open stream in a new tab
            </a>
          </div>
        )}
        {source.kind === 'empty' && !editing && (
          <div className="tile-message">
            <p>No stream set. Press Edit to add one.</p>
          </div>
        )}
      </div>

      {editing && (
        <form
          className="tile-edit"
          onSubmit={(e) => {
            e.preventDefault();
            commitUrl();
          }}
        >
          <input
            aria-label="Label"
            placeholder="Label"
            value={config.label}
            onChange={(e) => onChange({ ...config, label: e.target.value })}
          />
          <input
            aria-label="Stream link"
            placeholder="YouTube, Facebook, X, Kaltura or .m3u8 link"
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            onBlur={commitUrl}
          />
        </form>
      )}
    </section>
  );
}
