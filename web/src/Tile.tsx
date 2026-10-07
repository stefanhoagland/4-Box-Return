import { useEffect, useMemo, useRef, useState } from 'react';
import { useAudioEnabled, type StereoAnalysers } from './audio';
import { HlsPlayer, type HlsState } from './HlsPlayer';
import { Meter } from './Meter';
import { PLATFORM_LABEL, parseSource } from './sources';
import { hasLiveVideo, useNoVideo } from './slate';
import type { Levels, RelayStatus } from './wall';

interface Props {
  index: number;
  label: string;
  url: string;
  muted: boolean;
  onToggleAudio: () => void;
  captions?: boolean;
  onToggleCaptions?: () => void;
  // From the server relay, for links the browser cannot read itself.
  serverLevels?: Levels | null;
  relay?: RelayStatus | null;
}

type Status = HlsState | 'embed' | 'unsupported' | 'none' | 'offline';

const STATUS_TEXT: Record<Status, string> = {
  loading: 'Loading',
  playing: 'Playing',
  stalled: 'Stalled',
  error: 'No signal',
  embed: 'Embed',
  unsupported: 'Not playable',
  none: 'Empty',
  offline: 'Off air',
};

// Embedded players fall behind or stop while the tab is hidden, and the page
// cannot reach inside them to catch up. Reloading them on return puts them
// back on the live edge.
const RELOAD_AFTER_HIDDEN_MS = 10_000;

function useReloadOnReturn(): number {
  const [key, setKey] = useState(0);
  useEffect(() => {
    let hiddenAt = document.hidden ? Date.now() : 0;
    const onVisibility = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > RELOAD_AFTER_HIDDEN_MS) setKey((k) => k + 1);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  return key;
}

export function Tile({
  index,
  label,
  url,
  muted,
  onToggleAudio,
  captions = false,
  onToggleCaptions,
  serverLevels = null,
  relay = null,
}: Props) {
  const parsed = useMemo(() => parseSource(url), [url]);
  // X broadcasts cannot be embedded; once the server relay has them, they play as HLS.
  const relayHls = relay?.kind === 'play' && relay.state === 'running' ? relay.hls : undefined;
  const source = useMemo(
    () =>
      relayHls && parsed.kind === 'unsupported'
        ? { kind: 'hls' as const, platform: parsed.platform, manifestUrl: relayHls, openUrl: parsed.openUrl }
        : parsed,
    [parsed, relayHls],
  );
  const [hlsState, setHlsState] = useState<HlsState>('loading');
  const [analysers, setAnalysers] = useState<StereoAnalysers | null>(null);
  const audioEnabled = useAudioEnabled();
  const tileRef = useRef<HTMLElement>(null);
  const reloadKey = useReloadOnReturn();
  const frameRef = useRef<HTMLIFrameElement>(null);

  const isYoutube = source.kind === 'iframe' && source.platform === 'youtube';
  // YouTube is muted and unmuted over postMessage so the stream does not reload.
  const iframeSrc =
    source.kind === 'iframe' ? source.embedUrl(isYoutube ? true : muted) : undefined;

  const ytCommand = (func: string, args: unknown[] = []) =>
    frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube.com');

  useEffect(() => {
    if (isYoutube) ytCommand(muted ? 'mute' : 'unMute');
  }, [muted, isYoutube]);

  // YouTube captions are switched by loading or unloading the player's captions module.
  const ytCaptions = () => ytCommand(captions ? 'loadModule' : 'unloadModule', ['captions']);
  useEffect(() => {
    if (isYoutube) ytCaptions();
  }, [captions, isYoutube]);
  // The player ignores commands until it is ready, so repeat the setting after the frame loads.
  const onFrameLoad = () => {
    if (!isYoutube) return;
    for (const ms of [1000, 3000, 8000]) window.setTimeout(() => {
      ytCommand(muted ? 'mute' : 'unMute');
      ytCaptions();
    }, ms);
  };
  const canCaption = isYoutube || source.kind === 'hls';

  // After a stretch with no live video the box shows a slate instead.
  const offAirSince = useNoVideo(hasLiveVideo(source, hlsState, relay), url);

  const status: Status = offAirSince !== null
    ? 'offline'
    : source.kind === 'hls'
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
        {canCaption && onToggleCaptions && (
          <button
            className="tile-cc-btn"
            onClick={onToggleCaptions}
            aria-pressed={captions}
            title={captions ? 'Hide captions' : 'Show captions'}
          >
            CC
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
            key={`${isYoutube ? source.openUrl : iframeSrc}#${reloadKey}`}
            className="player"
            src={iframeSrc}
            title={label}
            onLoad={onFrameLoad}
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
            captions={captions}
            onState={setHlsState}
            onAnalysers={setAnalysers}
          />
        )}
        {source.kind === 'hls' && (
          <Meter
            analysers={analysers}
            levels={analysers ? null : serverLevels}
            note={audioEnabled || serverLevels ? undefined : 'Click anywhere to turn on audio meters'}
          />
        )}
        {source.kind === 'iframe' && (
          <Meter
            analysers={null}
            levels={serverLevels}
            note={
              serverLevels
                ? 'Audio level measured by the server'
                : relay?.state === 'error'
                  ? `No meter: ${relay.message}`
                  : relay
                    ? 'Meter starting on the server…'
                    : `No meter for ${PLATFORM_LABEL[source.platform]} embeds`
            }
          />
        )}
        {source.kind === 'unsupported' && (
          <div className="tile-message">
            <p>
              {relay?.kind === 'play' && relay.state === 'starting'
                ? 'Connecting through the server…'
                : relay?.kind === 'play' && relay.state === 'error'
                  ? `Server could not pull this stream: ${relay.message}. Retrying.`
                  : source.reason}
            </p>
            <a href={source.openUrl} target="_blank" rel="noreferrer">
              Open stream in a new tab
            </a>
          </div>
        )}
        {offAirSince !== null && source.kind !== 'empty' && (
          <div className={`slate slate-${source.platform}`}>
            <div className="slate-platform">{PLATFORM_LABEL[source.platform]}</div>
            <div className="slate-text">No live video</div>
            <div className="slate-since">
              since {new Date(offAirSince).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </div>
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
