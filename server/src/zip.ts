import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { HttpError } from './http.js';
import { META_FILE, safeJoin } from './paths.js';
import { listFiles, type Engine } from './projects.js';

const MAX_ENTRIES = 5000;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;

export async function writeProjectZip(dir: string, out: NodeJS.WritableStream): Promise<void> {
  const zip = new yazl.ZipFile();
  for (const f of await listFiles(dir)) {
    if (f.type === 'dir') zip.addEmptyDirectory(f.path);
    else zip.addFile(path.join(dir, f.path), f.path);
  }
  zip.end();
  await pipeline(zip.outputStream, out);
}

/**
 * Extract an uploaded ZIP (e.g. Overleaf's "Download Source") into `dest`.
 * yauzl rejects absolute and `..` entry names; safeJoin checks again before writing.
 * A single top-level folder wrapping everything is stripped.
 */
export async function extractZip(buffer: Buffer, dest: string): Promise<string[]> {
  let zipfile: yauzl.ZipFile;
  try {
    zipfile = await yauzl.fromBufferPromise(buffer, { lazyEntries: true, autoClose: false });
  } catch (err) {
    throw new HttpError(400, `Not a valid ZIP file: ${(err as Error).message}`);
  }
  try {
    const entries = (await readEntries(zipfile)).filter(
      (e) => !e.fileName.endsWith('/') && !e.fileName.startsWith('__MACOSX/') && !e.fileName.endsWith('.DS_Store'),
    );
    if (entries.length > MAX_ENTRIES) throw new HttpError(400, `ZIP has more than ${MAX_ENTRIES} files`);
    const total = entries.reduce((sum, e) => sum + e.uncompressedSize, 0);
    if (total > MAX_TOTAL_BYTES) throw new HttpError(400, 'ZIP is too large once extracted');

    const prefix = commonFolder(entries.map((e) => e.fileName));
    const written: string[] = [];
    for (const entry of entries) {
      const rel = entry.fileName.slice(prefix.length);
      if (!rel || rel === META_FILE) continue;
      const target = safeJoin(dest, rel);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await pipeline(await zipfile.openReadStreamPromise(entry), createWriteStream(target));
      written.push(rel);
    }
    return written;
  } finally {
    zipfile.close();
  }
}

function readEntries(zipfile: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = [];
    zipfile.on('entry', (entry: yauzl.Entry) => {
      entries.push(entry);
      zipfile.readEntry();
    });
    zipfile.on('end', () => resolve(entries));
    zipfile.on('error', (err: Error) => reject(new HttpError(400, `Invalid ZIP: ${err.message}`)));
    zipfile.readEntry();
  });
}

function commonFolder(names: string[]): string {
  const first = names[0]?.split('/')[0];
  if (!first || names.some((n) => !n.startsWith(`${first}/`))) return '';
  return `${first}/`;
}

/** Pick the main file (main.tex, else the shallowest .tex with \documentclass) and guess the engine. */
export async function detectMainFile(dir: string, files: string[]): Promise<{ mainFile: string; engine: Engine }> {
  const texFiles = files
    .filter((f) => f.toLowerCase().endsWith('.tex'))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  let mainFile = texFiles.includes('main.tex') ? 'main.tex' : '';
  for (const f of mainFile ? [] : texFiles) {
    const content = await fs.readFile(path.join(dir, f), 'utf8');
    if (/^[^%\n]*\\documentclass/m.test(content)) {
      mainFile = f;
      break;
    }
  }
  mainFile ||= texFiles[0] ?? 'main.tex';

  const source = await fs.readFile(path.join(dir, mainFile), 'utf8').catch(() => '');
  const engine: Engine = /^[^%\n]*\\usepackage(\[[^\]]*\])?\{[^}]*\b(fontspec|unicode-math)\b/m.test(source)
    ? 'xelatex'
    : 'pdflatex';
  return { mainFile, engine };
}
