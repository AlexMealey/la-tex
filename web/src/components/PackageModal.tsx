import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Job, type PackageState, type PackageView } from '../api';
import { useAuth } from '../auth';
import Modal from './Modal';

interface Props {
  onClose: () => void;
  /** Start installing these straight away (from a "missing package" banner). */
  autoInstall?: string[];
  onJobFinished?: (job: Job) => void;
}

const STATUS_LABEL: Record<PackageView['status'], string> = {
  base: 'Built in',
  user: 'Installed',
  available: '',
};

export default function PackageModal({ onClose, autoInstall, onJobFinished }: Props) {
  // Packages go into one tree shared by every user, so only admins change it.
  const canInstall = useAuth().user.isAdmin;
  const [tab, setTab] = useState<'search' | 'installed'>(autoInstall && canInstall ? 'installed' : 'search');
  const [query, setQuery] = useState(!canInstall && autoInstall?.length ? autoInstall[0] : '');
  const [results, setResults] = useState<PackageView[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [state, setState] = useState<PackageState | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const autoStarted = useRef(false);
  const busy = job?.status === 'queued' || job?.status === 'running';

  const loadState = useCallback(() => {
    api.packageState().then(setState, (err: Error) => setError(err.message));
  }, []);
  useEffect(loadState, [loadState]);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults(null);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      setResults(await api.searchPackages(q));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => runSearch(query), 300);
    return () => window.clearTimeout(timer);
  }, [query, runSearch]);

  const start = useCallback(async (action: Job['action'], names: string[]) => {
    setError(null);
    try {
      setJob(action === 'install' ? await api.installPackages(names) : await api.removePackage(names[0]));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (canInstall && autoInstall?.length && !autoStarted.current) {
      autoStarted.current = true;
      start('install', autoInstall);
    }
  }, [canInstall, autoInstall, start]);

  // Poll the running job; refresh lists when it finishes.
  useEffect(() => {
    if (!job) return;
    if (!busy) {
      loadState();
      runSearch(query);
      onJobFinished?.(job);
      return;
    }
    const timer = window.setTimeout(() => {
      api.getJob(job.id).then(setJob, (err: Error) => setError(err.message));
    }, 1000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [job?.log]);

  const row = (p: PackageView) => (
    <li key={p.name} className="package-row">
      <div className="package-info">
        <strong>{p.name}</strong>
        {p.category && p.category !== 'Package' && <span className="tag">{p.category}</span>}
        <small>{p.shortdesc}</small>
        {p.status === 'available' && !p.installable && <small className="warn-text">{p.reason}</small>}
      </div>
      <div className="package-action">
        {p.status !== 'available' && <span className={`tag ${p.status}`}>{STATUS_LABEL[p.status]}</span>}
        {canInstall && p.status === 'available' && p.installable && (
          <button className="btn small primary" disabled={busy} onClick={() => start('install', [p.name])}>
            Install
          </button>
        )}
        {p.status === 'available' && !p.installable && <span className="tag warn">Needs image rebuild</span>}
        {canInstall && p.status === 'user' && tab === 'installed' && (
          <button className="btn small" disabled={busy} onClick={() => start('remove', [p.name])}>
            Remove
          </button>
        )}
      </div>
    </li>
  );

  return (
    <Modal title="TeX Live packages" onClose={onClose} wide>
      <div className="tabs">
        <button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>
          Search
        </button>
        <button className={tab === 'installed' ? 'active' : ''} onClick={() => setTab('installed')}>
          Installed{state ? ` (${state.installed.length})` : ''}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}
      {!canInstall && (
        <div className="banner info">
          {autoInstall?.length
            ? `Ask an admin to install ${autoInstall.join(', ')}: only admins can add packages.`
            : 'Only admins can install or remove packages. Ask an admin for the ones you need.'}
        </div>
      )}

      {tab === 'search' && (
        <div className="stack">
          <input
            autoFocus
            type="search"
            placeholder="Search CTAN packages, e.g. lipsum, moderncv, tikz…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searching && !results && (
            <p className="muted">Loading the TeX Live package index (the first search downloads it, ~3 MB)…</p>
          )}
          {results && results.length === 0 && !searching && <p className="muted">No packages match “{query}”.</p>}
          {results && <ul className="package-list">{results.map(row)}</ul>}
        </div>
      )}

      {tab === 'installed' && (
        <div className="stack">
          {state && state.missingFromManifest.length > 0 && (
            <div className="banner info">
              <span>
                {state.missingFromManifest.length} package(s) you installed under an earlier TeX Live release are not
                installed in {state.tlYear}: {state.missingFromManifest.join(', ')}.
              </span>
              {canInstall && (
                <button className="btn small" disabled={busy} onClick={() => start('install', state.missingFromManifest)}>
                  Reinstall all
                </button>
              )}
            </div>
          )}
          {state && state.installed.length === 0 && (
            <p className="muted">No extra packages yet. Search for one, or install from a “missing file” message.</p>
          )}
          {state && <ul className="package-list">{state.installed.map(row)}</ul>}
          {state && (
            <p className="muted small">
              Packages are installed into <code>./data/texmf/{state.tlYear}</code> on the host (TeX Live{' '}
              {state.tlYear}, repository <code>{state.repository}</code>).
            </p>
          )}
        </div>
      )}

      {job && (
        <div className="job">
          <div className={`job-status ${job.status}`}>
            {busy && <span className="spinner" />}
            {job.action === 'install' ? 'Installing' : 'Removing'} {job.names.join(', ')} —{' '}
            {job.status === 'success' ? 'done' : job.status === 'error' ? 'failed' : job.status}
          </div>
          <pre className="job-log" ref={logRef}>
            {job.log || 'Waiting for tlmgr…'}
          </pre>
        </div>
      )}
    </Modal>
  );
}
