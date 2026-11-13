import { useEffect, useState } from 'react';

export function usePrefersDark(): boolean {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setDark(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return dark;
}

/**
 * `useState` for a number, string or boolean that is remembered in this browser (across refreshes, projects and
 * logins). Falls back to `fallback` when nothing of the same type is stored; `clean` can clamp a stored value. Storage errors (private window, blocked site data) are
 * ignored, so the value still works for the session.
 */
export function useStoredState<T>(
  key: string,
  fallback: T,
  clean: (value: T) => T = (value) => value,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      const stored: unknown = raw === null ? null : JSON.parse(raw);
      return typeof stored === typeof fallback ? clean(stored as T) : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Not persisted; the value still applies to this session.
    }
  }, [key, value]);
  return [value, setValue];
}

export function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export function navigate(to: string): void {
  window.location.hash = to;
}
