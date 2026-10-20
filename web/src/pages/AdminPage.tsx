import { useCallback, useEffect, useState } from 'react';
import { api, type AdminUser, type Invite } from '../api';
import { useAuth } from '../auth';
import UserMenu from '../components/UserMenu';

const date = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : '—');

export default function AdminPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [inviteAdmin, setInviteAdmin] = useState(false);
  const [newLink, setNewLink] = useState<{ url: string; isAdmin: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (err: unknown) => setError((err as Error).message);
  const load = useCallback(() => {
    api.admin.users().then(setUsers, fail);
    api.admin.invites().then(setInvites, fail);
  }, []);
  useEffect(load, [load]);

  async function createInvite() {
    setError(null);
    setCopied(false);
    try {
      const invite = await api.admin.createInvite(inviteAdmin);
      const url = `${window.location.origin}${window.location.pathname}#/register?invite=${invite.token}`;
      setNewLink({ url, isAdmin: invite.isAdmin });
      load();
    } catch (err) {
      fail(err);
    }
  }

  async function copyLink() {
    if (!newLink) return;
    try {
      await navigator.clipboard.writeText(newLink.url);
      setCopied(true);
    } catch {
      // Clipboard needs HTTPS; the link can still be selected by hand.
    }
  }

  async function revoke(invite: Invite) {
    await api.admin.revokeInvite(invite.id).catch(fail);
    load();
  }

  async function toggleDisabled(u: AdminUser) {
    if (!u.disabled && !window.confirm(`Disable ${u.username}? They will be logged out and can't log in.`)) return;
    await api.admin.setDisabled(u.id, !u.disabled).catch(fail);
    load();
  }

  async function remove(u: AdminUser) {
    if (!window.confirm(`Delete ${u.username} and all of their projects? This cannot be undone.`)) return;
    await api.admin.deleteUser(u.id).catch(fail);
    load();
  }

  return (
    <div className="home">
      <header className="home-header">
        <div className="row">
          <a className="btn ghost" href="#/">
            ← Projects
          </a>
          <h1>Users and invites</h1>
        </div>
        <UserMenu />
      </header>

      {error && <div className="banner error">{error}</div>}

      <section className="admin-section">
        <h2>Invite someone</h2>
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={inviteAdmin} onChange={(e) => setInviteAdmin(e.target.checked)} />
            Admin account
          </label>
          <button className="btn primary" onClick={createInvite}>
            Create invite link
          </button>
        </div>
        {newLink && (
          <div className="banner info invite-banner">
            <input className="invite-link" readOnly value={newLink.url} onFocus={(e) => e.target.select()} />
            <button className="btn small" onClick={copyLink}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <span className="muted small">
              Send this {newLink.isAdmin ? 'admin ' : ''}link privately. It works once and expires in 7 days.
            </span>
          </div>
        )}
        {invites && invites.length > 0 && (
          <table className="project-table">
            <thead>
              <tr>
                <th>Pending invite</th>
                <th>Created by</th>
                <th>Expires</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <td>
                    {date(i.createdAt)} {i.isAdmin && <span className="tag">admin</span>}
                  </td>
                  <td className="muted">{i.createdBy ?? '—'}</td>
                  <td className="muted">{date(i.expiresAt)}</td>
                  <td className="row end">
                    <button className="btn small ghost danger" onClick={() => revoke(i)}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="admin-section">
        <h2>Users</h2>
        {users === null && !error && <p className="muted">Loading…</p>}
        {users && (
          <table className="project-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Created</th>
                <th>Last active</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.username}</strong> {u.isAdmin && <span className="tag">admin</span>}{' '}
                    {u.disabled && <span className="tag warn">disabled</span>}{' '}
                    {u.id === me.id && <span className="tag user">you</span>}
                  </td>
                  <td className="muted">{date(u.createdAt)}</td>
                  <td className="muted">{date(u.lastSeenAt)}</td>
                  <td className="row end">
                    {u.id !== me.id && (
                      <>
                        <button className="btn small ghost" onClick={() => toggleDisabled(u)}>
                          {u.disabled ? 'Enable' : 'Disable'}
                        </button>
                        <button className="btn small ghost danger" onClick={() => remove(u)}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">
          Admins can’t reset passwords: each user’s files are encrypted with a key that only their password or recovery
          code unlocks. Someone who has lost both can only be deleted and invited again.
        </p>
      </section>
    </div>
  );
}
