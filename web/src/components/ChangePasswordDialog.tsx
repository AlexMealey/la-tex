import { useState } from 'react';
import { api } from '../api';
import { NewPasswordFields, useSubmit } from '../pages/AuthPage';
import Modal from './Modal';

interface Props {
  onClose: () => void;
  /** Changing the password also issues a new recovery code. */
  onChanged: (recoveryCode: string) => void;
}

export default function ChangePasswordDialog({ onClose, onChanged }: Props) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { busy, error, run } = useSubmit();

  const submit = run(async () => {
    if (password !== confirm) throw new Error('The new passwords don’t match');
    const { recoveryCode } = await api.changePassword(current, password);
    onChanged(recoveryCode);
  });

  return (
    <Modal title="Change password" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field-block">
          <span>Current password</span>
          <input
            autoFocus
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </label>
        <NewPasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
        <p className="muted small">
          Your other sessions will be logged out, and your old recovery code stops working: you’ll get a new one.
        </p>
        {error && <div className="banner error">{error}</div>}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : 'Change password'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
