import { EditorSelection, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

function apply(view: EditorView, spec: TransactionSpec): boolean {
  view.dispatch({ ...spec, scrollIntoView: true, userEvent: 'input' });
  view.focus();
  return true;
}

/** Wrap each selection in `before…after`, or unwrap it if it is already wrapped. */
export function wrap(view: EditorView, before: string, after: string): boolean {
  const { state } = view;
  return apply(
    view,
    state.changeByRange(({ from, to }) => {
      const wrappedOutside =
        from >= before.length &&
        state.sliceDoc(from - before.length, from) === before &&
        state.sliceDoc(to, to + after.length) === after;
      if (wrappedOutside) {
        return {
          changes: [
            { from: from - before.length, to: from },
            { from: to, to: to + after.length },
          ],
          range: EditorSelection.range(from - before.length, to - before.length),
        };
      }
      const text = state.sliceDoc(from, to);
      if (text.length >= before.length + after.length && text.startsWith(before) && text.endsWith(after)) {
        return {
          changes: [
            { from, to: from + before.length },
            { from: to - after.length, to },
          ],
          range: EditorSelection.range(from, to - before.length - after.length),
        };
      }
      return {
        changes: [
          { from, insert: before },
          { from: to, insert: after },
        ],
        range: EditorSelection.range(from + before.length, to + before.length),
      };
    }),
  );
}

/** Replace each selection with `text`, leaving the cursor `cursor` characters into it (default: at the end). */
export function insert(view: EditorView, text: string, cursor = text.length): boolean {
  return apply(
    view,
    view.state.changeByRange(({ from, to }) => ({
      changes: { from, to, insert: text },
      range: EditorSelection.cursor(from + cursor),
    })),
  );
}

/** `\href{|}{selection}`: the selected text becomes the link text and the cursor goes in the URL. */
export function link(view: EditorView): boolean {
  const { state } = view;
  return apply(
    view,
    state.changeByRange(({ from, to }) => ({
      changes: { from, to, insert: `\\href{}{${state.sliceDoc(from, to)}}` },
      range: EditorSelection.cursor(from + '\\href{'.length),
    })),
  );
}

/** The lines covered by the main selection (a selection ending at the start of a line doesn't include that line). */
function selectedLines(view: EditorView) {
  const { doc, selection } = view.state;
  const { from, to } = selection.main;
  const first = doc.lineAt(from);
  const last = doc.lineAt(to > from && doc.lineAt(to).from === to ? to - 1 : to);
  return { first, last };
}

/** Wrap the selected lines (or the current line) in an environment; with `items`, each line becomes an `\item`. */
export function wrapEnv(view: EditorView, env: string, items = false): boolean {
  const { first, last } = selectedLines(view);
  const indent = /^\s*/.exec(first.text)![0];
  const lines = view.state.sliceDoc(first.from, last.to).split('\n');
  const blank = lines.every((l) => !l.trim());
  const itemPrefix = (l: string) => (items && !/^\\item\b/.test(l) ? '\\item ' : '');
  const body = blank
    ? [`${indent}  ${items ? '\\item ' : ''}`]
    : lines.map((l) => {
        if (!l.trim()) return l;
        const rest = l.startsWith(indent) ? l.slice(indent.length) : l.trimStart();
        return `${indent}  ${itemPrefix(rest)}${rest}`;
      });
  const begin = `${indent}\\begin{${env}}`;
  const text = [begin, ...body, `${indent}\\end{${env}}`].join('\n');
  // Blank: cursor on the empty body line. Otherwise: at the end of the last body line.
  const cursor = blank ? begin.length + 1 + body[0].length : text.length - `\n${indent}\\end{${env}}`.length;
  return apply(view, {
    changes: { from: first.from, to: last.to, insert: text },
    selection: EditorSelection.cursor(first.from + cursor),
  });
}

export const HEADINGS = [
  { cmd: 'section', label: 'Section' },
  { cmd: 'subsection', label: 'Subsection' },
  { cmd: 'subsubsection', label: 'Subsubsection' },
  { cmd: 'paragraph', label: 'Paragraph' },
] as const;

const HEADING_LINE = /^(\s*)\\(section|subsection|subsubsection|paragraph)\*?\{(.*)\}\s*$/;

/**
 * With a selection, wrap it in `\cmd{…}`. Otherwise turn the current line into that heading: a line that is already a
 * heading changes level, or goes back to plain text if it is already this level.
 */
export function heading(view: EditorView, cmd: string): boolean {
  const { state } = view;
  const main = state.selection.main;
  if (!main.empty) return wrap(view, `\\${cmd}{`, '}');
  const line = state.doc.lineAt(main.head);
  const existing = HEADING_LINE.exec(line.text);
  const indent = existing?.[1] ?? /^\s*/.exec(line.text)![0];
  const title = existing ? existing[3] : line.text.trim();
  const text = existing?.[2] === cmd ? indent + title : `${indent}\\${cmd}{${title}}`;
  const cursor = existing?.[2] === cmd ? text.length : text.length - 1;
  return apply(view, {
    changes: { from: line.from, to: line.to, insert: text },
    selection: EditorSelection.cursor(line.from + cursor),
  });
}

export interface SymbolGroup {
  name: string;
  symbols: { char: string; tex: string }[];
}

const group = (name: string, pairs: string): SymbolGroup => ({
  name,
  symbols: pairs
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [char, tex] = pair.split('=');
      return { char, tex };
    }),
});

