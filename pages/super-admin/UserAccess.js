import React, { useEffect, useState, useCallback } from 'react';
import styles from '../../styles/superadmin.module.css';

const ROLE_COLORS = {
  'Super Admin': { bg: 'color-mix(in srgb, var(--sa-primary, #7c3aed) 12%, #fff)', text: 'var(--sa-primary, #7c3aed)' },
  'Admin':       { bg: '#dbeafe', text: '#2563eb' },
  'Salesperson': { bg: '#dcfce7', text: '#16a34a' },
};

function Avatar({ name, email, avatarUrl, size = 38 }) {
  const initial = (name || email || '?')[0].toUpperCase();
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name || email || 'User'}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      className={styles.avatar}
      style={size !== 38 ? { width: size, height: size, fontSize: `${Math.round(size * 0.37)}px` } : {}}
    >
      {initial}
    </div>
  );
}

export default function UserAccess({ token }) {
  const [users,      setUsers]      = useState([]);
  const [roles,      setRoles]      = useState([]);
  const [regions,    setRegions]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Add/Edit panel
  const [panelOpen, setPanelOpen] = useState(false);
  const [editUser,  setEditUser]  = useState(null);
  const [form,      setForm]      = useState(blankForm());
  const [saving,    setSaving]    = useState(false);
  const [formErr,   setFormErr]   = useState('');

  // Reset password dialog
  const [resetOpen,   setResetOpen]   = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetResult, setResetResult] = useState(null);
  const [resetting,   setResetting]   = useState(false);

  // Delete dialog
  const [deleteOpen,   setDeleteOpen]   = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting,     setDeleting]     = useState(false);

  // Toast
  const [toast, setToast] = useState(null);

  // Avatar upload
  const [avatarFile,    setAvatarFile]    = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);

  // ── helpers ────────────────────────────────────────────────────────────────
  function blankForm() {
    return { email: '', full_name: '', role_id: '', vehicle: '', vehicle_type: '', fuel_rate_km_per_litre: '', fuel_type: '', username: '', position: '', is_active: true, region_ids: [], avatar_url: '' };
  }

  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }

  // Safely parse JSON — returns { error } if the response is not JSON (e.g. 500 HTML pages)
  async function safeJson(res) {
    const text = await res.text();
    try { return JSON.parse(text); }
    catch { return { error: `Server error (HTTP ${res.status})` }; }
  }

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const toBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setFormErr('Photo must be under 5 MB'); return; }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  // ── data ───────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    const headers = authHeaders();
    const [uRes, rRes, rgRes] = await Promise.all([
      fetch('/api/admin/users', { headers }),
      fetch('/api/admin/roles', { headers }),
      fetch('/api/admin/regions', { headers }),
    ]);
    const [uData, rData, rgData] = await Promise.all([safeJson(uRes), safeJson(rRes), safeJson(rgRes)]);
    if (!uRes.ok) { showToast(uData.error || 'Failed to load users', 'error'); }
    if (!rRes.ok) { showToast(rData.error || 'Failed to load roles', 'error'); }
    setUsers(Array.isArray(uData) ? uData : []);
    setRoles(Array.isArray(rData) ? rData : []);
    setRegions(Array.isArray(rgData) ? rgData : []);
    setLoading(false);
  }, [token]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── panel ──────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditUser(null);
    setForm(blankForm());
    setAvatarFile(null);
    setAvatarPreview(null);
    setFormErr('');
    setPanelOpen(true);
  };

  const openEdit = (u) => {
    setEditUser(u);
    setForm({
      email:       u.email,
      full_name:   u.full_name || '',
      role_id:     String(u.role_id || ''),
      vehicle:     u.vehicle || '',
      is_active:   u.is_active,
      vehicle_type: u.vehicle || '',
      fuel_rate_km_per_litre: u.fuel_rate_km_per_litre || '',
      fuel_type: u.fuel_type || '',
      username:    u.username || '',
      position:    u.position || '',
      send_invite: false,
      region_ids:  (u.user_regions || []).map(ur => ur.region_id),
      avatar_url:  u.avatar_url || '',
    });
    setAvatarFile(null);
    setAvatarPreview(null);
    setFormErr('');
    setPanelOpen(true);
  };

  const handleSave = async () => {
    if (!form.email.trim()) { setFormErr('Email is required'); return; }
    if (!form.role_id)      { setFormErr('Role is required');  return; }
    setSaving(true);
    setFormErr('');

    const h = authHeaders();
    let res;
    if (editUser) {
      res = await fetch(`/api/admin/users/${editUser.id}`, {
        method: 'PUT', headers: h,
        body: JSON.stringify({
          full_name:  form.full_name,
          role_id:    form.role_id,
          vehicle:    form.vehicle,
            vehicle_type: form.vehicle_type,
            fuel_rate_km_per_litre: form.fuel_rate_km_per_litre,
            fuel_type: form.fuel_type,
          username:   form.username,
          position:   form.position,
          is_active:  form.is_active,
          region_ids: form.region_ids,
        }),
      });
    } else {
      res = await fetch('/api/admin/users', {
        method: 'POST', headers: h,
        body: JSON.stringify(form),
      });
    }

    const body = await safeJson(res);
    if (!res.ok) { setSaving(false); setFormErr(body.error || 'Failed to save'); return; }

    const userId = editUser ? editUser.id : body.id;

    // Upload avatar if a new file was selected
    if (avatarFile && userId) {
      try {
        const dataUrl = await toBase64(avatarFile);
        await fetch(`/api/admin/users/${userId}/avatar`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ avatar_data: dataUrl }),
        });
      } catch {
        // user saved, only photo upload failed — non-fatal
      }
    }

    setSaving(false);
    setPanelOpen(false);

    if (!editUser) {
      // Auto-open the invite link dialog for the newly created user
      const newUserRef = { email: (form.email || '').toLowerCase().trim(), full_name: form.full_name };
      setResetTarget(newUserRef);
      setResetResult(null);
      setResetOpen(true);
      handleReset(newUserRef);
    } else {
      showToast('User updated successfully');
    }

    loadData();
  };

  // ── toggle status ──────────────────────────────────────────────────────────
  const handleToggle = async (u) => {
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({
        full_name: u.full_name,
        role_id:   u.role_id,
        vehicle:   u.vehicle,
        is_active: !u.is_active,
      }),
    });
    if (res.ok) {
      showToast(`User ${!u.is_active ? 'enabled' : 'disabled'}`);
      loadData();
    } else {
      showToast('Failed to update status', 'error');
    }
  };

  // ── reset password ─────────────────────────────────────────────────────────
  const openReset = (u) => {
    setResetTarget(u);
    setResetResult(null);
    setResetOpen(true);
  };

  const handleReset = async (targetOverride) => {
    const tgt = targetOverride || resetTarget;
    setResetting(true);
    const res = await fetch('/api/admin/users/reset-password', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ email: tgt.email }),
    });
    const body = await safeJson(res);
    setResetting(false);
    setResetResult(res.ok ? body : { error: body.error });
  };

  // ── delete user ────────────────────────────────────────────────────────────
  const openDelete = (u) => { setDeleteTarget(u); setDeleteOpen(true); };

  const handleDelete = async () => {
    setDeleting(true);
    const res = await fetch(`/api/admin/users/${deleteTarget.id}`, {
      method: 'DELETE', headers: authHeaders(),
    });
    const body = await safeJson(res);
    setDeleting(false);
    setDeleteOpen(false);
    if (res.ok) {
      showToast('User deleted successfully');
      loadData();
    } else {
      showToast(body.error || 'Failed to delete user', 'error');
    }
  };

  // ── filter ─────────────────────────────────────────────────────────────────
  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    if (q && !u.email.toLowerCase().includes(q) && !(u.full_name || '').toLowerCase().includes(q)) return false;
    if (filterRole   && String(u.role_id) !== filterRole) return false;
    if (filterStatus === 'active'   && !u.is_active)  return false;
    if (filterStatus === 'inactive' &&  u.is_active)  return false;
    return true;
  });

  const totalActive   = users.filter(u => u.is_active).length;
  const totalInactive = users.filter(u => !u.is_active).length;

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className={styles.uaHeader}>
        <div>
          <h2 className={styles.tabHeading} style={{ marginBottom: 4 }}>User & Access</h2>
          <p className={styles.tabSubtitle}>Manage accounts, roles and access control</p>
        </div>
        <button className={styles.btnPrimary} onClick={openCreate}>+ Add User</button>
      </div>

      {/* Mini Stats */}
      <div className={styles.statsGrid} style={{ marginBottom: 20 }}>
        {[
          { label: 'Total Users',  value: users.length,  color: 'var(--sa-primary, #7c3aed)' },
          { label: 'Active',       value: totalActive,   color: '#16a34a' },
          { label: 'Inactive',     value: totalInactive, color: '#dc2626' },
        ].map(s => (
          <div key={s.label} className={styles.statCard}>
            <div className={styles.statLabel}>{s.label}</div>
            <div className={styles.statValue} style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className={styles.filterBar}>
        <input
          className={styles.filterInput}
          placeholder="Search name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className={styles.filterSelect} value={filterRole} onChange={e => setFilterRole(e.target.value)}>
          <option value="">All Roles</option>
          {roles.map(r => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
        </select>
        <select className={styles.filterSelect} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Table */}
      <div className={styles.tableWrap}>
        {loading ? (
          <div className={styles.tableEmpty}>Loading users…</div>
        ) : filtered.length === 0 ? (
          <div className={styles.tableEmpty}>
            {users.length === 0 ? 'No users yet. Click "+ Add User" to get started.' : 'No users match the current filters.'}
          </div>
        ) : (
          <table className={styles.uaTable}>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Regions</th>
                <th>Vehicle</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => {
                const rc = ROLE_COLORS[u.roles?.name] || { bg: '#f3f4f6', text: '#374151' };
                return (
                  <tr key={u.id}>
                    <td>
                      <div className={styles.userCell}>
                        <Avatar name={u.full_name} email={u.email} avatarUrl={u.avatar_url} />
                        <div>
                          <div className={styles.userName}>{u.full_name || '—'}</div>
                          <div className={styles.userEmail}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={styles.rolePill} style={{ background: rc.bg, color: rc.text }}>
                        {u.roles?.name || '—'}
                      </span>
                    </td>
                    <td>
                      <div className={styles.regionPills}>
                        {(u.user_regions || []).length === 0
                          ? <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>—</span>
                          : (u.user_regions || []).map(ur => {
                              const rg = regions.find(r => r.id === ur.region_id);
                              return rg ? (
                                <span key={rg.id} className={styles.regionMiniPill}>{rg.name}</span>
                              ) : null;
                            })
                        }
                      </div>
                    </td>
                    <td className={styles.vehicleCell}>{u.vehicle ? u.vehicle.charAt(0).toUpperCase() + u.vehicle.slice(1) : '—'}</td>
                    <td>
                      <span className={u.is_active ? styles.statusActive : styles.statusInactive}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className={styles.dateCell}>{new Date(u.created_at).toLocaleDateString()}</td>
                    <td>
                      <div className={styles.actionRow}>
                        <button className={styles.actionBtn} title="Edit user" onClick={() => openEdit(u)}>✏️</button>
                        <button
                          className={`${styles.actionBtn} ${u.is_active ? styles.actionBtnWarn : styles.actionBtnGreen}`}
                          title={u.is_active ? 'Disable account' : 'Enable account'}
                          onClick={() => handleToggle(u)}
                        >
                          {u.is_active ? '🔒' : '🔓'}
                        </button>
                        <button className={styles.actionBtn} title="Reset password" onClick={() => openReset(u)}>🔑</button>
                        <button
                          className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                          title="Delete user"
                          onClick={() => openDelete(u)}
                        >🗑 Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Add/Edit Side Panel ─────────────────────────────────────────────── */}
      {panelOpen && (
        <div className={styles.overlay} onClick={() => setPanelOpen(false)}>
          <div className={styles.panel} onClick={e => e.stopPropagation()}>
            <div className={styles.panelHeader}>
              <div>
                <h3 className={styles.panelTitle}>{editUser ? 'Edit User' : 'Add New User'}</h3>
                <p className={styles.panelSub}>
                  {editUser ? 'Update account details and permissions' : 'Whitelist an email and assign a role'}
                </p>
              </div>
              <button className={styles.closeBtn} onClick={() => setPanelOpen(false)}>✕</button>
            </div>

            <div className={styles.panelBody}>
              {formErr && <div className={styles.formError}>{formErr}</div>}

              {/* Profile photo */}
              <div className={styles.avatarUploadArea}>
                <div
                  className={styles.avatarUploadCircle}
                  onClick={() => document.getElementById('avatarInput').click()}
                  title="Click to upload photo"
                >
                  {avatarPreview || form.avatar_url ? (
                    <img
                      src={avatarPreview || form.avatar_url}
                      alt="Preview"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                    />
                  ) : (
                    <div className={styles.avatarUploadPlaceholder}>
                      <span style={{ fontSize: '2rem' }}>👤</span>
                      <span>Photo</span>
                    </div>
                  )}
                  <div className={styles.avatarUploadOverlay}>📷</div>
                </div>
                <input
                  id="avatarInput"
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleAvatarChange}
                />
                {(avatarFile || form.avatar_url) && (
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    style={{ fontSize: '0.72rem', padding: '3px 10px' }}
                    onClick={() => { setAvatarFile(null); setAvatarPreview(null); setForm(f => ({ ...f, avatar_url: '' })); }}
                  >
                    Remove photo
                  </button>
                )}
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Email address *</label>
                <input
                  className="form-control"
                  type="email"
                  placeholder=""
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  readOnly={!!editUser}
                  style={editUser ? { background: '#f8fafc', color: '#94a3b8' } : {}}
                />
                {!editUser && (
                  <span className={styles.formHint}>An invite email will be sent to this address so the user can set their password.</span>
                )}
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Full Name</label>
                <input
                  className="form-control"
                  placeholder=""
                  value={form.full_name}
                  onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Username</label>
                <input
                  className="form-control"
                  placeholder="e.g. john.doe"
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
                <span className={styles.formHint}>Optional — allows login without email. Must be unique.</span>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Position</label>
                <input
                  className="form-control"
                  placeholder="e.g. Country Manager, Sales Rep"
                  value={form.position}
                  onChange={e => setForm(f => ({ ...f, position: e.target.value }))}
                />
                <span className={styles.formHint}>Optional — shown under the user's name in the app.</span>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Role *</label>
                <select
                  className="form-select"
                  value={form.role_id}
                  onChange={e => setForm(f => ({ ...f, role_id: e.target.value }))}
                >
                  <option value="">Select a role…</option>
                  {roles.map(r => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Vehicle Type</label>
                <select
                  className="form-select"
                  value={form.vehicle_type || form.vehicle}
                  onChange={e => setForm(f => ({ ...f, vehicle_type: e.target.value, vehicle: e.target.value }))}
                >
                  <option value="">None</option>
                  <option value="motorbike">Motorbike</option>
                  <option value="van">Van</option>
                  <option value="bicycle">Bicycle</option>
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Fuel rate (km per litre)</label>
                <input
                  className="form-control"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 16"
                  value={form.fuel_rate_km_per_litre || ''}
                  onChange={e => setForm(f => ({ ...f, fuel_rate_km_per_litre: e.target.value }))}
                />
                <span className={styles.formHint}>Optional — used by Fuel Management calculations</span>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Fuel Type (optional)</label>
                <select
                  className="form-select"
                  value={form.fuel_type || ''}
                  onChange={e => setForm(f => ({ ...f, fuel_type: e.target.value }))}
                >
                  <option value="">Use vehicle default</option>
                  <option value="petrol">Petrol</option>
                  <option value="diesel">Diesel</option>
                </select>
                <span className={styles.formHint}>Optional — overrides vehicle default fuel type</span>
              </div>

              {editUser && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Account Status</label>
                  <div className={styles.toggleRow}>
                    <span style={{ fontSize: '0.875rem', color: '#374151' }}>
                      {form.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <button
                      type="button"
                      className={`${styles.toggle} ${form.is_active ? styles.toggleOn : ''}`}
                      onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                    />
                  </div>
                </div>
              )}

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Assign Regions</label>
                <div className={styles.regionCheckList}>
                  {regions.length === 0 ? (
                    <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No regions available. Add regions first.</span>
                  ) : (
                    regions.map(r => {
                      const checked = form.region_ids.includes(r.id);
                      return (
                        <label key={r.id} className={styles.regionCheckItem}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setForm(f => ({
                              ...f,
                              region_ids: checked
                                ? f.region_ids.filter(id => id !== r.id)
                                : [...f.region_ids, r.id],
                            }))}
                            style={{ accentColor: 'var(--sa-primary, #7c3aed)', width: 15, height: 15, cursor: 'pointer', flexShrink: 0 }}
                          />
                          <span>{r.name}</span>
                        </label>
                      );
                    })
                  )}
                </div>
                <span className={styles.formHint}>
                  {form.region_ids.length === 0 ? 'No regions assigned' : `${form.region_ids.length} region${form.region_ids.length !== 1 ? 's' : ''} selected`}
                </span>
              </div>


            </div>

            <div className={styles.panelFooter}>
              <button className={styles.btnSecondary} onClick={() => setPanelOpen(false)}>Cancel</button>
              <button className={styles.btnPrimary} onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : editUser ? 'Save Changes' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Invite / Reset Link Dialog */}
      {resetOpen && resetTarget && (
        <div className={styles.overlay} onClick={() => setResetOpen(false)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <div className={styles.panelHeader} style={{ borderRadius: '16px 16px 0 0' }}>
              <div>
                <h3 className={styles.panelTitle}>
                  {resetResult && !resetResult.error ? '🔗 Invite Link Ready' : '🔑 Generate Invite Link'}
                </h3>
                <p className={styles.panelSub}>{resetTarget.email}</p>
              </div>
              <button className={styles.closeBtn} onClick={() => setResetOpen(false)}>✕</button>
            </div>

            <div className={styles.panelBody} style={{ padding: 24 }}>
              {resetting ? (
                <p style={{ color: '#64748b', fontSize: '0.9rem', textAlign: 'center', margin: 0 }}>
                  ⏳ Generating secure link…
                </p>
              ) : !resetResult ? (
                <p style={{ color: '#475569', fontSize: '0.9rem', margin: 0 }}>
                  A secure invite link will be generated for{' '}
                  <strong>{resetTarget?.email}</strong>.<br />
                  Copy and send it to the user via WhatsApp or chat. It expires in 1 hour.
                </p>
              ) : resetResult.error ? (
                <div className={styles.formError}>{resetResult.error}</div>
              ) : (
                <div>
                  <div className={styles.successBox} style={{ marginBottom: 12 }}>
                    <span style={{ fontSize: '1.6rem' }}>🔗</span>
                    <p style={{ margin: 0 }}>
                      <strong>Link generated!</strong><br />
                      Share this link with the user. It expires in 1 hour.
                    </p>
                  </div>
                  <div className={styles.linkBox} style={{ marginBottom: 12 }}>
                    <span style={{ fontSize: '0.75rem', wordBreak: 'break-all', flex: 1, color: '#334155' }}>
                      {resetResult.link}
                    </span>
                    <button
                      className={styles.copyBtn}
                      onClick={() =>
                        navigator.clipboard.writeText(resetResult.link).then(() => showToast('Link copied!'))
                      }
                    >
                      Copy
                    </button>
                  </div>
                  <button
                    style={{
                      width: '100%', padding: '10px 16px', borderRadius: 8, border: 'none',
                      background: '#25D366', color: '#fff', fontWeight: 600,
                      fontSize: '0.9rem', cursor: 'pointer', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                    onClick={() => {
                      const name = resetTarget?.full_name || resetTarget?.email;
                      const msg = encodeURIComponent(
                        `Hi ${name}! 👋\n\nYour account has been created on the Sales Visit System.\n\nClick the link below to set your password:\n\n${resetResult.link}\n\n⚠️ This link expires in 1 hour and can only be used once.`
                      );
                      window.open(`https://wa.me/?text=${msg}`, '_blank', 'noopener,noreferrer');
                    }}
                  >
                    <span>📲</span> Share via WhatsApp
                  </button>
                </div>
              )}
            </div>

            <div className={styles.panelFooter}>
              <button className={styles.btnSecondary} onClick={() => setResetOpen(false)}>
                {resetResult ? 'Close' : 'Cancel'}
              </button>
              {(!resetResult || resetResult.error) ? (
                <button className={styles.btnPrimary} onClick={() => handleReset()} disabled={resetting}>
                  {resetting ? 'Generating…' : 'Generate Link'}
                </button>
              ) : (
                <button className={styles.btnSecondary} onClick={() => { setResetResult(null); handleReset(); }}>
                  🔄 Regenerate
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* ── Delete Confirm Dialog ─────────────────────────────────────────────── */}
      {deleteOpen && deleteTarget && (
        <div className={styles.overlay} onClick={() => setDeleteOpen(false)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <div className={styles.panelHeader} style={{ borderRadius: '16px 16px 0 0' }}>
              <div>
                <h3 className={styles.panelTitle}>Delete User</h3>
                <p className={styles.panelSub}>{deleteTarget.email}</p>
              </div>
              <button className={styles.closeBtn} onClick={() => setDeleteOpen(false)}>✕</button>
            </div>
            <div className={styles.panelBody} style={{ padding: 24 }}>
              <p style={{ color: '#475569', fontSize: '0.9rem', margin: 0 }}>
                Are you sure you want to permanently delete{' '}
                <strong>{deleteTarget.full_name || deleteTarget.email}</strong>?
                This will remove their account and all access. This action cannot be undone.
              </p>
            </div>
            <div className={styles.panelFooter}>
              <button className={styles.btnSecondary} onClick={() => setDeleteOpen(false)} disabled={deleting}>
                Cancel
              </button>
              <button
                style={{
                  background: 'linear-gradient(90deg,#dc2626,#ef4444)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 20px',
                  fontWeight: 600,
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  opacity: deleting ? 0.7 : 1,
                }}
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Dialog ───────────────────────────────────────────── */}
      {deleteOpen && deleteTarget && (
        <div className={styles.overlay} onClick={() => setDeleteOpen(false)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <div className={styles.panelHeader} style={{ borderRadius: '16px 16px 0 0' }}>
              <div>
                <h3 className={styles.panelTitle}>Delete User</h3>
                <p className={styles.panelSub}>{deleteTarget.email}</p>
              </div>
              <button className={styles.closeBtn} onClick={() => setDeleteOpen(false)}>✕</button>
            </div>
            <div className={styles.panelBody} style={{ padding: 24 }}>
              <p style={{ color: '#475569', fontSize: '0.9rem', margin: 0 }}>
                Are you sure you want to permanently delete{' '}
                <strong>{deleteTarget.full_name || deleteTarget.email}</strong>?
                This will remove their account and all access. This action cannot be undone.
              </p>
            </div>
            <div className={styles.panelFooter}>
              <button className={styles.btnSecondary} onClick={() => setDeleteOpen(false)} disabled={deleting}>
                Cancel
              </button>
              <button
                style={{
                  background: 'linear-gradient(90deg,#dc2626,#ef4444)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 20px',
                  fontWeight: 600,
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  opacity: deleting ? 0.7 : 1,
                }}
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ─────────────────────────────────────────────────────────────── */}
      {toast && (
        <div className={`${styles.toast} ${toast.type === 'error' ? styles.toastError : styles.toastSuccess}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
