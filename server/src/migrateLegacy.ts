import fs from 'node:fs/promises';
import path from 'node:path';
import type { SessionUser } from './auth.js';
import { config } from './config.js';
import { META_FILE } from './paths.js';
import { ENGINES, listFiles, readDiskFiles, type Engine } from './projects.js';
import { ProjectStore } from './storage.js';

/**
 * Projects from before accounts existed are plaintext folders in PROJECTS_DIR. When the first
 * admin registers, encrypt them into that account and move the originals aside. They are never
 * deleted automatically.
 */
export async function importLegacyProjects(user: SessionUser): Promise<void> {
  const root = config.legacyProjectsDir;
  const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  let imported = 0;
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(root, d.name);
    const raw = await fs.readFile(path.join(dir, META_FILE), 'utf8').catch(() => null);
    if (raw === null) continue;
    const meta = JSON.parse(raw);
    const now = new Date().toISOString();
    const updatedAt = typeof meta.updatedAt === 'string' ? meta.updatedAt : now;
    const store = await ProjectStore.create(user, {
      name: String(meta.name || d.name),
      engine: ENGINES.includes(meta.engine) ? (meta.engine as Engine) : 'pdflatex',
      mainFile: typeof meta.mainFile === 'string' ? meta.mainFile : 'main.tex',
      createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : now,
      updatedAt,
    });
    for (const f of await listFiles(dir)) if (f.type === 'dir') await store.mkdir(f.path);
    await store.writeMany(readDiskFiles(dir));
    await store.updateMeta((m) => {
      m.updatedAt = updatedAt;
    });
    imported++;
  }
  if (!imported) return;

  const aside = path.join(config.dataDir, `legacy-plaintext-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  try {
    await fs.rename(root, aside);
    console.warn(
      `Imported ${imported} project(s) into ${user.username}'s encrypted storage. The unencrypted originals ` +
        `were moved to ${aside}: check the projects in the editor, then delete that folder.`,
    );
  } catch (err) {
    console.warn(
      `Imported ${imported} project(s) into ${user.username}'s encrypted storage, but could not move ` +
        `${root} aside (${(err as Error).message}). Delete the unencrypted originals there yourself.`,
    );
  }
}
