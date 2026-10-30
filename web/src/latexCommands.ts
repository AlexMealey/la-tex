import { completionStatus, snippet, startCompletion } from '@codemirror/autocomplete';
import {
  EditorSelection,
  StateEffect,
  type ChangeSpec,
  type EditorState,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  HEADING_LINE,
  SIZES,
  contextAt,
  findEnv,
  findGroup,
  matchingBrace,
  stripComments,
  type Env,
  type Group,
} from './latexContext';

// ---- Packages ----

const PACKAGES = {
  ulem: { line: '\\usepackage[normalem]{ulem}', satisfiedBy: ['ulem'] },
  xcolor: { line: '\\usepackage{xcolor}', satisfiedBy: ['xcolor'] },
  amsmath: { line: '\\usepackage{amsmath}', satisfiedBy: ['amsmath', 'mathtools'] },
  amssymb: { line: '\\usepackage{amssymb}', satisfiedBy: ['amssymb', 'amsfonts'] },
  hyperref: { line: '\\usepackage{hyperref}', satisfiedBy: ['hyperref'] },
} as const;

export type Package = keyof typeof PACKAGES;

export const packageLine = (p: Package) => PACKAGES[p].line;

/** Attached to a transaction when a command needs packages it couldn't add because the file has no preamble. */
export const missingPackages = StateEffect.define<Package[]>();

const USEPACKAGE = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;

/** Changes adding `\usepackage` lines for the packages the preamble doesn't load yet. */
function packageChanges(state: EditorState, packages: readonly Package[]): { changes: ChangeSpec[]; missing: Package[] } {
  if (!packages.length) return { changes: [], missing: [] };
  const text = stripComments(state.doc.toString());
  const begin = text.search(/\\begin\s*\{document\}/);
  const loaded = new Set<string>();
  let lastEnd = -1;
  for (const m of text.slice(0, Math.max(begin, 0)).matchAll(USEPACKAGE)) {
    for (const name of m[1].split(',')) loaded.add(name.trim());
    lastEnd = m.index + m[0].length;
  }
  const needed = [...new Set(packages)].filter((p) => !PACKAGES[p].satisfiedBy.some((n) => loaded.has(n)));
  if (!needed.length) return { changes: [], missing: [] };
  if (begin < 0) return { changes: [], missing: needed };
  const lines = needed.map((p) => PACKAGES[p].line).join('\n');
  const change =
    lastEnd >= 0
      ? { from: state.doc.lineAt(lastEnd).to, insert: `\n${lines}` }
      : { from: state.doc.lineAt(begin).from, insert: `${lines}\n` };
  return { changes: [change], missing: [] };
}

/** Dispatch `spec` plus any `\usepackage` lines it needs, as one undoable step. */
function apply(view: EditorView, spec: TransactionSpec, packages: readonly Package[] = []): boolean {
  const { changes, missing } = packageChanges(view.state, packages);
  view.dispatch(
    { ...spec, scrollIntoView: true, userEvent: 'input' },
    { changes, effects: missing.length ? missingPackages.of(missing) : [] },
  );
  view.focus();
  return true;
}

// ---- Wrapping and inserting ----

/** Wrap each selection in `before…after`, or unwrap it if it is already wrapped. */
export function wrap(view: EditorView, before: string, after: string, packages: readonly Package[] = []): boolean {
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
    packages,
  );
}

/** Replace each selection with `text`, leaving the cursor `cursor` characters into it (default: at the end). */
export function insert(view: EditorView, text: string, cursor = text.length, packages: readonly Package[] = []): boolean {
  return apply(
    view,
    view.state.changeByRange(({ from, to }) => ({
      changes: { from, to, insert: text },
      range: EditorSelection.cursor(from + cursor),
    })),
    packages,
  );
}

/**
 * Insert a `@codemirror/autocomplete` snippet (Tab moves between its `${}` fields). A single-line selection becomes
 * the first field. `math` wraps the snippet in `$…$` or `\[…\]` when the cursor isn't in math already; `block` puts
 * it on lines of its own.
 */
