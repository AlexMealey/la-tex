import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  api,
  fileUrl,
  pdfUrl,
  type CompileResult,
  type Engine,
  type FileEntry,
  type Job,
  type ProjectDetail,
} from '../api';
import CodeEditor from '../components/CodeEditor';
import FileTree from '../components/FileTree';
import LogPanel from '../components/LogPanel';
import PackageModal from '../components/PackageModal';
import PdfPreview from '../components/PdfPreview';
import Toolbar, { type SaveState } from '../components/Toolbar';

interface OpenFile {
  path: string;
  editable: boolean;
  content: string;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp)$/i;
const AUTOSAVE_MS = 1000;

export default function EditorPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenFile | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [compiling, setCompiling] = useState(false);
  const [result, setResult] = useState<CompileResult | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [pdfVersion, setPdfVersion] = useState<number | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [packageModal, setPackageModal] = useState<{ install?: string[] } | null>(null);
  const [jumpTo, setJumpTo] = useState<{ line: number; nonce: number } | null>(null);
  const [split, setSplit] = useState(50);

  const projectRef = useRef(project);
  projectRef.current = project;
  const openRef = useRef(open);
  const savedContent = useRef('');
  const saveTimer = useRef<number | undefined>(undefined);
  const compilingRef = useRef(false);
  const splitRef = useRef<HTMLDivElement>(null);

  const fail = (err: unknown) => setActionError((err as Error).message);

  const refresh = useCallback(async () => {
    const p = await api.getProject(projectId);
    setProject(p);
    return p;
  }, [projectId]);

  const save = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    const file = openRef.current;
    if (!file?.editable || file.content === savedContent.current) return;
    const content = file.content;
    setSaveState('saving');
    try {
      await api.writeFile(projectId, file.path, content);
      if (openRef.current?.path === file.path) {
        savedContent.current = content;
        setSaveState(openRef.current.content === content ? 'saved' : 'unsaved');
      }
    } catch (err) {
      setSaveState('error');
      throw err;
    }
  }, [projectId]);

  const setOpenFile = (file: OpenFile | null) => {
    openRef.current = file;
    setOpen(file);
  };

  const openFile = useCallback(
    async (path: string, files?: FileEntry[]) => {
      await save().catch(fail);
      const entry = (files ?? projectRef.current?.files)?.find((f) => f.path === path);
      const editable = entry?.editable ?? true;
      const content = editable ? await api.readFile(projectId, path) : '';
      savedContent.current = content;
      setOpenFile({ path, editable, content });
      setSaveState('saved');
    },
    [projectId, save],
  );

  const compile = useCallback(async () => {
    if (compilingRef.current) return;
    compilingRef.current = true;
    setCompiling(true);
    setCompileError(null);
    try {
      await save();
      const r = await api.compile(projectId);
      setResult(r);
      if (r.pdf) setPdfVersion(r.compiledAt);
      if (r.status !== 'success') setLogOpen(true);
    } catch (err) {
      setCompileError((err as Error).message);
      setLogOpen(true);
    } finally {
      compilingRef.current = false;
      setCompiling(false);
    }
  }, [projectId, save]);

  // Load the project, open the main file and compile it.
  useEffect(() => {
    refresh()
      .then(async (p) => {
        const first = p.files.find((f) => f.path === p.mainFile) ?? p.files.find((f) => f.editable);
        if (first) await openFile(first.path, p.files);
        compile();
      })
      .catch((err: Error) => setLoadError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Save on tab close; warn if that might not finish.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (openRef.current && openRef.current.content !== savedContent.current) {
        save().catch(() => {});
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [save]);

  // Leaving the editor (e.g. back to the project list): flush pending edits.
  useEffect(() => () => void save().catch(() => {}), [save]);

  const onChange = useCallback(
    (content: string) => {
      if (!openRef.current) return;
      setOpenFile({ ...openRef.current, content });
      setSaveState(content === savedContent.current ? 'saved' : 'unsaved');
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => save().catch(() => {}), AUTOSAVE_MS);
    },
    [save],
  );

  const saveNow = useCallback(() => {
    save().catch(fail);
  }, [save]);

  // Ctrl/⌘+S anywhere on the page: save and recompile (just save if a compile is running).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      if (compilingRef.current) saveNow();
      else compile();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [compile, saveNow]);

  // File operations -------------------------------------------------------

  const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

  async function createFile(folder: string) {
    const name = window.prompt('New file name', 'chapter.tex')?.trim();
    if (!name) return;
    const path = join(folder, name);
    try {
      await api.writeFile(projectId, path, '');
      const p = await refresh();
      await openFile(path, p.files);
    } catch (err) {
      fail(err);
    }
  }

  async function createFolder(folder: string) {
    const name = window.prompt('New folder name')?.trim();
    if (!name) return;
    await api.createFolder(projectId, join(folder, name)).catch(fail);
    await refresh();
  }

  async function rename(from: string) {
    const to = window.prompt('Rename or move to (path from the project root)', from)?.trim();
    if (!to || to === from) return;
    try {
      await save();
      const { path } = await api.renameFile(projectId, from, to);
      await refresh();
      const current = openRef.current;
      if (current && (current.path === from || current.path.startsWith(`${from}/`))) {
        setOpenFile({ ...current, path: path + current.path.slice(from.length) });
      }
    } catch (err) {
      fail(err);
    }
  }

  async function remove(path: string) {
    if (!window.confirm(`Delete ${path}?`)) return;
    try {
      await api.deleteFile(projectId, path);
      const p = await refresh();
      const current = openRef.current;
      if (current && (current.path === path || current.path.startsWith(`${path}/`))) {
        const main = p.files.find((f) => f.path === p.mainFile);
        savedContent.current = '';
        setOpenFile(null);
        if (main) await openFile(main.path, p.files);
      }
    } catch (err) {
      fail(err);
    }
  }

  async function setMain(path: string) {
    await api.updateProject(projectId, { mainFile: path }).catch(fail);
    await refresh();
  }

  async function upload(folder: string, files: File[]) {
    try {
      await api.uploadFiles(projectId, folder, files);
      await refresh();
    } catch (err) {
      fail(err);
    }
  }

  async function changeEngine(engine: Engine) {
    try {
      await api.updateProject(projectId, { engine });
      await refresh();
      compile();
    } catch (err) {
      fail(err);
    }
  }

  async function renameProject() {
    const name = window.prompt('Rename project', project?.name)?.trim();
    if (!name) return;
    await api.updateProject(projectId, { name }).catch(fail);
    await refresh();
  }

  async function clearCache() {
    try {
      await api.clearBuild(projectId);
      setPdfVersion(null);
      await compile();
    } catch (err) {
      fail(err);
    }
  }

  const canOpen = useCallback(
    (file: string | null) => file === null || !!projectRef.current?.files.some((f) => f.path === file && f.editable),
    [],
  );

  async function jump(file: string | null, line: number) {
    const target = file ?? projectRef.current?.mainFile;
    if (target && target !== openRef.current?.path) await openFile(target).catch(fail);
    setJumpTo({ line, nonce: Date.now() });
  }

  const onPackageJobFinished = useCallback(
    (job: Job) => {
      if (job.status === 'success' && job.action === 'install') {
        setPackageModal((m) => (m?.install ? null : m));
        compile();
      }
    },
    [compile],
  );

  // Draggable divider between editor and PDF.
  function startDrag(e: PointerEvent<HTMLDivElement>) {
    const container = splitRef.current;
    if (!container) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = container.getBoundingClientRect();
    const move = (ev: globalThis.PointerEvent) =>
      setSplit(Math.min(80, Math.max(20, ((ev.clientX - rect.left) / rect.width) * 100)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  if (loadError) {
    return (
      <div className="home">
        <div className="banner error">{loadError}</div>
        <a href="#/">← Back to projects</a>
      </div>
    );
  }
  if (!project) return <div className="placeholder">Loading project…</div>;

  return (
    <div className="editor-page">
      <Toolbar
        project={project}
        saveState={saveState}
        compiling={compiling}
        hasPdf={pdfVersion !== null}
        onCompile={compile}
        onClearCache={clearCache}
        onEngineChange={changeEngine}
        onRename={renameProject}
        onOpenPackages={() => setPackageModal({})}
      />
      {actionError && (
        <div className="banner error dismissible">
          {actionError}
          <button className="btn ghost small" onClick={() => setActionError(null)}>
            Dismiss
          </button>
        </div>
      )}
      <div className="workspace">
        <aside className="sidebar">
          <FileTree
            files={project.files}
            activePath={open?.path ?? null}
            mainFile={project.mainFile}
            onOpen={(p) => openFile(p).catch(fail)}
            onCreateFile={createFile}
            onCreateFolder={createFolder}
            onRename={rename}
            onDelete={remove}
            onSetMain={setMain}
            onUpload={upload}
          />
        </aside>
        <div className="split" ref={splitRef}>
          <section className="editor-pane" style={{ flexBasis: `${split}%` }}>
            {open && <div className="pane-title">{open.path}</div>}
            {!open && <div className="placeholder">Select a file to edit.</div>}
            {open?.editable && (
              <CodeEditor
                key={open.path}
                value={open.content}
                onChange={onChange}
                onCompile={compile}
                jumpTo={jumpTo}
              />
            )}
            {open && !open.editable && (
              <div className="binary-preview">
                {IMAGE_EXT.test(open.path) ? (
                  <img src={fileUrl(projectId, open.path)} alt={open.path} />
                ) : (
                  <p className="muted">This file can't be edited here.</p>
                )}
                <a className="btn" href={fileUrl(projectId, open.path)} download>
                  Download {open.path.split('/').pop()}
                </a>
              </div>
            )}
          </section>
          <div className="divider" onPointerDown={startDrag} role="separator" aria-orientation="vertical" />
          <section className="pdf-pane">
            <PdfPreview url={pdfVersion !== null ? pdfUrl(projectId, pdfVersion) : null} />
          </section>
        </div>
      </div>
      <LogPanel
        projectId={projectId}
        result={result}
        compileError={compileError}
        compiling={compiling}
        open={logOpen}
        onToggle={() => setLogOpen((o) => !o)}
        canOpen={canOpen}
        onJump={jump}
        onInstall={(names) => setPackageModal({ install: names })}
      />
      {packageModal && (
        <PackageModal
          onClose={() => setPackageModal(null)}
          autoInstall={packageModal.install}
          onJobFinished={onPackageJobFinished}
        />
      )}
    </div>
  );
}
