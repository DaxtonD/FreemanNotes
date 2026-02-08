import React from 'react';
import { useAuth } from '../authContext';

type AdminUser = {
  id: number;
  email: string;
  name: string | null;
  role: 'admin' | 'user' | string;
  userImageUrl: string | null;
  createdAt?: any;
  updatedAt?: any;
};

async function readError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text || `${res.status} ${res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

export default function UserManagementModal({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const token = auth?.token;
  const me = auth?.user as any;

  const [q, setQ] = React.useState('');
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  const [createEmail, setCreateEmail] = React.useState('');
  const [createName, setCreateName] = React.useState('');
  const [createPassword, setCreatePassword] = React.useState('');
  const [createRole, setCreateRole] = React.useState<'user' | 'admin'>('user');
  const [creating, setCreating] = React.useState(false);

  const canAdmin = String(me?.role || '') === 'admin';

  const loadUsers = React.useCallback(async (query?: string) => {
    if (!token) return;
    setLoading(true);
    setMsg(null);
    try {
      const qs = new URLSearchParams();
      const qq = (query ?? q).trim();
      if (qq) qs.set('q', qq);
      qs.set('take', '200');
      const res = await fetch(`/api/admin/users?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = await res.json();
      setUsers(Array.isArray(data?.users) ? data.users : []);
    } catch (err: any) {
      setMsg(`Error: ${err?.message ?? String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [token, q]);

  React.useEffect(() => {
    if (!canAdmin) return;
    loadUsers('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAdmin]);

  React.useEffect(() => {
    if (!canAdmin) return;
    const t = window.setTimeout(() => {
      loadUsers(q);
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, loadUsers, canAdmin]);

  async function updateRole(userId: number, role: 'admin' | 'user') {
    if (!token) return;
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ role })
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = await res.json();
      const next = data?.user;
      if (next?.id) {
        setUsers((prev) => prev.map((u) => (u.id === next.id ? { ...u, ...next } : u)));
      } else {
        await loadUsers();
      }
    } catch (err: any) {
      setMsg(`Error: ${err?.message ?? String(err)}`);
    }
  }

  async function deleteUser(userId: number) {
    if (!token) return;
    if (!window.confirm('Delete this user? This will delete their notes and data.')) return;
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(await readError(res));
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch (err: any) {
      setMsg(`Error: ${err?.message ?? String(err)}`);
    }
  }

  async function createUser(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!token) return;
    setCreating(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          email: createEmail,
          name: createName,
          password: createPassword,
          role: createRole
        })
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = await res.json();
      const created = data?.user;
      if (created?.id) {
        setUsers((prev) => [created, ...prev]);
      } else {
        await loadUsers();
      }
      setCreateEmail('');
      setCreateName('');
      setCreatePassword('');
      setCreateRole('user');
    } catch (err: any) {
      setMsg(`Error: ${err?.message ?? String(err)}`);
    } finally {
      setCreating(false);
    }
  }

  if (!canAdmin) {
    return (
      <div className="image-dialog-backdrop" onClick={() => onClose()}>
        <div className="image-dialog" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
          <div className="dialog-header">
            <strong>User management</strong>
            <button className="icon-close" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <div style={{ padding: 10 }}>
            <div style={{ color: 'var(--muted)' }}>Admin access required.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="image-dialog-backdrop" onClick={() => onClose()}>
      <div className="image-dialog user-mgmt" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <strong>User management</strong>
          <button className="icon-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={{ padding: 10, display: 'grid', gap: 12 }}>
          <div className="user-mgmt__toolbar">
            <input
              className="image-url-input"
              placeholder="Search users (email or name)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button className="btn" type="button" onClick={() => loadUsers()} disabled={loading}>Refresh</button>
          </div>

          {msg && <div style={{ color: 'var(--muted)' }}>{msg}</div>}

          <div className="user-mgmt__list" role="table" aria-label="Users">
            <div className="user-mgmt__row user-mgmt__row--head" role="row">
              <div role="columnheader">User</div>
              <div role="columnheader">Role</div>
              <div role="columnheader" style={{ textAlign: 'right' }}>Actions</div>
            </div>
            {loading ? (
              <div className="user-mgmt__row" role="row">
                <div role="cell" style={{ gridColumn: '1 / -1', color: 'var(--muted)' }}>Loading…</div>
              </div>
            ) : users.length === 0 ? (
              <div className="user-mgmt__row" role="row">
                <div role="cell" style={{ gridColumn: '1 / -1', color: 'var(--muted)' }}>No users found.</div>
              </div>
            ) : (
              users.map((u) => {
                const isMe = Number(u.id) === Number(me?.id);
                return (
                  <div className="user-mgmt__row" key={u.id} role="row">
                    <div role="cell" className="user-mgmt__usercell">
                      {u.userImageUrl ? (
                        <img src={u.userImageUrl} alt="" className="user-mgmt__avatar" />
                      ) : (
                        <div className="avatar user-mgmt__avatar" aria-hidden>{(u.name || u.email || 'U')[0]}</div>
                      )}
                      <div style={{ minWidth: 0 }}>
                        <div className="user-mgmt__email" title={u.email}>{u.email}{isMe ? ' (you)' : ''}</div>
                        {u.name && <div className="user-mgmt__name" title={u.name}>{u.name}</div>}
                      </div>
                    </div>

                    <div role="cell">
                      <select
                        className="image-url-input"
                        value={u.role === 'admin' ? 'admin' : 'user'}
                        onChange={(e) => updateRole(u.id, e.target.value as any)}
                        disabled={isMe}
                        aria-label={`Role for ${u.email}`}
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>

                    <div role="cell" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <button className="btn btn-danger" type="button" onClick={() => deleteUser(u.id)} disabled={isMe}>Delete</button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="user-mgmt__create">
            <div style={{ fontWeight: 700 }}>Create user</div>
            <form onSubmit={createUser} className="user-mgmt__createform">
              <input className="image-url-input" placeholder="Email" value={createEmail} onChange={(e) => setCreateEmail(e.target.value)} />
              <input className="image-url-input" placeholder="Name (optional)" value={createName} onChange={(e) => setCreateName(e.target.value)} />
              <input className="image-url-input" placeholder="Password" type="password" value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} />
              <select className="image-url-input" value={createRole} onChange={(e) => setCreateRole(e.target.value as any)} aria-label="Role">
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              <button className="btn" type="submit" disabled={creating || !createEmail || !createPassword}>Create</button>
            </form>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" type="button" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
