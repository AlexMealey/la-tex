export type Engine = 'pdflatex' | 'xelatex' | 'lualatex';
export type TemplateId = 'blank-a4' | 'resume-a4';

export interface ProjectMeta {
  id: string;
  name: string;
  engine: Engine;
  mainFile: string;
  createdAt: string;
  updatedAt: string;
}

export interface FileEntry {
  path: string;
  type: 'file' | 'dir';
  size: number;
  editable: boolean;
}

export interface ProjectDetail extends ProjectMeta {
  files: FileEntry[];
}

export interface LogEntry {
  level: 'error' | 'warning' | 'typesetting';
  file: string | null;
  line: number | null;
  message: string;
}

export interface CompileResult {
  status: 'success' | 'error' | 'timeout';
  durationMs: number;
  errors: LogEntry[];
  warnings: LogEntry[];
  missingFiles: string[];
  pdf: boolean;
  compiledAt: number;
}

export interface PackageView {
  name: string;
  shortdesc: string;
  category: string;
  installable: boolean;
  reason?: string;
  status: 'base' | 'user' | 'available';
}

export interface PackageState {
  tlYear: string;
  repository: string;
  userTree: string;
  installed: PackageView[];
  missingFromManifest: string[];
}

export interface Job {
  id: string;
  action: 'install' | 'remove';
  names: string[];
  status: 'queued' | 'running' | 'success' | 'error';
  log: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // not JSON
    }
    throw new Error(message);
  }
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');
const project = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export const fileUrl = (id: string, path: string) => `${project(id)}/files/${encodePath(path)}`;
export const pdfUrl = (id: string, version: number) => `${project(id)}/pdf?t=${version}`;
export const pdfDownloadUrl = (id: string) => `${project(id)}/pdf?download=1`;
export const zipUrl = (id: string) => `${project(id)}/zip`;

export const api = {
  listProjects: () => request<ProjectMeta[]>('/api/projects'),
  createProject: (name: string, template: TemplateId) =>
    request<ProjectMeta>('/api/projects', json('POST', { name, template })),
  importProject: (file: File) => {
    const form = new FormData();
    form.append('name', file.name.replace(/\.zip$/i, ''));
    form.append('file', file);
    return request<ProjectMeta>('/api/projects/import', { method: 'POST', body: form });
  },
  getProject: (id: string) => request<ProjectDetail>(project(id)),
  updateProject: (id: string, patch: Partial<Pick<ProjectMeta, 'name' | 'engine' | 'mainFile'>>) =>
    request<ProjectMeta>(project(id), json('PATCH', patch)),
  deleteProject: (id: string) => request<unknown>(project(id), { method: 'DELETE' }),

  readFile: (id: string, path: string) => request<string>(fileUrl(id, path)),
  writeFile: (id: string, path: string, content: string) =>
    request<unknown>(fileUrl(id, path), {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: content,
    }),
  deleteFile: (id: string, path: string) => request<unknown>(fileUrl(id, path), { method: 'DELETE' }),
  renameFile: (id: string, from: string, to: string) =>
    request<{ path: string }>(`${project(id)}/rename`, json('POST', { from, to })),
  createFolder: (id: string, path: string) => request<unknown>(`${project(id)}/folders`, json('POST', { path })),
  uploadFiles: (id: string, folder: string, files: File[]) => {
    const form = new FormData();
    form.append('folder', folder);
    form.append('paths', JSON.stringify(files.map((f) => f.name)));
    for (const f of files) form.append('files', f);
    return request<{ uploaded: string[] }>(`${project(id)}/upload`, { method: 'POST', body: form });
  },

  compile: (id: string) => request<CompileResult>(`${project(id)}/compile`, { method: 'POST' }),
  clearBuild: (id: string) => request<unknown>(`${project(id)}/build`, { method: 'DELETE' }),
  getLog: (id: string) => request<string>(`${project(id)}/log`),

  searchPackages: (q: string) => request<PackageView[]>(`/api/packages?q=${encodeURIComponent(q)}`),
  packageState: () => request<PackageState>('/api/packages/state'),
  packagesForFile: (file: string) => request<PackageView[]>(`/api/packages/which?file=${encodeURIComponent(file)}`),
  installPackages: (names: string[]) => request<Job>('/api/packages/install', json('POST', { names })),
  removePackage: (name: string) => request<Job>('/api/packages/remove', json('POST', { name })),
  getJob: (jobId: string) => request<Job>(`/api/packages/jobs/${encodeURIComponent(jobId)}`),
};
