import { useCallback, useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { PLATFORM_LABEL, parseSource } from './sources';
import { BOX_COUNT, fetchWall, newId, parseImport, saveWall, type Stream, type Wall } from './wall';

type SaveState = 'loading' | 'saved' | 'saving' | 'error';

function platformOf(url: string): string {
  const s = parseSource(url);
  if (s.kind === 'empty') return '';
  const label = PLATFORM_LABEL[s.platform];
  return s.kind === 'unsupported' ? `${label} (not playable yet)` : label;
}

// A text field that only reports its value on Enter or when it loses focus,
// so viewers are not reloaded on every keystroke.
function CommitInput({
  value,
  onCommit,
  ...rest
}: { value: string; onCommit: (v: string) => void } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange'
>) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft.trim());
  };
  return (
    <input
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}

export function Admin() {
  const [wall, setWall] = useState<Wall | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState('');
  const saveSeq = useRef(0);

  useEffect(() => {
    document.title = '4-Box Return admin';
    fetchWall()
      .then((w) => {
        setWall(w);
        setSaveState('saved');
      })
      .catch((e: Error) => {
        setError(`Could not load the wall: ${e.message}`);
        setSaveState('error');
      });
  }, []);

  const update = useCallback((next: Wall) => {
    setWall(next);
    setSaveState('saving');
    const seq = ++saveSeq.current;
    saveWall(next)
      .then((saved) => {
        if (seq === saveSeq.current) {
          // The server may rewrite links, e.g. YouTube @handles to channel links.
          setWall(saved);
          setSaveState('saved');
          setError('');
        }
      })
      .catch((e: Error) => {
        if (seq === saveSeq.current) {
          setSaveState('error');
          setError(e.message);
        }
      });
  }, []);

  if (!wall) {
    return (
      <div className="admin">
        <p className="admin-note">{error || 'Loading…'}</p>
      </div>
    );
  }

  const setBox = (box: number, id: string) =>
    update({ ...wall, boxes: wall.boxes.map((b, i) => (i === box ? id || null : b)) });

  const editStream = (id: string, patch: Partial<Stream>) =>
    update({ ...wall, streams: wall.streams.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  const deleteStream = (id: string) =>
    update({
      ...wall,
      streams: wall.streams.filter((s) => s.id !== id),
      boxes: wall.boxes.map((b) => (b === id ? null : b)),
    });

  const addStream = (e: FormEvent) => {
    e.preventDefault();
    const url = newUrl.trim();
    if (!url) return;
    update({ ...wall, streams: [...wall.streams, { id: newId(), name: newName.trim() || url, url }] });
    setNewName('');
    setNewUrl('');
  };

  const runImport = () => {
    const { streams, skipped } = parseImport(importText);
    const known = new Set(wall.streams.map((s) => s.url));
    const fresh = streams.filter((s) => !known.has(s.url));
    const dupes = streams.length - fresh.length;
    if (fresh.length) update({ ...wall, streams: [...wall.streams, ...fresh.map((s) => ({ ...s, id: newId() }))] });
    const parts = [`Added ${fresh.length} stream${fresh.length === 1 ? '' : 's'}`];
    if (dupes) parts.push(`${dupes} already in the list`);
    if (skipped) parts.push(`${skipped} line${skipped === 1 ? '' : 's'} without a link skipped`);
    setImportResult(parts.join(', ') + '.');
    if (fresh.length) setImportText('');
  };

  const statusText: Record<SaveState, string> = {
    loading: 'Loading…',
    saving: 'Saving…',
    saved: 'All changes saved',
    error: `Not saved: ${error}`,
  };

  return (
    <div className="admin">
      <header className="admin-header">
        <h1>4-Box Return admin</h1>
        <span className={`save-state save-${saveState}`}>{statusText[saveState]}</span>
        <a className="button" href="/" target="_blank" rel="noreferrer">
          Open viewer
        </a>
      </header>

      <section className="admin-section">
        <h2>Wall title</h2>
        <CommitInput
          className="title-input"
          aria-label="Wall title"
          value={wall.title}
          onCommit={(title) => update({ ...wall, title: title || '4-Box Return' })}
        />
      </section>

      <section className="admin-section">
        <h2>Boxes</h2>
        <p className="admin-note">Choose what each box shows. Viewers update straight away.</p>
        <div className="box-grid">
          {Array.from({ length: BOX_COUNT }, (_, i) => {
            const current = wall.streams.find((s) => s.id === wall.boxes[i]);
            return (
              <label key={i} className="box-card">
                <span className="box-card-title">Box {i + 1}</span>
                <select value={current?.id ?? ''} onChange={(e) => setBox(i, e.target.value)}>
                  <option value="">Empty</option>
                  {wall.streams.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <span className="box-card-platform">{current ? platformOf(current.url) : 'Nothing assigned'}</span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="admin-section">
        <h2>Streams ({wall.streams.length})</h2>
        {wall.streams.length === 0 ? (
          <p className="admin-note">No streams yet. Add one below or paste a list into Import.</p>
        ) : (
          <table className="stream-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Link</th>
                <th>Platform</th>
                <th>In box</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {wall.streams.map((s) => {
                const inBoxes = wall.boxes.flatMap((b, i) => (b === s.id ? [i + 1] : []));
                return (
                  <tr key={s.id}>
                    <td>
                      <CommitInput
                        aria-label="Stream name"
                        value={s.name}
                        onCommit={(name) => editStream(s.id, { name: name || s.url })}
                      />
                    </td>
                    <td>
                      <CommitInput
                        aria-label="Stream link"
                        value={s.url}
                        onCommit={(url) => url && editStream(s.id, { url })}
                      />
                    </td>
                    <td className="platform-cell">{platformOf(s.url)}</td>
                    <td className="platform-cell">{inBoxes.join(', ')}</td>
                    <td>
                      <button
                        className="danger"
                        onClick={() => {
                          if (!inBoxes.length || confirm(`Remove "${s.name}"? It is showing in box ${inBoxes.join(', ')}.`))
                            deleteStream(s.id);
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <form className="add-stream" onSubmit={addStream}>
          <input placeholder="Name (optional)" aria-label="New stream name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input
            placeholder="YouTube, Facebook, X, Kaltura or .m3u8 link"
            aria-label="New stream link"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
          />
          <button type="submit" disabled={!newUrl.trim()}>
            Add stream
          </button>
        </form>
      </section>

      <section className="admin-section">
        <h2>Import</h2>
        <p className="admin-note">
          Paste one stream per line, as <code>Name, link</code>, <code>Name | link</code> or just the link. Links already
          in the list are skipped.
        </p>
        <textarea
          aria-label="Streams to import"
          rows={6}
          value={importText}
          placeholder={'Main stage, https://www.youtube.com/watch?v=...\nOverflow | https://www.facebook.com/.../videos/...\nkaltura:1234567/45678901/1_abcd1234'}
          onChange={(e) => setImportText(e.target.value)}
        />
        <div className="import-actions">
          <button onClick={runImport} disabled={!importText.trim()}>
            Import
          </button>
          {importResult && <span className="admin-note">{importResult}</span>}
        </div>
      </section>
    </div>
  );
}