export function insertSnippet(
  view: EditorView,
  template: string,
  { packages = [], math, block = false }: { packages?: readonly Package[]; math?: '$' | '\\['; block?: boolean } = {},
): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const selected = state.sliceDoc(from, to);
  if (selected && !/[{}\n]/.test(selected)) template = template.replace('${}', '${' + selected + '}');
  if (math && !contextAt(state).inMath) {
    template = math === '$' ? `$${template}$` : `\\[\n\t${template.replace(/\n/g, '\n\t')}\n\\]`;
    block ||= math === '\\[';
  }
  if (block) {
    if (state.sliceDoc(state.doc.lineAt(from).from, from).trim()) template = `\n${template}`;
    if (state.sliceDoc(to, state.doc.lineAt(to).to).trim()) template += '\n';
  }
  const transactions: Transaction[] = [];
  snippet(template)({ state, dispatch: (tr) => transactions.push(tr) }, null, from, to);
  const [tr] = transactions;
  if (!tr) return false;
  // Re-dispatch the snippet's transaction with the package lines; its field positions map through them.
  return apply(view, { changes: tr.changes, selection: tr.selection, effects: tr.effects }, packages);
}

// ---- Command groups: \textbf{…}, \textcolor{c}{…}, {\large …} ----

export const SCRIPTS = ['textsubscript', 'textsuperscript'];

const unwrapGroup = (g: Group): ChangeSpec[] => [
  { from: g.from, to: g.open },
  { from: g.close, to: g.close + 1 },
];

/**
 * Remove the `\cmd{…}` around the cursor, or wrap the selection in one. Inside a group of one of the `exclusive`
 * commands (e.g. subscript vs. superscript), switch that group to `cmd` instead.
 */
export function toggleCommand(
  view: EditorView,
  cmd: string,
  packages: readonly Package[] = [],
  exclusive: readonly string[] = [],
): boolean {
  const ctx = contextAt(view.state);
  const own = findGroup(ctx, [cmd]);
  if (own) return apply(view, { changes: unwrapGroup(own) });
  const other = findGroup(ctx, exclusive);
  if (other) {
    return apply(view, { changes: { from: other.from + 1, to: other.from + 1 + other.cmd.length, insert: cmd } }, packages);
  }
  return wrap(view, `\\${cmd}{`, '}', packages);
}

export interface Swatch {
  /** xcolor color expression */
  name: string;
  css: string;
}

export const TEXT_COLORS: Swatch[] = [
  { name: 'black', css: '#000000' },
  { name: 'darkgray', css: '#404040' },
  { name: 'gray', css: '#808080' },
  { name: 'red', css: '#ff0000' },
  { name: 'orange', css: '#ff8000' },
  { name: 'brown', css: '#bf8040' },
  { name: 'olive', css: '#808000' },
  { name: 'green!50!black', css: '#008000' },
  { name: 'teal', css: '#008080' },
  { name: 'blue', css: '#0000ff' },
  { name: 'violet', css: '#800080' },
  { name: 'purple', css: '#bf0040' },
  { name: 'magenta', css: '#ff00ff' },
];

export const HIGHLIGHT_COLORS: Swatch[] = [
  { name: 'yellow!40', css: '#ffff99' },
  { name: 'lime!40', css: '#e5ff99' },
  { name: 'green!25', css: '#bfffbf' },
  { name: 'cyan!25', css: '#bfffff' },
  { name: 'blue!20', css: '#ccccff' },
  { name: 'pink', css: '#ffbfbf' },
  { name: 'orange!40', css: '#ffcc99' },
  { name: 'lightgray', css: '#bfbfbf' },
];

/** Color the selection, recolor the group around the cursor, or (with `null`) remove its color. */
export function setColor(view: EditorView, kind: 'textcolor' | 'colorbox', color: string | null): boolean {
  const g = findGroup(contextAt(view.state), [kind]);
  if (g) {
    const changes = color ? { from: g.argFrom!, to: g.argTo!, insert: color } : unwrapGroup(g);
    return apply(view, { changes }, color ? ['xcolor'] : []);
  }
  return color ? wrap(view, `\\${kind}{${color}}{`, '}', ['xcolor']) : true;
}

/** Wrap the selection in `{\size …}`, change the size of the group around the cursor, or (with `null`) remove it. */
export function setSize(view: EditorView, size: string | null): boolean {
  const g = findGroup(contextAt(view.state), SIZES);
  if (g) {
    // Size groups start at their `{`: the command name is after `{\`.
    const changes = size ? { from: g.from + 2, to: g.from + 2 + g.cmd.length, insert: size } : unwrapGroup(g);
    return apply(view, { changes });
  }
  return size ? wrap(view, `{\\${size} `, '}') : true;
}

