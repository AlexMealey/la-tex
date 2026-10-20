import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, type Me } from '../api';
import { parseHash } from '../auth';

const PASSWORD_MIN = 10;

interface Props {
  hash: string;
  onSignedIn: (user: Me, recoveryCode?: string) => void;
}

/** Shown when nobody is logged in: log in, register from an invite link, or recover an account. */
export default function AuthPage({ hash, onSignedIn }: Props) {
  const { route, params } = parseHash(hash);
  let title = 'Log in';
  let form: ReactNode = <LoginForm onSignedIn={onSignedIn} />;
  if (route === '/register') {
    title = 'Create your account';
    form = <RegisterForm token={params.get('invite') ?? ''} onSignedIn={onSignedIn} />;
  } else if (route === '/recover') {
    title = 'Reset your password';
    form = <RecoverForm onSignedIn={onSignedIn} />;
  }
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>LaTeX Editor</h1>
        <h2>{title}</h2>
        {form}
      </div>
    </div>
  );
}

/** Also used to log back in when a session expires, with `username` fixed. */
export function LoginForm({ onSignedIn, username: fixedUsername }: { onSignedIn: (user: Me) => void; username?: string }) {
  const [username, setUsername] = useState(fixedUsername ?? '');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useSubmit();

  return (
    <form className="stack" onSubmit={run(async () => onSignedIn(await api.login(username, password)))}>
      <label className="field-block">
        <span>Username</span>
        <input
          autoFocus={!fixedUsername}
          autoComplete="username"
          value={username}
          readOnly={!!fixedUsername}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </label>
      <label className="field-block">
        <span>Password</span>
        <input
          autoFocus={!!fixedUsername}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error && <div className="banner error">{error}</div>}
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? 'Logging in…' : 'Log in'}
      </button>
      {!fixedUsername && (
        <p className="muted small">
          Forgot your password? <a href="#/recover">Use your recovery code</a>.
        </p>
      )}
    </form>
  );
}

function RegisterForm({ token, onSignedIn }: { token: string; onSignedIn: Props['onSignedIn'] }) {
  const [invite, setInvite] = useState<{ valid: boolean; isAdmin: boolean } | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { busy, error, run } = useSubmit();

  useEffect(() => {
    api.inviteInfo(token).then(setInvite, () => setInvite({ valid: false, isAdmin: false }));
  }, [token]);

  if (!invite) return <p className="muted">Checking your invite…</p>;
  if (!invite.valid) {
    return (
      <div className="stack">
        <div className="banner error">This invite link is invalid, already used or expired. Ask for a new one.</div>
        <a href="#/">Log in instead</a>
      </div>
    );
  }

  const submit = run(async () => {
    if (password !== confirm) throw new Error('The passwords don’t match');
    const { user, recoveryCode } = await api.register(token, username, password);
    onSignedIn(user, recoveryCode);
  });

  return (
    <form className="stack" onSubmit={submit}>
      {invite.isAdmin && <div className="banner info">This invite creates an admin account.</div>}
      <label className="field-block">
        <span>Username</span>
        <input
          autoFocus
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          pattern="[A-Za-z0-9_.\-]{3,32}"
          title="3–32 letters, digits, dots, dashes or underscores"
          required
        />
      </label>
      <NewPasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
      <p className="muted small">
        Your files are encrypted with a key that only your password unlocks. Next you’ll get a recovery code: without
        it, a forgotten password means your files can’t be recovered by anyone.
      </p>
      {error && <div className="banner error">{error}</div>}
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}

function RecoverForm({ onSignedIn }: { onSignedIn: Props['onSignedIn'] }) {
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { busy, error, run } = useSubmit();

  const submit = run(async () => {
    if (password !== confirm) throw new Error('The passwords don’t match');
    const { user, recoveryCode } = await api.recover(username, code, password);
    onSignedIn(user, recoveryCode);
  });

  return (
    <form className="stack" onSubmit={submit}>
      <label className="field-block">
        <span>Username</span>
        <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
      </label>
      <label className="field-block">
        <span>Recovery code</span>
        <input
          className="mono"
          autoComplete="off"
          spellCheck={false}
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
      </label>
      <NewPasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
      <p className="muted small">This logs out all your other sessions and gives you a new recovery code.</p>
      {error && <div className="banner error">{error}</div>}
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? 'Resetting…' : 'Reset password'}
      </button>
      <a href="#/" className="small">
        Back to log in
      </a>
    </form>
  );
}

export function NewPasswordFields(props: {
  password: string;
  confirm: string;
  onPassword: (value: string) => void;
  onConfirm: (value: string) => void;
}) {
  return (
    <>
      <label className="field-block">
        <span>New password</span>
        <input
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          value={props.password}
          onChange={(e) => props.onPassword(e.target.value)}
          required
        />
        <small className="muted">At least {PASSWORD_MIN} characters. A few random words work well.</small>
      </label>
      <label className="field-block">
        <span>Confirm new password</span>
        <input
          type="password"
          autoComplete="new-password"
          value={props.confirm}
          onChange={(e) => props.onConfirm(e.target.value)}
          required
        />
      </label>
    </>
  );
}

/** Form submit state: `run(fn)` makes a submit handler that shows `fn`'s error, if any. */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}