/** Math-mode commands for the symbol picker. */
export const SYMBOL_GROUPS: SymbolGroup[] = [
  group(
    'Greek',
    `α=\\alpha β=\\beta γ=\\gamma δ=\\delta ε=\\epsilon ζ=\\zeta η=\\eta θ=\\theta ι=\\iota κ=\\kappa λ=\\lambda μ=\\mu
     ν=\\nu ξ=\\xi π=\\pi ρ=\\rho σ=\\sigma τ=\\tau υ=\\upsilon φ=\\phi χ=\\chi ψ=\\psi ω=\\omega
     Γ=\\Gamma Δ=\\Delta Θ=\\Theta Λ=\\Lambda Ξ=\\Xi Π=\\Pi Σ=\\Sigma Φ=\\Phi Ψ=\\Psi Ω=\\Omega`,
  ),
  group(
    'Relations',
    `≤=\\leq ≥=\\geq ≠=\\neq ≈=\\approx ≡=\\equiv ∼=\\sim ≅=\\cong ∝=\\propto ≪=\\ll ≫=\\gg
     ∈=\\in ∉=\\notin ⊂=\\subset ⊆=\\subseteq ⊃=\\supset ⊇=\\supseteq ∣=\\mid ∥=\\parallel ⊥=\\perp`,
  ),
  group(
    'Operators',
    `±=\\pm ∓=\\mp ×=\\times ÷=\\div ·=\\cdot ∘=\\circ ∑=\\sum ∏=\\prod ∫=\\int ∮=\\oint ∂=\\partial ∇=\\nabla
     √=\\sqrt{} ∪=\\cup ∩=\\cap ∧=\\wedge ∨=\\vee ¬=\\neg ⊕=\\oplus ⊗=\\otimes`,
  ),
  group(
    'Arrows',
    `→=\\to ←=\\leftarrow ↔=\\leftrightarrow ⇒=\\Rightarrow ⇐=\\Leftarrow ⇔=\\Leftrightarrow ↦=\\mapsto
     ↑=\\uparrow ↓=\\downarrow ⟶=\\longrightarrow ⟹=\\implies`,
  ),
  group(
    'Misc',
    `∞=\\infty ∀=\\forall ∃=\\exists ∅=\\emptyset ℝ=\\mathbb{R} ℕ=\\mathbb{N} ℤ=\\mathbb{Z} ℚ=\\mathbb{Q} ℂ=\\mathbb{C}
     …=\\ldots ⋯=\\cdots ′=\\prime °=^\\circ ℓ=\\ell ℏ=\\hbar ∠=\\angle △=\\triangle`,
  ),
];

/** Insert a symbol's command; commands with an argument (`\sqrt{}`) leave the cursor inside the braces. */
export function insertSymbol(view: EditorView, tex: string): boolean {
  return insert(view, tex, tex.endsWith('{}') ? tex.length - 1 : tex.length);
}
