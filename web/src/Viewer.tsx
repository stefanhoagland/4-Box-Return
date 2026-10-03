import { useEffect, useState } from 'react';
import { Tile } from './Tile';
import { useClock } from './useClock';
import { BOX_COUNT, emptyWall, followWall, streamInBox, type Wall } from './wall';

// The wall screen: four boxes and a clock. Everything is set on the admin
// page and arrives here live.
export function Viewer() {
  const [wall, setWall] = useState<Wall>(emptyWall);
  const [online, setOnline] = useState(true);
  const [audioBox, setAudioBox] = useState<number | null>(null);
  const now = useClock();

  useEffect(() => followWall(setWall, setOnline), []);
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
              onToggleAudio={() => setAudioBox((a) => (a === i ? null : i))}
            />
          );
        })}
      </main>
    </div>
  );
}
