import { StreamLanguage } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePrefersDark } from '../hooks';
import { wrap } from '../latexCommands';
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

interface Props {
  value: string;
  onChange: (value: string) => void;
  onCompile: () => void;
  /** Scroll to and select this line; `nonce` lets the same line be requested twice. */
  jumpTo: { line: number; nonce: number } | null;
}

export default function CodeEditor({ value, onChange, onCompile, jumpTo }: Props) {
  const dark = usePrefersDark();
  const viewRef = useRef<EditorView | null>(null);
  const pendingJump = useRef(jumpTo);
  const [zoom, setZoomState] = useState(loadZoom);
  const setZoom = (z: number) => {
    const next = clampZoom(z);
    setZoomState(next);
    try {
      localStorage.setItem(ZOOM_KEY, String(next));
    } catch {
      // Not persisted (private window, blocked storage); the size still applies to this session.
    }
  };
  const handlers = useRef({ onCompile, zoom, setZoom });
  handlers.current = { onCompile, zoom, setZoom };

  const keys = useMemo(() => {
    const zoomBy = (delta: number) => () => {
      const h = handlers.current;
      h.setZoom(delta ? h.zoom + delta : 1);
      return true;
    };
    return Prec.highest(
      keymap.of([
        { key: 'Mod-Enter', preventDefault: true, run: () => (handlers.current.onCompile(), true) },
        { key: 'Mod-b', preventDefault: true, run: (v) => wrap(v, '\\textbf{', '}') },
        { key: 'Mod-i', preventDefault: true, run: (v) => wrap(v, '\\textit{', '}') },
        { key: 'Mod-=', preventDefault: true, run: zoomBy(0.1) },
        { key: 'Mod-+', preventDefault: true, run: zoomBy(0.1) },
        { key: 'Mod--', preventDefault: true, run: zoomBy(-0.1) },
        { key: 'Mod-0', preventDefault: true, run: zoomBy(0) },
      ]),
    );
  }, []);

  // The font size is part of the editor theme so CodeMirror re-measures line heights when it changes.
  const extensions = useMemo(
    () => [latex, EditorView.lineWrapping, keys, EditorView.theme({ '&': { fontSize: `${BASE_FONT_PX * zoom}px` } })],
    [keys, zoom],
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
      <EditorToolbar getView={() => viewRef.current} zoom={zoom} onZoom={setZoom} />
      <CodeMirror
        className="code-editor"
        value={value}
        height="100%"
        theme={dark ? 'dark' : 'light'}
        extensions={extensions}
        onChange={onChange}
        onCreateEditor={(view) => {
          viewRef.current = view;
          applyJump();
        }}
      />
    </>
  );
}