const FORMAT_CMDS = [
  'textbf',
  'textit',
  'emph',
  'underline',
  'sout',
  'texttt',
  'textsc',
  'textsubscript',
  'textsuperscript',
  'textcolor',
  'colorbox',
  ...SIZES,
];
const FORMAT_START = new RegExp(
  `\\\\(?:${FORMAT_CMDS.slice(0, 9).join('|')})\\s*\\{|\\\\(?:textcolor|colorbox)\\s*\\{[^{}]*\\}\\s*\\{|\\{\\\\(?:${SIZES.join('|')})(?![a-zA-Z])\\s*`,
  'g',
);

/** Remove the formatting commands around the cursor and inside the selection. */
export function clearFormatting(view: EditorView): boolean {
  const { state } = view;
  const changes = contextAt(state)
    .groups.filter((g) => FORMAT_CMDS.includes(g.cmd))
    .flatMap(unwrapGroup);
  const { from, to } = state.selection.main;
  const text = stripComments(state.sliceDoc(from, to));
  for (const m of text.matchAll(FORMAT_START)) {
    const brace = m[0].startsWith('{') ? m.index : m.index + m[0].length - 1;
    const close = matchingBrace(text, brace);
    if (close < 0) continue;
    changes.push({ from: from + m.index, to: from + m.index + m[0].length }, { from: from + close, to: from + close + 1 });
  }
  return changes.length ? apply(view, { changes }) : true;
}

// ---- Links, footnotes, references ----

