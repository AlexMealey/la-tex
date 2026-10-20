import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { HttpError } from './http.js';
import { META_FILE } from './paths.js';
import type { Engine } from './projects.js';
import type { ProjectStore } from './storage.js';

const MAX_ENTRIES = 5000;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;

/** Files are decrypted one at a time, as the ZIP is streamed out. */
export async function writeProjectZip(store: ProjectStore, out: NodeJS.WritableStream): Promise<void> {
  const zip = new yazl.ZipFile();
  zip.on('error', (err: Error) => zip.outputStream.emit('error', err));
  for (const [p, entry] of (await store.snapshot()).entries) {
    if (entry.type === 'dir') zip.addEmptyDirectory(p);
    else zip.addReadStream(Readable.from(readLazily(store, p), { objectMode: false }), p);
  }
  zip.end();
  await pipeline(zip.outputStream, out);
}

async function* readLazily(store: ProjectStore, file: string): AsyncGenerator<Buffer> {
  yield await store.read(file);
}

/**
 * Extract an uploaded ZIP (e.g. Overleaf's "Download Source") into a project.
 * yauzl rejects absolute and `..` entry names; the store checks paths again before writing.
 * A single top-level folder wrapping everything is stripped.
 */
export async function extractZip(buffer: Buffer, store: ProjectStore): Promise<string[]> {
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
    async function* contents(): AsyncGenerator<[string, Buffer]> {
      for (const entry of entries) {
        const rel = entry.fileName.slice(prefix.length);
        if (!rel || rel === META_FILE) continue;
        const chunks: Buffer[] = await (await zipfile.openReadStreamPromise(entry)).toArray();
        yield [rel, Buffer.concat(chunks)];
      }
    }
    return await store.writeMany(contents());
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
export async function detectMainFile(store: ProjectStore, files: string[]): Promise<{ mainFile: string; engine: Engine }> {
  const texFiles = files
    .filter((f) => f.toLowerCase().endsWith('.tex'))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  let mainFile = texFiles.includes('main.tex') ? 'main.tex' : '';
  for (const f of mainFile ? [] : texFiles) {
    const content = (await store.read(f)).toString('utf8');
    if (/^[^%\n]*\\documentclass/m.test(content)) {
      mainFile = f;
      break;
    }
  }
  mainFile ||= texFiles[0] ?? 'main.tex';

  const source = await store.read(mainFile).then((b) => b.toString('utf8'), () => '');
  const engine: Engine = /^[^%\n]*\\usepackage(\[[^\]]*\])?\{[^}]*\b(fontspec|unicode-math)\b/m.test(source)
    ? 'xelatex'
    : 'pdflatex';
  return { mainFile, engine };
}
