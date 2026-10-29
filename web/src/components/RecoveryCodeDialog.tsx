import { useState } from 'react';
import Modal from './Modal';

/** Shows a new recovery code once. It can't be closed until the user says they've saved it. */
export default function RecoveryCodeDialog({ code, onDone }: { code: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard needs HTTPS; the code can still be selected by hand.
    }
  }

  return (
    <Modal title="Save your recovery code" onClose={() => saved && onDone()}>
      <div className="stack">
        <p>
          If you forget your password, this code is the <strong>only</strong> way to get back into your account. Your
          files are encrypted, so nobody else (not even an admin) can recover them for you.
        </p>
        <code className="recovery-code">{code}</code>
        <div className="row">
          <button type="button" className="btn" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <span className="muted small">Keep it in a password manager or somewhere safe. It is shown only once.</span>
        </div>
        <label className="check">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          I have saved my recovery code
        </label>
        <div className="row end">
          <button type="button" className="btn primary" disabled={!saved} onClick={onDone}>
            Continue
          </button>
        </div>
      </div>
    </Modal>
  );
}
