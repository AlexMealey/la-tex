import type { Request } from 'express';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Route param as a string (merged params are untyped on nested routers). */
export function param(req: Request, name: string): string {
  const value = (req.params as Record<string, unknown>)[name];
  if (Array.isArray(value)) return value.join('/');
  if (typeof value !== 'string') throw new HttpError(400, `Missing parameter: ${name}`);
  return value;
}

/** Strip characters that are awkward in a downloaded file name. */
export function downloadName(name: string, ext: string): string {
  const base = name.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').trim() || 'document';
  return `${base}.${ext}`;
}
