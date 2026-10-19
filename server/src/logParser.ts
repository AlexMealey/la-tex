export interface LogEntry {
  level: 'error' | 'warning' | 'typesetting';
  /** Project-relative path when the message points into the project, otherwise the raw path or null. */
  file: string | null;
  line: number | null;
  message: string;
}

export interface ParsedLog {
  errors: LogEntry[];
  warnings: LogEntry[];
  missingFiles: string[];
}

// `./main.tex:12: Undefined control sequence.` (we compile with -file-line-error)
const FILE_LINE_ERROR = /^(\.{0,2}\/[^:]*|[^\s:()][^:()]*\.[A-Za-z0-9]+):(\d+): (.*)$/;
const WARNING = /^(?:LaTeX|LaTeX Font|Package \S+|Class \S+) Warning: (.*)$/;
const ENGINE_WARNING = /^(?:pdfTeX|LuaTeX|XeTeX) warning(?: \([^)]*\))?: (.*)$/;
const CONTINUATION = /^\([^)]*\)\s+(.*)$/;
const BOX = /^(?:Over|Under)full \\[hv]box/;
const INPUT_LINE = /on input line (\d+)/;
const MISSING_FILE = /LaTeX Error: File `([^']+)' not found/;
const MISSING_TFM = /Font \S+=(\S+?)(?: at [\d.]+pt| scaled \d+)? not loadable: Metric \(TFM\) file/;
const CANT_FIND = /I can't find file `([^']+)'/;
const FILE_OPEN = /\((\.{0,2}\/[^\s()]+|[^\s()]+\.(?:tex|sty|cls|cfg|def|fd|clo|ldf|bbl|aux|toc))|\(|\)/g;
const NOISE = new Set(['Emergency stop.', '==> Fatal error occurred, no output PDF file produced!']);

/**
 * Pull errors, warnings and missing files out of a TeX log.
 * Compiles run with max_print_line raised, so messages are not hard-wrapped at 79 columns.
 */
export function parseLog(log: string, buildDir: string): ParsedLog {
  const lines = log.split(/\r?\n/);
  const errors: LogEntry[] = [];
  const warnings: LogEntry[] = [];
  const missing = new Set<string>();
  const fileStack: (string | null)[] = [];

  const normalise = (file: string | null): string | null => {
    if (!file) return null;
    if (file.startsWith(buildDir + '/')) return file.slice(buildDir.length + 1);
    return file.replace(/^\.\//, '');
  };
  const currentFile = (): string | null => {
    for (let i = fileStack.length - 1; i >= 0; i--) {
      const f = fileStack[i];
      if (f) return f.startsWith('./') ? normalise(f) : null;
    }
    return null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const missingMatch = MISSING_FILE.exec(line) ?? CANT_FIND.exec(line);
    if (missingMatch) {
      const name = missingMatch[1];
      missing.add(name.includes('.') ? name : `${name}.tex`);
    }
    const tfm = MISSING_TFM.exec(line);
    if (tfm) missing.add(`${tfm[1]}.tfm`);

    const fileLine = FILE_LINE_ERROR.exec(line);
    if (fileLine) {
      errors.push({
        level: 'error',
        file: normalise(fileLine[1]),
        line: Number(fileLine[2]),
        message: withContext(fileLine[3], lines, i),
      });
      continue;
    }
    if (line.startsWith('! ')) {
      let lineNo: number | null = null;
      for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
        const m = /^l\.(\d+)/.exec(lines[j]);
        if (m) {
          lineNo = Number(m[1]);
          break;
        }
      }
      errors.push({ level: 'error', file: currentFile(), line: lineNo, message: withContext(line.slice(2), lines, i) });
      continue;
    }

    const warning = WARNING.exec(line) ?? ENGINE_WARNING.exec(line);
    if (warning) {
      let message = warning[1];
      while (i + 1 < lines.length && CONTINUATION.test(lines[i + 1])) {
        message += ' ' + CONTINUATION.exec(lines[++i])![1];
      }
      const lineNo = INPUT_LINE.exec(message);
      warnings.push({
        level: 'warning',
        file: currentFile(),
        line: lineNo ? Number(lineNo[1]) : null,
        message: message.trim(),
      });
      continue;
    }

    if (BOX.test(line)) {
      const lineNo = /lines? (\d+)/.exec(line);
      warnings.push({ level: 'typesetting', file: currentFile(), line: lineNo ? Number(lineNo[1]) : null, message: line });
      continue;
    }

    // Track which file TeX is reading from its "(./file.tex ... )" nesting, for warnings without a path.
    for (const m of line.matchAll(FILE_OPEN)) {
      if (m[0] === ')') fileStack.pop();
      else fileStack.push(m[1] ?? null);
    }
  }

  const meaningful = errors.filter((e) => !NOISE.has(e.message.split('\n')[0].trim()));
  return {
    errors: meaningful.length ? meaningful : errors,
    warnings,
    missingFiles: [...missing],
  };
}

/** Append the lines TeX prints after an error up to and including `l.N ...`, which show the offending source. */
function withContext(message: string, lines: string[], index: number): string {
  const context: string[] = [];
  for (let j = index + 1; j < Math.min(index + 8, lines.length); j++) {
    const l = lines[j];
    if (l.trim() === '' || FILE_LINE_ERROR.test(l) || l.startsWith('! ')) break;
    context.push(l);
    if (/^l\.\d+/.test(l)) break;
  }
  return context.length ? `${message}\n${context.join('\n')}` : message;
}
