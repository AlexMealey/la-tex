import type { EditorState } from '@codemirror/state';

/** How far around the cursor to look for enclosing groups and environments. */
const WINDOW = 4000;

export const SIZES = [
  'tiny',
  'scriptsize',
  'footnotesize',
  'small',
  'normalsize',
  'large',
  'Large',
  'LARGE',
  'huge',
  'Huge',
] as const;

export const HEADING_LINE = /^(\s*)\\(section|subsection|subsubsection|paragraph)\*?\{(.*)\}\s*$/;

export const MATH_ENVS = new Set(
  'equation equation* align align* gather gather* multline multline* flalign flalign* eqnarray eqnarray* math displaymath'.split(
    ' ',
  ),
);

/** A command group around the cursor, e.g. `\textbf{…}`, `\textcolor{red}{…}` or `{\large …}`. */
export interface Group {
  cmd: string;
  /** First argument of two-argument commands: the color of `\textcolor`/`\colorbox`, the URL of `\href`. */
  arg?: string;
  argFrom?: number;
  argTo?: number;
  /** Start of `\cmd` (for size groups, the opening `{`). */
  from: number;
  /** Start of the content. */
  open: number;
  /** Position of the closing `}`. */
  close: number;
}

/** An environment around the cursor. */
export interface Env {
  name: string;
  /** `\begin{name}[opts]` */
  beginFrom: number;
  beginTo: number;
  /** `\end{name}` */
  endFrom: number;
  endTo: number;
}

export interface FormatContext {
  /** Innermost first. */
  groups: Group[];
  /** Innermost first. */
  envs: Env[];
  heading: string | null;
  inMath: boolean;
}

export const EMPTY_CONTEXT: FormatContext = { groups: [], envs: [], heading: null, inMath: false };

const escaped = (text: string, i: number) => {
  let n = 0;
  while (i - n - 1 >= 0 && text[i - n - 1] === '\\') n++;
  return n % 2 === 1;
};

/** Blank out `%` comments, keeping every other character at its position. */
export function stripComments(text: string): string {
  return text.replace(/%[^\n]*/g, (m, offset: number) => (escaped(text, offset) ? m : ' '.repeat(m.length)));
}

/** Index of the `}` matching the `{` at `open`, or -1. */
export function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if ((c !== '{' && c !== '}') || escaped(text, i)) continue;
    if (c === '{') depth++;
    else if (--depth === 0) return i;
  }
  return -1;
}

const SIZE_GROUP = new RegExp(`^\\\\(${SIZES.join('|')})(?![a-zA-Z])\\s*`);
const TWO_ARG = /\\(textcolor|colorbox|href)\s*\{([^{}]*)\}\s*$/;
const ONE_ARG = /\\([a-zA-Z]+)\s*$/;
const ENV_TOKEN = /\\(begin|end)\s*\{([^{}]+)\}/g;

/** Describe the formatting around the main selection. */
export function contextAt(state: EditorState): FormatContext {
  const { from, to } = state.selection.main;
  const start = state.doc.lineAt(Math.max(0, from - WINDOW)).from;
  const end = state.doc.lineAt(Math.min(state.doc.length, to + WINDOW)).to;
  const text = stripComments(state.sliceDoc(start, end));
  const rel = from - start;
  const relTo = to - start;

  const groups: Group[] = [];
  let depth = 0;
  for (let i = rel - 1; i >= 0; i--) {
    const c = text[i];
    if ((c !== '{' && c !== '}') || escaped(text, i)) continue;
    if (c === '}') {
      depth++;
      continue;
    }
    if (depth > 0) {
      depth--;
      continue;
    }
    // An unmatched `{` before the cursor: does its group also cover the end of the selection?
    const close = matchingBrace(text, i);
    if (close < 0 || close < relTo) continue;
    const before = text.slice(Math.max(0, i - 200), i);
    const two = TWO_ARG.exec(before);
    const one = ONE_ARG.exec(before);
    const size = SIZE_GROUP.exec(text.slice(i + 1, i + 40));
    if (two) {
      const cmdFrom = i - two[0].length;
      const argFrom = cmdFrom + two[0].indexOf('{') + 1;
      groups.push({
        cmd: two[1],
        arg: two[2],
        argFrom: start + argFrom,
        argTo: start + argFrom + two[2].length,
        from: start + cmdFrom,
        open: start + i + 1,
        close: start + close,
      });
    } else if (one && !/^(begin|end|textcolor|colorbox|href)$/.test(one[1])) {
      // (A first argument, e.g. the cursor is in the color name of \textcolor{…}, isn't a formatted group.)
      groups.push({ cmd: one[1], from: start + i - one[0].length, open: start + i + 1, close: start + close });
    } else if (size) {
      groups.push({ cmd: size[1], from: start + i, open: start + i + 1 + size[0].length, close: start + close });
    }
  }

  // Pair up \begin/\end in the window and keep the pairs around the selection.
  const envs: Env[] = [];
  const stack: { name: string; beginFrom: number; beginTo: number }[] = [];
  for (const m of text.matchAll(ENV_TOKEN)) {
    const at = m.index;
    if (m[1] === 'begin') {
      const opts = /^\s*\[[^\]\n]*\]/.exec(text.slice(at + m[0].length));
      stack.push({ name: m[2], beginFrom: at, beginTo: at + m[0].length + (opts ? opts[0].length : 0) });
      continue;
    }
    const open = stack.map((s) => s.name).lastIndexOf(m[2]);
    if (open < 0) continue;
    const begin = stack[open];
    stack.length = open;
    if (begin.beginTo <= rel && at >= relTo) {
      envs.push({
        name: m[2],
        beginFrom: start + begin.beginFrom,
        beginTo: start + begin.beginTo,
        endFrom: start + at,
        endTo: start + at + m[0].length,
      });
    }
  }
  envs.sort((a, b) => b.beginFrom - a.beginFrom);

  const heading = HEADING_LINE.exec(state.doc.lineAt(from).text)?.[2] ?? null;
  return { groups, envs, heading, inMath: inMath(text.slice(0, rel), envs) };
}

function inMath(before: string, envs: Env[]): boolean {
  if (envs.some((e) => MATH_ENVS.has(e.name))) return true;
  const last = (re: RegExp) => {
    let at = -1;
    for (const m of before.matchAll(re)) if (!escaped(before, m.index)) at = m.index;
    return at;
  };
  if (last(/\\\[/g) > last(/\\\]/g) || last(/\\\(/g) > last(/\\\)/g)) return true;
  // `$…$` doesn't cross paragraphs: count the dollars since the last blank line.
  const paragraph = before.slice(before.search(/\n\s*\n(?![\s\S]*\n\s*\n)/) + 1);
  let dollars = 0;
  for (const m of paragraph.matchAll(/\$\$?/g)) if (!escaped(paragraph, m.index)) dollars++;
  return dollars % 2 === 1;
}

export const findGroup = (ctx: FormatContext, cmds: readonly string[]) => ctx.groups.find((g) => cmds.includes(g.cmd));
export const findEnv = (ctx: FormatContext, names: readonly string[]) => ctx.envs.find((e) => names.includes(e.name));
