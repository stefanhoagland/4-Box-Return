import { useEffect, useState } from 'react';
import { enableAudio, useAudioEnabled } from './audio';
import { Tile } from './Tile';
import { useClock } from './useClock';
import { BOX_COUNT, emptyWall, followWall, streamInBox, type Levels, type RelayStatus, type Wall } from './wall';

// Which streams have captions on, remembered in this browser by stream link.
const CAPTIONS_KEY = '4br-captions';

function loadCaptions(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(CAPTIONS_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function saveCaptions(next: Record<string, boolean>): Record<string, boolean> {
  try {
    localStorage.setItem(CAPTIONS_KEY, JSON.stringify(next));
  } catch {
    // Private windows can refuse storage; captions then reset on reload.
  }
  return next;
}

// The wall screen: four boxes and a clock. Everything is set on the admin
// page and arrives here live.
export function Viewer() {
  const [wall, setWall] = useState<Wall>(emptyWall);
  const [online, setOnline] = useState(true);
  const [audioBox, setAudioBox] = useState<number | null>(null);
  const [captions, setCaptions] = useState<Record<string, boolean>>(loadCaptions);
  const [levels, setLevels] = useState<Record<number, Levels | null>>({});
  const [relays, setRelays] = useState<Record<number, RelayStatus | null>>({});
  const now = useClock();
  const audioEnabled = useAudioEnabled();

  // Browsers block sound and audio analysis until the first click or key press
  // anywhere on the page, so audio turns on then without a separate button.
  useEffect(() => {
    if (audioEnabled) return;
    const enable = () => void enableAudio();
    window.addEventListener('pointerdown', enable, { once: true });
    window.addEventListener('keydown', enable, { once: true });
    return () => {
      window.removeEventListener('pointerdown', enable);
      window.removeEventListener('keydown', enable);
    };
  }, [audioEnabled]);

  useEffect(
    () =>
      followWall({
        onWall: setWall,
        onOnline: setOnline,
        onLevels: setLevels,
        onRelay: (box, status) => setRelays((r) => ({ ...r, [box]: status })),
      }),
    [],
  );
  useEffect(() => {
    document.title = wall.title;
  }, [wall.title]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };

  return (
    <div className="app viewer">
      <header className="topbar" onDoubleClick={toggleFullscreen}>
        <h1>{wall.title}</h1>
        {!online && <span className="offline">Reconnecting to server…</span>}
        <time className="clock" dateTime={now.toISOString()}>
          {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </time>
      </header>
      <main className="wall">
        {Array.from({ length: BOX_COUNT }, (_, i) => {
          const stream = streamInBox(wall, i);
          return (
            <Tile
              key={i}
              index={i}
              label={stream?.name ?? `Box ${i + 1}`}
              url={stream?.url ?? ''}
              muted={audioBox !== i}
              serverLevels={levels[i] ?? null}
              relay={relays[i] ?? null}
              onToggleAudio={() => setAudioBox((a) => (a === i ? null : i))}
              captions={!!stream && !!captions[stream.url]}
              onToggleCaptions={() => stream && setCaptions((c) => saveCaptions({ ...c, [stream.url]: !c[stream.url] }))}
            />
          );
        })}
      </main>
    </div>
  );
}
