import { hasNextSnippetField, hasPrevSnippetField, type CompletionContext } from '@codemirror/autocomplete';
import { redoDepth, undoDepth } from '@codemirror/commands';
import { StreamLanguage } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePrefersDark } from '../hooks';
import {
  SCRIPTS,
  bibitemsIn,
  continueItem,
  indentItems,
  labelsIn,
  missingPackages,
  outdentItems,
  toggleCommand,
  toggleList,
  type Package,
} from '../latexCommands';
import { EMPTY_CONTEXT, contextAt, type FormatContext } from '../latexContext';
import EditorToolbar from './EditorToolbar';

const latex = StreamLanguage.define(stex);

const BASE_FONT_PX = 13.5;
const ZOOM_KEY = 'la-tex.editorZoom';
const clampZoom = (z: number) => Math.min(2.5, Math.max(0.5, +z.toFixed(2)));

function loadZoom(): number {
  try {
    const z = Number(localStorage.getItem(ZOOM_KEY));
    return z > 0 ? clampZoom(z) : 1;
  } catch {
    return 1;
  }
}

interface ToolbarState {
  ctx: FormatContext;
  canUndo: boolean;
  canRedo: boolean;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onCompile: () => void;
  /** Scroll to and select this line; `nonce` lets the same line be requested twice. */
  jumpTo: { line: number; nonce: number } | null;
  /** Citation keys from the project's .bib files, for `\cite{` completion. */
  loadCiteKeys: () => Promise<string[]>;
}

