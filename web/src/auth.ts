import { createContext, useContext } from 'react';
import type { Me } from './api';

export interface Auth {
  user: Me;
  /** Log out. `beforeLogout` runs first, e.g. to flush unsaved edits while the session still works. */
  logout: (beforeLogout?: () => Promise<void>) => Promise<void>;
}

export const AuthContext = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth() needs a logged-in user');
  return auth;
}

/** Split `#/register?invite=…` into the route and its query parameters. */
export function parseHash(hash: string): { route: string; params: URLSearchParams } {
  const [route, query = ''] = hash.replace(/^#/, '').split('?');
  return { route: route || '/', params: new URLSearchParams(query) };
}
