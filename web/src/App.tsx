import { useEffect, useState } from 'react';
import { Tile } from './Tile';
import { loadWall, saveWall, shareUrl, type TileConfig } from './layout';

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function App() {
  const [wall, setWall] = useState<TileConfig[]>(() => loadWall(window.location.hash));
  const [editing, setEditing] = useState(() => wall.every((t) => !t.url));
  const [audioTile, setAudioTile] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const clock = useClock();

  useEffect(() => saveWall(wall), [wall]);

  const updateTile = (i: number, config: TileConfig) =>
    setWall((w) => w.map((t, j) => (j === i ? config : t)));

  const copyShareLink = async () => {
    const link = shareUrl(wall, window.location.href);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link', link);
    }
  };

  const toggleWallFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>4-Box Return</h1>
        <span className="clock" aria-label="Local time">
          {clock}
        </span>
        <div className="actions">
          <button onClick={() => setEditing((e) => !e)} aria-pressed={editing}>
            {editing ? 'Done' : 'Edit'}
          </button>
          <button onClick={copyShareLink}>{copied ? 'Link copied' : 'Share link'}</button>
          <button onClick={toggleWallFullscreen}>Full screen</button>
        </div>
      </header>
      <main className="wall">
        {wall.map((config, i) => (
          <Tile
            key={i}
            index={i}
            config={config}
            editing={editing}
            muted={audioTile !== i}
            onToggleAudio={() => setAudioTile((a) => (a === i ? null : i))}
            onChange={(c) => updateTile(i, c)}
          />
        ))}
      </main>
    </div>
  );
}
