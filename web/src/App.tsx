import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AUTH_REQUIRED_EVENT, AUTH_RESTORED_EVENT, api, type Me } from './api';
import { AuthContext, parseHash, type Auth } from './auth';
import Modal from './components/Modal';
import RecoveryCodeDialog from './components/RecoveryCodeDialog';
import { useHash } from './hooks';
import AdminPage from './pages/AdminPage';
import AuthPage, { LoginForm } from './pages/AuthPage';
import EditorPage from './pages/EditorPage';
import ProjectList from './pages/ProjectList';

/** Replace the URL without adding a history entry (so an invite token isn't left behind). */
function replaceHash(to: string) {
  window.history.replaceState(null, '', `#${to}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export default function App() {
  const hash = useHash();
  const [user, setUser] = useState<Me | null | undefined>(undefined);
  // The session ended while the app was open: ask for the password again on top of the current
  // page, so the editor (and any unsaved text) stays as it is.
  const [expired, setExpired] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    api.me().then(setUser, () => setUser(null));
    const onAuthRequired = () => {
      if (userRef.current) setExpired(true);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);

  const logout = useCallback(async (beforeLogout?: () => Promise<void>) => {
    await beforeLogout?.().catch(() => {});
    await api.logout().catch(() => {});
    setUser(null);
    setExpired(false);
    replaceHash('/');
  }, []);

  const auth = useMemo<Auth | null>(() => (user ? { user, logout } : null), [user, logout]);

  if (user === undefined) return <div className="placeholder">Loading…</div>;

  if (!auth) {
    return (
      <AuthPage
        hash={hash}
        onSignedIn={(signedIn, code) => {
          const { route } = parseHash(window.location.hash);
          if (route === '/register' || route === '/recover') replaceHash('/');
          setUser(signedIn);
          setRecoveryCode(code ?? null);
        }}
      />
    );
  }

  const { route } = parseHash(hash);
  const project = /^\/p\/([^/]+)/.exec(route);
  let page;
  if (project) {
    const id = decodeURIComponent(project[1]);
    page = <EditorPage key={id} projectId={id} />;
  } else if (route === '/admin' && auth.user.isAdmin) {
    page = <AdminPage />;
  } else {
    page = <ProjectList />;
  }

  return (
    <AuthContext.Provider value={auth}>
      {page}
      {expired && (
        <Modal title="Session expired" onClose={() => {}}>
          <div className="stack">
            <p className="muted">Log in again to carry on. Your open work is kept.</p>
            <LoginForm
              username={auth.user.username}
              onSignedIn={() => {
                setExpired(false);
                window.dispatchEvent(new Event(AUTH_RESTORED_EVENT));
              }}
            />
            <button className="link small" onClick={() => logout()}>
              Log out instead
            </button>
          </div>
        </Modal>
      )}
      {recoveryCode && <RecoveryCodeDialog code={recoveryCode} onDone={() => setRecoveryCode(null)} />}
    </AuthContext.Provider>
  );
}
