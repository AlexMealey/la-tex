import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { api, type ProjectMeta } from '../api';
import NewProjectDialog from '../components/NewProjectDialog';
import PackageModal from '../components/PackageModal';
import UserMenu from '../components/UserMenu';
import { navigate } from '../hooks';

const ENGINE_LABEL = { pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' } as const;

export default function ProjectList() {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [packagesOpen, setPackagesOpen] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api.listProjects().then(setProjects, (err: Error) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  async function onImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const project = await api.importProject(file);
      navigate(`/p/${project.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  async function rename(p: ProjectMeta) {
    const name = window.prompt('Rename project', p.name);
    if (!name?.trim() || name === p.name) return;
    await api.updateProject(p.id, { name }).catch((err: Error) => setError(err.message));
    load();
  }

  async function remove(p: ProjectMeta) {
    if (!window.confirm(`Delete “${p.name}” and all its files? This cannot be undone.`)) return;
    await api.deleteProject(p.id).catch((err: Error) => setError(err.message));
    load();
  }

  return (
    <div className="home">
      <header className="home-header">
        <h1>LaTeX Editor</h1>
        <div className="row">
          <button className="btn primary" onClick={() => setCreating(true)}>
            New project
          </button>
          <button className="btn" onClick={() => importRef.current?.click()} disabled={importing}>
            {importing ? 'Importing…' : 'Import ZIP'}
          </button>
          <button className="btn" onClick={() => setPackagesOpen(true)}>
            Packages
          </button>
          <input ref={importRef} type="file" accept=".zip,application/zip" hidden onChange={onImport} />
          <UserMenu />
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      {projects === null && !error && <p className="muted">Loading…</p>}
      {projects?.length === 0 && (
        <div className="empty">
          <p>No projects yet.</p>
          <p className="muted">
            Create one from the <strong>Resume (A4)</strong> template, or import an Overleaf “Download Source” ZIP.
          </p>
        </div>
      )}
      {projects && projects.length > 0 && (
        <table className="project-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Engine</th>
              <th>Last modified</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>
                  <a href={`#/p/${encodeURIComponent(p.id)}`}>{p.name}</a>
                </td>
                <td className="muted">{ENGINE_LABEL[p.engine]}</td>
                <td className="muted">{new Date(p.updatedAt).toLocaleString()}</td>
                <td className="row end">
                  <button className="btn small ghost" onClick={() => rename(p)}>
                    Rename
                  </button>
                  <button className="btn small ghost danger" onClick={() => remove(p)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {creating && (
        <NewProjectDialog onClose={() => setCreating(false)} onCreated={(p) => navigate(`/p/${p.id}`)} />
      )}
      {packagesOpen && <PackageModal onClose={() => setPackagesOpen(false)} />}
    </div>
  );
}
