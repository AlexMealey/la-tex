import { pdfDownloadUrl, zipUrl, type Engine, type ProjectMeta } from '../api';

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'All changes saved',
  saving: 'Saving…',
  unsaved: 'Unsaved changes',
  error: 'Save failed',
};

interface Props {
  project: ProjectMeta;
  saveState: SaveState;
  compiling: boolean;
  hasPdf: boolean;
  onCompile: () => void;
  onClearCache: () => void;
  onEngineChange: (engine: Engine) => void;
  onRename: () => void;
  onOpenPackages: () => void;
}

export default function Toolbar(props: Props) {
  const { project, saveState, compiling, hasPdf } = props;
  return (
    <header className="toolbar">
      <a className="btn ghost" href="#/" title="All projects">
        ← Projects
      </a>
      <button className="project-name" onClick={props.onRename} title="Rename project">
        {project.name}
      </button>
      <span className={`save-state ${saveState}`}>{SAVE_LABEL[saveState]}</span>
      <div className="spacer" />
      <label className="inline-field" title="TeX engine">
        <span>Engine</span>
        <select value={project.engine} onChange={(e) => props.onEngineChange(e.target.value as Engine)}>
          <option value="pdflatex">pdfLaTeX</option>
          <option value="xelatex">XeLaTeX</option>
          <option value="lualatex">LuaLaTeX</option>
        </select>
      </label>
      <button className="btn primary" onClick={props.onCompile} disabled={compiling} title="Compile (Ctrl/⌘ + S or Ctrl/⌘ + Enter)">
        {compiling ? (
          <>
            <span className="spinner" /> Compiling…
          </>
        ) : (
          'Compile'
        )}
      </button>
      <button className="btn" onClick={props.onClearCache} disabled={compiling} title="Delete aux files and recompile">
        Clear cache
      </button>
      <a
        className={`btn${hasPdf ? '' : ' disabled'}`}
        href={hasPdf ? pdfDownloadUrl(project.id) : undefined}
        aria-disabled={!hasPdf}
        title="Download the compiled PDF"
      >
        Download PDF
      </a>
      <a className="btn" href={zipUrl(project.id)} title="Download all project files as a ZIP">
        Source ZIP
      </a>
      <button className="btn" onClick={props.onOpenPackages}>
        Packages
      </button>
    </header>
  );
}