const escapeUrl = (url: string) => url.replace(/(?<!\\)[%#]/g, '\\$&');
const unescapeUrl = (url: string) => url.replace(/\\([%#])/g, '$1');

/** The link around the cursor, or the selected text as the text of a new one. */
export function linkAt(state: EditorState): { url: string; text: string; existing: boolean } {
  const g = findGroup(contextAt(state), ['href', 'url']);
  if (g?.cmd === 'href') return { url: unescapeUrl(g.arg ?? ''), text: state.sliceDoc(g.open, g.close), existing: true };
  if (g?.cmd === 'url') return { url: unescapeUrl(state.sliceDoc(g.open, g.close)), text: '', existing: true };
  const { from, to } = state.selection.main;
  const selected = state.sliceDoc(from, to);
  return /^(https?:\/\/|www\.)\S+$/.test(selected)
    ? { url: selected, text: '', existing: false }
    : { url: '', text: selected, existing: false };
}

/** Insert `\href{url}{text}` (or `\url{url}` without text), replacing the selection or the link around the cursor. */
export function setLink(view: EditorView, url: string, text: string): boolean {
  const { state } = view;
  const g = findGroup(contextAt(state), ['href', 'url']);
  const { from, to } = g ? { from: g.from, to: g.close + 1 } : state.selection.main;
  const tex = text.trim() ? `\\href{${escapeUrl(url.trim())}}{${text}}` : `\\url{${escapeUrl(url.trim())}}`;
  return apply(view, { changes: { from, to, insert: tex }, selection: EditorSelection.cursor(from + tex.length) }, [
    'hyperref',
  ]);
}

/** Remove the link around the cursor, keeping its text. */
export function removeLink(view: EditorView): boolean {
  const g = findGroup(contextAt(view.state), ['href', 'url']);
  if (!g) return true;
  return g.cmd === 'href'
    ? apply(view, { changes: unwrapGroup(g) })
    : apply(view, { changes: { from: g.from, to: g.close + 1, insert: view.state.sliceDoc(g.open, g.close) } });
}

const unique = (values: Iterable<string>) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

export const labelsIn = (text: string) =>
  unique([...stripComments(text).matchAll(/\\label\s*\{([^{}]+)\}/g)].map((m) => m[1].trim()));

export const bibitemsIn = (text: string) =>
  unique([...stripComments(text).matchAll(/\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g)].map((m) => m[1].trim()));

/** Entry keys of a .bib file. */
export const bibKeysIn = (bib: string) =>
  unique(
    [...bib.matchAll(/@(\w+)\s*[{(]\s*([^,\s{}()]+)\s*,/g)]
      .filter((m) => !/^(comment|string|preamble)$/i.test(m[1]))
      .map((m) => m[2]),
  );

/** `\label{}` with a prefix that fits the context; on a heading line it goes after the heading. */
export function insertLabel(view: EditorView): boolean {
  const { state } = view;
  const ctx = contextAt(state);
  const prefix = ctx.heading ? 'sec:' : ctx.inMath ? 'eq:' : findEnv(ctx, ['table', 'tabular']) ? 'tab:' : '';
  const tex = `\\label{${prefix}}`;
  if (!ctx.heading) return insert(view, tex, tex.length - 1);
  const end = state.doc.lineAt(state.selection.main.head).to;
  return apply(view, { changes: { from: end, insert: tex }, selection: EditorSelection.cursor(end + tex.length - 1) });
}

/** Insert `\ref{key}` (or `\cite`, …); without a key, leave the cursor in the braces and show completions. */
export function insertRef(view: EditorView, cmd: 'ref' | 'eqref' | 'pageref' | 'cite', key = ''): boolean {
  const tex = `\\${cmd}{${key}}`;
  insert(view, tex, key ? tex.length : tex.length - 1, cmd === 'eqref' ? ['amsmath'] : []);
  if (!key) startCompletion(view);
  return true;
}

// ---- Lines and environments ----

/** The lines covered by the main selection (a selection ending at the start of a line doesn't include that line). */
function selectedLines(state: EditorState) {
  const { doc, selection } = state;
  const { from, to } = selection.main;
  const first = doc.lineAt(from);
  const last = doc.lineAt(to > from && doc.lineAt(to).from === to ? to - 1 : to);
  return { first, last };
}

/** Wrap the selected lines (or the current line) in an environment; with `item`, each line starts with it. */
export function wrapEnv(view: EditorView, env: string, item = '', packages: readonly Package[] = []): boolean {
  const { first, last } = selectedLines(view.state);
  const indent = /^\s*/.exec(first.text)![0];
  const lines = view.state.sliceDoc(first.from, last.to).split('\n');
  const blank = lines.every((l) => !l.trim());
  const itemPrefix = (l: string) => (item && !/^\\item\b/.test(l) ? item : '');
  const body = blank
    ? [`${indent}  ${item}`]
    : lines.map((l) => {
        if (!l.trim()) return l;
        const rest = l.startsWith(indent) ? l.slice(indent.length) : l.trimStart();
        return `${indent}  ${itemPrefix(rest)}${rest}`;
      });
  const begin = `${indent}\\begin{${env}}`;
  const text = [begin, ...body, `${indent}\\end{${env}}`].join('\n');
  // Blank: cursor on the empty body line. Otherwise: at the end of the last body line.
  const cursor = blank ? begin.length + 1 + body[0].length : text.length - `\n${indent}\\end{${env}}`.length;
  return apply(
    view,
    {
      changes: { from: first.from, to: last.to, insert: text },
      selection: EditorSelection.cursor(first.from + cursor),
    },
    packages,
  );
}

export const LISTS = ['itemize', 'enumerate', 'description'];
export const ALIGNMENTS = ['flushleft', 'center', 'flushright'];

const itemFor = (list: string) => (list === 'description' ? '\\item[] ' : '\\item ');

interface Item {
  from: number;
  to: number;
  /** `[…]` after `\item`, if any. */
  label?: { from: number; text: string };
}

/** The `\item`s of a list itself, not of lists nested in it. `to` includes one following space. */
function topLevelItems(state: EditorState, env: Env): Item[] {
  const text = stripComments(state.sliceDoc(env.beginTo, env.endFrom));
  const items: Item[] = [];
  let depth = 0;
  for (const m of text.matchAll(/\\(begin|end)\s*\{[^{}]*\}|\\item(?![a-zA-Z])(\s*\[[^\]]*\])?[ \t]?/g)) {
    if (m[1] === 'begin') depth++;
    else if (m[1] === 'end') depth--;
    else if (depth === 0) {
      const from = env.beginTo + m.index;
      items.push({
        from,
        to: from + m[0].length,
        label: m[2] ? { from: from + '\\item'.length, text: m[2] } : undefined,
      });
    }
  }
  return items;
}

/** Remove `\begin…` and `\end…`, deleting their lines when they're alone on them, and dedent the body. */
function unwrapEnv(view: EditorView, env: Env, stripItems: boolean): boolean {
  const { state } = view;
  const b = state.doc.lineAt(env.beginFrom);
  const e = state.doc.lineAt(env.endFrom);
  const alone = (line: { from: number; to: number }, from: number, to: number) =>
    !state.sliceDoc(line.from, from).trim() && !state.sliceDoc(to, line.to).trim();
  const beginAlone = alone(b, env.beginFrom, env.beginTo);
  const endAlone = alone(e, env.endFrom, env.endTo);
  const changes: ChangeSpec[] = [];
  if (beginAlone && endAlone && e.number - b.number <= 1) {
    changes.push({ from: b.from, to: e.to });
  } else {
    changes.push(beginAlone ? { from: b.from, to: b.to + 1 } : { from: env.beginFrom, to: env.beginTo });
    changes.push(endAlone ? { from: e.from - 1, to: e.to } : { from: env.endFrom, to: env.endTo });
  }
  const indent = /^\s*/.exec(b.text)![0];
  for (let n = b.number + 1; n < e.number; n++) {
    const line = state.doc.line(n);
    if (line.text.startsWith(`${indent}  `)) changes.push({ from: line.from + indent.length, to: line.from + indent.length + 2 });
  }
  if (stripItems) for (const item of topLevelItems(state, env)) changes.push({ from: item.from, to: item.to });
  return apply(view, { changes });
}

/** Rename an environment; lists switching to or from `description` gain or lose empty `[]` labels. */
function renameEnv(view: EditorView, env: Env, name: string): boolean {
  const { state } = view;
  const nameAt = (from: number, to: number) => from + state.sliceDoc(from, to).indexOf('{') + 1;
  const changes: ChangeSpec[] = [
    { from: nameAt(env.beginFrom, env.beginTo), to: nameAt(env.beginFrom, env.beginTo) + env.name.length, insert: name },
    { from: nameAt(env.endFrom, env.endTo), to: nameAt(env.endFrom, env.endTo) + env.name.length, insert: name },
  ];
  if ((name === 'description') !== (env.name === 'description')) {
    for (const item of topLevelItems(state, env)) {
      if (name === 'description' && !item.label) changes.push({ from: item.from + '\\item'.length, insert: '[]' });
      if (name !== 'description' && item.label?.text.trim() === '[]') {
        changes.push({ from: item.label.from, to: item.label.from + item.label.text.length });
      }
    }
  }
  return apply(view, { changes });
}

/**
 * Inside an environment of `family`: switch it to `env`, or remove it if it already is `env`. Otherwise wrap the
 * selected lines in `env`.
 */
function toggleEnv(view: EditorView, env: string, family: readonly string[], item = ''): boolean {
  const current = findEnv(contextAt(view.state), family);
  if (!current) return wrapEnv(view, env, item);
  if (current.name === env) return unwrapEnv(view, current, !!item);
  return renameEnv(view, current, env);
}

export const toggleList = (view: EditorView, list: string) => toggleEnv(view, list, LISTS, itemFor(list));

/** Center or right-align the selected lines; `flushleft` (the default alignment) removes the alignment. */
export function setAlignment(view: EditorView, align: string): boolean {
  if (align !== 'flushleft') return toggleEnv(view, align, ALIGNMENTS);
  const current = findEnv(contextAt(view.state), ALIGNMENTS);
  return current ? unwrapEnv(view, current, false) : true;
}

const ITEM_LINE = /^(\s*)\\item(?![a-zA-Z])(\[[^\]]*\])?[ \t]?/;
const listsAround = (state: EditorState) => contextAt(state).envs.filter((e) => LISTS.includes(e.name));

/** Nest the selected items in a sub-list of the same kind. Returns false when not on an item that can be nested. */
export function indentItems(view: EditorView): boolean {
  const { state } = view;
  const [list] = listsAround(state);
  if (!list) return false;
  const { first, last } = selectedLines(state);
  if (!ITEM_LINE.test(first.text) || first.from <= list.beginTo || last.to >= list.endFrom) return false;
  // A nested list has to come after an item of its parent.
  if (!/\\item(?![a-zA-Z])/.test(stripComments(state.sliceDoc(list.beginTo, first.from)))) return false;
  const indent = /^\s*/.exec(first.text)![0];
  const changes: ChangeSpec[] = [{ from: first.from, insert: `${indent}\\begin{${list.name}}\n` }];
  for (let n = first.number; n <= last.number; n++) {
    const line = state.doc.line(n);
    if (line.text.trim()) changes.push({ from: line.from, insert: '  ' });
  }
  changes.push({ from: last.to, insert: `\n${indent}\\end{${list.name}}` });
  return apply(view, { changes });
}

/** Move the selected items of a nested list up one level. Returns false when not in a nested list. */
export function outdentItems(view: EditorView): boolean {
  const { state } = view;
  const [list, parent] = listsAround(state);
  if (!list || !parent) return false;
  const { first, last } = selectedLines(state);
  const beginLine = state.doc.lineAt(list.beginFrom);
  const endLine = state.doc.lineAt(list.endFrom);
  if (first.number <= beginLine.number || last.number >= endLine.number) return false;
  const indent = /^\s*/.exec(beginLine.text)![0];
  const blank = (from: number, to: number) => !stripComments(state.sliceDoc(from, to)).trim();
  const changes: ChangeSpec[] = [];
  // Close the nested list before the selected items (or drop its \begin if they are its first items)…
  if (blank(beginLine.to, first.from)) changes.push({ from: beginLine.from, to: beginLine.to + 1 });
  else changes.push({ from: first.from, insert: `${indent}\\end{${list.name}}\n` });
  for (let n = first.number; n <= last.number; n++) {
    const line = state.doc.line(n);
    if (line.text.startsWith(`${indent}  `)) changes.push({ from: line.from + indent.length, to: line.from + indent.length + 2 });
  }
  // …and reopen it after them (or drop its \end if they are its last items).
  if (blank(last.to, endLine.from)) changes.push({ from: last.to, to: endLine.to });
  else changes.push({ from: last.to, insert: `\n${indent}\\begin{${list.name}}` });
  return apply(view, { changes });
}

/**
 * Enter on an `\item` line starts a new item. On an empty item it leaves the list instead (or, in a nested list,
 * continues the parent list). Returns false to let Enter behave normally.
 */
export function continueItem(view: EditorView): boolean {
  const { state } = view;
  const { main } = state.selection;
  if (completionStatus(state) === 'active' || state.selection.ranges.length > 1 || !main.empty) return false;
  const line = state.doc.lineAt(main.head);
  const m = ITEM_LINE.exec(line.text);
  if (!m || main.head < line.from + m[1].length + '\\item'.length) return false;
  const [list, parent] = listsAround(state);
  if (!list) return false;

  const empty = !line.text.slice(m[0].length).trim() && (!m[2] || m[2] === '[]');
  if (!empty) {
    const text = `\n${m[1]}${itemFor(list.name)}`;
    return apply(view, { changes: { from: main.head, insert: text }, selection: EditorSelection.cursor(main.head + text.length) });
  }

  const beginLine = state.doc.lineAt(list.beginFrom);
  const endLine = state.doc.lineAt(list.endFrom);
  const endIndent = /^\s*/.exec(endLine.text)![0];
  if (topLevelItems(state, list).length <= 1) {
    // The list only has this empty item: remove it altogether.
    const changes = state.changes({ from: beginLine.from, to: endLine.to, insert: endIndent });
    return apply(view, { changes, selection: EditorSelection.cursor(beginLine.from + endIndent.length) });
  }
  const after = parent ? `\n${endIndent}${itemFor(parent.name)}` : `\n${endIndent}`;
  const changes = state.changes([
    { from: line.from - 1, to: line.to },
    { from: endLine.to, insert: after },
  ]);
  return apply(view, { changes, selection: EditorSelection.cursor(changes.mapPos(endLine.to, 1)) });
}

// ---- Headings ----

export const HEADINGS = [
  { cmd: 'section', label: 'Section' },
  { cmd: 'subsection', label: 'Subsection' },
  { cmd: 'subsubsection', label: 'Subsubsection' },
  { cmd: 'paragraph', label: 'Paragraph' },
] as const;

/**
 * With a selection, wrap it in `\cmd{…}`. Otherwise turn the current line into that heading: a line that is already a
 * heading changes level, or goes back to plain text if it is already this level (or `cmd` is empty).
 */
export function heading(view: EditorView, cmd: string): boolean {
  const { state } = view;
  const main = state.selection.main;
  if (!main.empty && cmd) return wrap(view, `\\${cmd}{`, '}');
  const line = state.doc.lineAt(main.head);
  const existing = HEADING_LINE.exec(line.text);
  if (!existing && !cmd) return true;
  const indent = existing?.[1] ?? /^\s*/.exec(line.text)![0];
  const title = existing ? existing[3] : line.text.trim();
  const plain = !cmd || existing?.[2] === cmd;
  const text = plain ? indent + title : `${indent}\\${cmd}{${title}}`;
  const cursor = plain ? text.length : text.length - 1;
  return apply(view, {
    changes: { from: line.from, to: line.to, insert: text },
    selection: EditorSelection.cursor(line.from + cursor),
  });
}

// ---- Tables and math ----

/** A `table` float with a `rows`×`cols` tabular; Tab moves from cell to cell, then to the caption and label. */
export function insertTable(view: EditorView, rows: number, cols: number): boolean {
  const row = `\t\t${Array.from({ length: cols }, () => '${}').join(' & ')} \\\\ \\hline`;
  const template = [
    '\\begin{table}[h]',
    '\t\\centering',
    `\t\\begin{tabular}{|${Array(cols).fill('l').join('|')}|}`,
    '\t\t\\hline',
    ...Array.from({ length: rows }, () => row),
    '\t\\end{tabular}',
    '\t\\caption{${}}',
    '\t\\label{tab:${}}',
    '\\end{table}',
  ].join('\n');
  return insertSnippet(view, template, { block: true });
}

export interface MathTemplate {
  label: string;
  /** Short preview shown in the menu. */
  preview: string;
  template: string;
  packages?: Package[];
  math?: '$' | '\\[';
  block?: boolean;
}

export const MATH_TEMPLATES: MathTemplate[] = [
  { label: 'Fraction', preview: 'a⁄b', template: '\\frac{${}}{${}}', math: '$' },
  { label: 'Square root', preview: '√x', template: '\\sqrt{${}}', math: '$' },
  { label: 'Superscript', preview: 'xⁿ', template: '^{${}}', math: '$' },
  { label: 'Subscript', preview: 'xₙ', template: '_{${}}', math: '$' },
  { label: 'Sum', preview: '∑', template: '\\sum_{${i=1}}^{${n}} ${}', math: '$' },
  { label: 'Integral', preview: '∫', template: '\\int_{${a}}^{${b}} ${f(x)} \\, d${x}', math: '$' },
  { label: 'Limit', preview: 'lim', template: '\\lim_{${n \\to \\infty}} ${}', math: '$' },
  {
    label: 'Cases',
    preview: '{ ⋮',
    template: '\\begin{cases}\n\t${} & \\text{if } ${} \\\\\n\t${} & \\text{otherwise}\n\\end{cases}',
    packages: ['amsmath'],
    math: '\\[',
  },
  {
    label: 'Matrix (parentheses)',
    preview: '( ⋱ )',
    template: '\\begin{pmatrix}\n\t${a} & ${b} \\\\\n\t${c} & ${d}\n\\end{pmatrix}',
    packages: ['amsmath'],
    math: '\\[',
  },
  {
    label: 'Matrix (brackets)',
    preview: '[ ⋱ ]',
    template: '\\begin{bmatrix}\n\t${a} & ${b} \\\\\n\t${c} & ${d}\n\\end{bmatrix}',
    packages: ['amsmath'],
    math: '\\[',
  },
  {
    label: 'Numbered equation',
    preview: '(1)',
    template: '\\begin{equation}\n\t${}\n\t\\label{eq:${}}\n\\end{equation}',
    block: true,
  },
  {
    label: 'Unnumbered equation',
    preview: '=',
    template: '\\begin{equation*}\n\t${}\n\\end{equation*}',
    packages: ['amsmath'],
    block: true,
  },
  {
    label: 'Aligned equations',
    preview: '&=',
    template: '\\begin{align*}\n\t${} &= ${} \\\\\n\t&= ${}\n\\end{align*}',
    packages: ['amsmath'],
    block: true,
  },
];

export const insertMath = (view: EditorView, t: MathTemplate) =>
  insertSnippet(view, t.template, { packages: t.packages, math: t.math, block: t.block });

// ---- Symbols ----

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

/** Packages that symbol commands need. */
const COMMAND_PACKAGES: Record<string, Package> = { mathbb: 'amssymb', implies: 'amsmath' };

/**
 * Insert a symbol's command, in `$…$` when the cursor isn't in math. Commands with an argument (`\sqrt{}`) leave the
 * cursor inside the braces.
 */
export function insertSymbol(view: EditorView, tex: string): boolean {
  const packages = [...tex.matchAll(/\\([a-zA-Z]+)/g)].flatMap((m) => COMMAND_PACKAGES[m[1]] ?? []);
  const text = contextAt(view.state).inMath ? tex : `$${tex}$`;
  return insert(view, text, tex.endsWith('{}') ? text.indexOf('{}') + 1 : text.length, packages);
}