export default function CodeEditor({ value, onChange, onCompile, jumpTo, loadCiteKeys }: Props) {
  const dark = usePrefersDark();
  const viewRef = useRef<EditorView | null>(null);
  const pendingJump = useRef(jumpTo);
  const [zoom, setZoomState] = useState(loadZoom);
  const [toolbar, setToolbar] = useState<ToolbarState>({ ctx: EMPTY_CONTEXT, canUndo: false, canRedo: false });
  const [linkRequest, setLinkRequest] = useState(0);
  const [missing, setMissing] = useState<Package[]>([]);
  const dismissed = useRef(new Set<Package>());
  const citeKeys = useRef<Promise<string[]> | null>(null);
  const setZoom = (z: number) => {
    const next = clampZoom(z);
    setZoomState(next);
    try {
      localStorage.setItem(ZOOM_KEY, String(next));
    } catch {
      // Not persisted (private window, blocked storage); the size still applies to this session.
    }
  };
  const handlers = useRef({ onCompile, zoom, setZoom, loadCiteKeys });
  handlers.current = { onCompile, zoom, setZoom, loadCiteKeys };

  const keys = useMemo(() => {
    const zoomBy = (delta: number) => () => {
      const h = handlers.current;
      h.setZoom(delta ? h.zoom + delta : 1);
      return true;
    };
    const mod = (key: string, run: (view: EditorView) => boolean) => ({ key, preventDefault: true, run });
    return Prec.highest(
      keymap.of([
        mod('Mod-Enter', () => (handlers.current.onCompile(), true)),
        mod('Mod-b', (v) => toggleCommand(v, 'textbf')),
        mod('Mod-i', (v) => toggleCommand(v, 'textit')),
        mod('Mod-u', (v) => toggleCommand(v, 'underline')),
        mod('Mod-Shift-x', (v) => toggleCommand(v, 'sout', ['ulem'])),
        mod('Mod-,', (v) => toggleCommand(v, 'textsubscript', [], SCRIPTS)),
        mod('Mod-.', (v) => toggleCommand(v, 'textsuperscript', [], SCRIPTS)),
        mod('Mod-k', () => (setLinkRequest((n) => n + 1), true)),
        mod('Mod-Shift-7', (v) => toggleList(v, 'enumerate')),
        mod('Mod-Shift-8', (v) => toggleList(v, 'itemize')),
        mod('Mod-=', zoomBy(0.1)),
        mod('Mod-+', zoomBy(0.1)),
        mod('Mod--', zoomBy(-0.1)),
        mod('Mod-0', zoomBy(0)),
        // These fall through to the default Enter/Tab when they don't apply.
        { key: 'Enter', run: continueItem },
        { key: 'Tab', run: (v) => !hasNextSnippetField(v.state) && indentItems(v) },
        { key: 'Shift-Tab', run: (v) => !hasPrevSnippetField(v.state) && outdentItems(v) },
      ]),
    );
  }, []);

  // Keep the toolbar in step with the formatting at the cursor (at most once per frame).
  const tracker = useMemo(() => {
    let frame = 0;
    return EditorView.updateListener.of((update) => {
      for (const tr of update.transactions) {
        for (const e of tr.effects) {
          if (!e.is(missingPackages)) continue;
          const fresh = e.value.filter((p) => !dismissed.current.has(p));
          if (fresh.length) setMissing((m) => [...new Set([...m, ...fresh])]);
        }
      }
      if (!update.docChanged && !update.selectionSet && frame) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const { state } = update.view;
        setToolbar({ ctx: contextAt(state), canUndo: undoDepth(state) > 0, canRedo: redoDepth(state) > 0 });
      });
    });
  }, []);

  // Complete label names in \ref{…} and citation keys in \cite{…}.
  const completions = useMemo(
    () =>
      latex.data.of({
        autocomplete: async (context: CompletionContext) => {
          const match = context.matchBefore(/\\([a-zA-Z]*(?:ref|cite[a-zA-Z]*))\*?(?:\[[^\]]*\])*\{[^{}]*$/);
          if (!match) return null;
          const name = /^\\([a-zA-Z]*)/.exec(match.text)![1];
          if (name === 'href') return null;
          const cite = name.includes('cite');
          const doc = context.state.doc.toString();
          let options = labelsIn(doc);
          if (cite) {
            citeKeys.current ??= handlers.current.loadCiteKeys().catch(() => []);
            options = [...new Set([...bibitemsIn(doc), ...(await citeKeys.current)])];
          }
          const from = match.from + Math.max(match.text.lastIndexOf('{'), match.text.lastIndexOf(',')) + 1;
          const start = from + /^\s*/.exec(context.state.sliceDoc(from, context.pos))![0].length;
          return {
            from: start,
            options: options.map((label) => ({ label, type: cite ? 'text' : 'variable' })),
            validFor: /^[^,{}\s]*$/,
          };
        },
      }),
    [],
  );

  // The font size is part of the editor theme so CodeMirror re-measures line heights when it changes.
  const extensions = useMemo(
    () => [
      latex,
      EditorView.lineWrapping,
      keys,
      tracker,
      completions,
      EditorView.theme({ '&': { fontSize: `${BASE_FONT_PX * zoom}px` } }),
    ],
    [keys, tracker, completions, zoom],
  );

  const applyJump = () => {
    const view = viewRef.current;
    const target = pendingJump.current;
    if (!view || !target) return;
    pendingJump.current = null;
    const line = view.state.doc.line(Math.min(Math.max(target.line, 1), view.state.doc.lines));
    view.dispatch({
      selection: { anchor: line.from, head: line.to },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
    view.focus();
  };

  useEffect(() => {
    pendingJump.current = jumpTo;
    applyJump();
  }, [jumpTo]);

  return (
    <>
      <EditorToolbar
        getView={() => viewRef.current}
        {...toolbar}
        zoom={zoom}
        onZoom={setZoom}
        linkRequest={linkRequest}
        missing={missing}
        onDismissMissing={() => {
          for (const p of missing) dismissed.current.add(p);
          setMissing([]);
        }}
      />
      <CodeMirror
        className="code-editor"
        value={value}
        height="100%"
        theme={dark ? 'dark' : 'light'}
        extensions={extensions}
        onChange={onChange}
        onCreateEditor={(view) => {
          viewRef.current = view;
          setToolbar({ ctx: contextAt(view.state), canUndo: false, canRedo: false });
          applyJump();
        }}
      />
    </>
  );
}
