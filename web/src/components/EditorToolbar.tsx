import type { EditorView } from '@codemirror/view';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { HEADINGS, SYMBOL_GROUPS, heading, insertSymbol, link, wrap, wrapEnv } from '../latexCommands';

interface Props {
  getView: () => EditorView | null;
  zoom: number;
  onZoom: (zoom: number) => void;
}

// Keep the editor's focus and selection when a toolbar button is pressed.
const keepFocus = (e: MouseEvent) => e.preventDefault();

export default function EditorToolbar({ getView, zoom, onZoom }: Props) {
  const run = (command: (view: EditorView) => unknown) => () => {
    const view = getView();
    if (view) command(view);
  };

  const button = (label: ReactNode, title: string, command: (view: EditorView) => unknown, className = '') => (
    <button className={`btn small ghost ${className}`} title={title} onMouseDown={keepFocus} onClick={run(command)}>
      {label}
    </button>
  );

  return (
    <div className="editor-toolbar">
      {button(<b>B</b>, 'Bold (Ctrl/⌘ + B)', (v) => wrap(v, '\\textbf{', '}'))}
      {button(<i>I</i>, 'Italic (Ctrl/⌘ + I)', (v) => wrap(v, '\\textit{', '}'))}
      {button(<u>U</u>, 'Underline', (v) => wrap(v, '\\underline{', '}'))}
      {button(<code>TT</code>, 'Monospace', (v) => wrap(v, '\\texttt{', '}'))}
      <span className="toolbar-sep" />
      <select
        className="heading-select"
        value=""
        title="Turn the line or selection into a heading"
        onChange={(e) => {
          const cmd = e.target.value;
          if (cmd) run((v) => heading(v, cmd))();
        }}
      >
        <option value="">Heading</option>
        {HEADINGS.map((h) => (
          <option key={h.cmd} value={h.cmd}>
            {h.label}
          </option>
        ))}
      </select>
      <span className="toolbar-sep" />
      {button('$x$', 'Inline math', (v) => wrap(v, '$', '$'), 'mono')}
      {button('\\[ \\]', 'Display math', (v) => wrap(v, '\\[', '\\]'), 'mono')}
      <SymbolPicker onPick={(tex) => run((v) => insertSymbol(v, tex))()} />
      <span className="toolbar-sep" />
      {button('• List', 'Bulleted list (itemize)', (v) => wrapEnv(v, 'itemize', true))}
      {button('1. List', 'Numbered list (enumerate)', (v) => wrapEnv(v, 'enumerate', true))}
      <span className="toolbar-sep" />
      {button('Footnote', 'Footnote', (v) => wrap(v, '\\footnote{', '}'))}
      {button('Link', 'Hyperlink (\\href, needs hyperref)', link)}
      <div className="spacer" />
      <button
        className="btn small ghost"
        onMouseDown={keepFocus}
        onClick={() => onZoom(zoom - 0.1)}
        title="Smaller text (Ctrl/⌘ + −)"
      >
        −
      </button>
      <button className="btn small ghost" onMouseDown={keepFocus} onClick={() => onZoom(1)} title="Reset text size (Ctrl/⌘ + 0)">
        {Math.round(zoom * 100)}%
      </button>
      <button
        className="btn small ghost"
        onMouseDown={keepFocus}
        onClick={() => onZoom(zoom + 0.1)}
        title="Larger text (Ctrl/⌘ + =)"
      >
        +
      </button>
    </div>
  );
}

function SymbolPicker({ onPick }: { onPick: (tex: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="symbol-picker" ref={rootRef}>
      <button
        className={`btn small ghost${open ? ' active' : ''}`}
        title="Insert a math symbol"
        aria-expanded={open}
        onMouseDown={keepFocus}
        onClick={() => setOpen((o) => !o)}
      >
        Ω ▾
      </button>
      {open && (
        <div className="symbol-popover" role="dialog" aria-label="Symbols">
          {SYMBOL_GROUPS.map((g) => (
            <section key={g.name}>
              <h4>{g.name}</h4>
              <div className="symbol-grid">
                {g.symbols.map((s) => (
                  <button
                    key={s.tex}
                    className="symbol"
                    title={s.tex}
                    onMouseDown={keepFocus}
                    onClick={() => {
                      onPick(s.tex);
                      setOpen(false);
                    }}
                  >
                    {s.char}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
