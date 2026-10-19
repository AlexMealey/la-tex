import { StreamLanguage } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useEffect, useMemo, useRef } from 'react';
import { usePrefersDark } from '../hooks';

const latex = StreamLanguage.define(stex);

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
  const handlers = useRef({ onCompile });
  handlers.current = { onCompile };

  const extensions = useMemo(
    () => [
      latex,
      EditorView.lineWrapping,
      Prec.highest(
        keymap.of([
          { key: 'Mod-Enter', preventDefault: true, run: () => (handlers.current.onCompile(), true) },
        ]),
      ),
    ],
    [],
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
  );
}
