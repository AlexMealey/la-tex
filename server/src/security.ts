import type { RequestHandler } from 'express';
import { HttpError } from './http.js';

// CodeMirror injects <style> elements; pdf.js runs in a same-origin worker and may use WebAssembly.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export const securityHeaders: RequestHandler = (req, res, next) => {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Reject state-changing requests sent from other sites. The session cookie is SameSite=Strict
 * already; this also covers browsers that ignore that, since several endpoints accept
 * "simple" cross-site requests (multipart uploads, text bodies, empty POSTs).
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const site = req.get('sec-fetch-site');
  if (site) {
    if (site !== 'same-origin') throw new HttpError(403, 'Cross-site request blocked');
    return next();
  }
  const origin = req.get('origin');
  if (origin) {
    let host: string | null = null;
    try {
      host = new URL(origin).host;
    } catch {
      // "null" or garbage
    }
    if (host !== req.get('host')) throw new HttpError(403, 'Cross-site request blocked');
  }
  next();
};
