import { useEffect, useState } from 'react';
import { api, type CompileResult, type LogEntry, type PackageView } from '../api';

interface Props {
  projectId: string;
  result: CompileResult | null;
  compileError: string | null;
  compiling: boolean;
  open: boolean;
  onToggle: () => void;
  /** Whether `file` is a project file that can be opened (null = the main file). */
  canOpen: (file: string | null) => boolean;
  onJump: (file: string | null, line: number) => void;
  onInstall: (names: string[]) => void;
}

type Suggestions = Record<string, PackageView[] | 'loading' | { error: string }>;

export default function LogPanel(props: Props) {
  const { result, compileError, compiling, open } = props;
  const [tab, setTab] = useState<'issues' | 'raw'>('issues');
  const [raw, setRaw] = useState('');
  const [showBoxes, setShowBoxes] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestions>({});

  // Look up which TeX Live package provides each missing file.
  useEffect(() => {
    for (const file of result?.missingFiles ?? []) {
      setSuggestions((prev) => (file in prev ? prev : { ...prev, [file]: 'loading' }));
      api.packagesForFile(file).then(
        (pkgs) => setSuggestions((prev) => ({ ...prev, [file]: pkgs })),
        (err: Error) => setSuggestions((prev) => ({ ...prev, [file]: { error: err.message } })),
      );
    }
  }, [result]);

  useEffect(() => {
    if (open && tab === 'raw') api.getLog(props.projectId).then(setRaw, () => setRaw(''));
  }, [open, tab, result, props.projectId]);

  const errors = result?.errors ?? [];
  const warnings = result?.warnings.filter((w) => w.level === 'warning') ?? [];
  const boxes = result?.warnings.filter((w) => w.level === 'typesetting') ?? [];

  let summary: string;
  let tone: string;
  if (compiling) [summary, tone] = ['Compiling…', 'busy'];
  else if (compileError) [summary, tone] = [compileError, 'error'];
  else if (!result) [summary, tone] = ['Not compiled yet', 'idle'];
  else if (result.status === 'timeout') [summary, tone] = ['Compile timed out', 'error'];
  else if (result.status === 'error') [summary, tone] = [result.pdf ? 'Compiled with errors' : 'Compile failed', 'error'];
  else [summary, tone] = [`Compiled in ${(result.durationMs / 1000).toFixed(1)} s`, 'ok'];

  const entry = (e: LogEntry, i: number) => {
    const jumpable = e.line !== null && props.canOpen(e.file);
    const location = [e.file, e.line].filter((x) => x !== null).join(':');
    return (
      <li key={i}>
        <button
          className={`log-entry ${e.level}`}
          disabled={!jumpable}
          onClick={() => jumpable && props.onJump(e.file, e.line!)}
          title={jumpable ? 'Go to line' : undefined}
        >
          {location && <span className="log-location">{location}</span>}
          <pre className="log-message">{e.message}</pre>
        </button>
      </li>
    );
  };

  const missingBanner = (file: string) => {
    const s = suggestions[file];
    return (
      <li key={file} className="missing">
        <div>
          <code>{file}</code> was not found.{' '}
          {s === 'loading' && <span className="muted">Looking up the package…</span>}
          {s && typeof s === 'object' && 'error' in s && <span className="muted">Package lookup failed: {s.error}</span>}
          {Array.isArray(s) && s.length === 0 && (
            <span className="muted">No TeX Live package provides it — upload it to the project if it is your own file.</span>
          )}
        </div>
        {Array.isArray(s) &&
          s.map((p) => (
            <div key={p.name} className="missing-package">
              <span>
                Package <strong>{p.name}</strong> <span className="muted">— {p.shortdesc}</span>
              </span>
              {p.status === 'available' && p.installable && (
                <button className="btn small primary" onClick={() => props.onInstall([p.name])}>
                  Install {p.name}
                </button>
              )}
              {p.status === 'available' && !p.installable && <span className="warn-text small">{p.reason}</span>}
              {p.status !== 'available' && <span className="tag">Already installed</span>}
            </div>
          ))}
      </li>
    );
  };

  return (
    <section className={`log-panel${open ? ' open' : ''}`}>
      <button className={`log-bar ${tone}`} onClick={props.onToggle}>
        {compiling && <span className="spinner" />}
        <span className="log-summary">{summary}</span>
        {result && !compiling && (
          <>
            <span className={`pill${errors.length ? ' error' : ''}`}>{errors.length} errors</span>
            <span className={`pill${warnings.length ? ' warn' : ''}`}>{warnings.length} warnings</span>
            {boxes.length > 0 && <span className="pill">{boxes.length} layout</span>}
            {result.missingFiles.length > 0 && <span className="pill error">missing: {result.missingFiles.join(', ')}</span>}
          </>
        )}
        <span className="spacer" />
        <span className="muted">{open ? '▾ Hide log' : '▴ Show log'}</span>
      </button>
      {open && (
        <div className="log-body">
          <div className="tabs">
            <button className={tab === 'issues' ? 'active' : ''} onClick={() => setTab('issues')}>
              Issues
            </button>
            <button className={tab === 'raw' ? 'active' : ''} onClick={() => setTab('raw')}>
              Raw log
            </button>
          </div>
          {tab === 'issues' ? (
            <ul className="log-list">
              {result?.missingFiles.map(missingBanner)}
              {errors.map(entry)}
              {warnings.map(entry)}
              {boxes.length > 0 &&
                (showBoxes ? (
                  boxes.map(entry)
                ) : (
                  <li>
                    <button className="link" onClick={() => setShowBoxes(true)}>
                      Show {boxes.length} overfull/underfull box warnings
                    </button>
                  </li>
                ))}
              {result && !errors.length && !warnings.length && !boxes.length && !result.missingFiles.length && (
                <li className="muted">No errors or warnings.</li>
              )}
            </ul>
          ) : (
            <pre className="raw-log">{raw || 'No log yet.'}</pre>
          )}
        </div>
      )}
    </section>
  );
}
