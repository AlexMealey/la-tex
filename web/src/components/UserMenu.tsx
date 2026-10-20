import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { navigate } from '../hooks';
import ChangePasswordDialog from './ChangePasswordDialog';
import RecoveryCodeDialog from './RecoveryCodeDialog';

/** Username button with account actions. `beforeLogout` lets the editor save pending changes first. */
export default function UserMenu({ beforeLogout }: { beforeLogout?: () => Promise<void> }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="user-menu" ref={ref}>
      <button className="btn ghost" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {user.username}
        {user.isAdmin && <span className="tag">admin</span>}▾
      </button>
      {open && (
        <div className="user-menu-list" role="menu">
          <button className="btn ghost" role="menuitem" onClick={pick(() => setChanging(true))}>
            Change password
          </button>
          {user.isAdmin && (
            <button className="btn ghost" role="menuitem" onClick={pick(() => navigate('/admin'))}>
              Users and invites
            </button>
          )}
          <button className="btn ghost" role="menuitem" onClick={pick(() => void logout(beforeLogout))}>
            Log out
          </button>
        </div>
      )}
      {changing && (
        <ChangePasswordDialog
          onClose={() => setChanging(false)}
          onChanged={(code) => {
            setChanging(false);
            setRecoveryCode(code);
          }}
        />
      )}
      {recoveryCode && <RecoveryCodeDialog code={recoveryCode} onDone={() => setRecoveryCode(null)} />}
    </div>
  );
}
