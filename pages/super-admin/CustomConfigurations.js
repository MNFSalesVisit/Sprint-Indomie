import React, { useEffect, useState, useCallback } from 'react';
import styles from '../../styles/superadmin.module.css';

export default function CustomConfigurations({ token }) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [reasons,    setReasons]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [toast,      setToast]      = useState(null);

  // Add form
  const [addLabel,   setAddLabel]   = useState('');
  const [adding,     setAdding]     = useState(false);
  const [addErr,     setAddErr]     = useState('');

  // Edit inline
  const [editId,     setEditId]     = useState(null);
  const [editLabel,  setEditLabel]  = useState('');
  const [saving,     setSaving]     = useState(false);

  // Delete confirm
  const [delTarget,  setDelTarget]  = useState(null);
  const [deleting,   setDeleting]   = useState(false);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const h = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  async function safeJson(res) {
    const text = await res.text();
    try { return JSON.parse(text); }
    catch { return { error: `Server error (HTTP ${res.status})` }; }
  }

  // ── Load ───────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    const res  = await fetch('/api/super-admin/no-sale-reasons', { headers: h() });
    const body = await safeJson(res);
    setLoading(false);
    if (res.ok) {
      setReasons(body);
    } else {
      showToast(body.error || 'Failed to load reasons', 'error');
    }
  }, [h]);

  useEffect(() => { load(); }, [load]);

  // ── Add ────────────────────────────────────────────────────────────────────
  const handleAdd = async (e) => {
    e.preventDefault();
    if (!addLabel.trim()) { setAddErr('Reason text is required'); return; }
    setAdding(true);
    setAddErr('');
    const maxOrder = reasons.reduce((m, r) => Math.max(m, r.sort_order || 0), 0);
    const res  = await fetch('/api/super-admin/no-sale-reasons', {
      method: 'POST',
      headers: h(),
      body: JSON.stringify({ label: addLabel.trim(), sort_order: maxOrder + 10 }),
    });
    const body = await safeJson(res);
    setAdding(false);
    if (res.ok) {
      setAddLabel('');
      showToast('Reason added');
      load();
    } else {
      setAddErr(body.error || 'Failed to add reason');
    }
  };

  // ── Move up / down ────────────────────────────────────────────────────────
  const handleMove = async (index, direction) => {
    const swapIndex = index + direction; // -1 = up, +1 = down
    if (swapIndex < 0 || swapIndex >= reasons.length) return;

    const a = reasons[index];
    const b = reasons[swapIndex];

    // Optimistically swap in UI
    const updated = [...reasons];
    updated[index]     = { ...a, sort_order: b.sort_order };
    updated[swapIndex] = { ...b, sort_order: a.sort_order };
    updated.sort((x, y) => x.sort_order - y.sort_order || x.id - y.id);
    setReasons(updated);

    // Persist both rows
    await Promise.all([
      fetch('/api/super-admin/no-sale-reasons', {
        method: 'PUT', headers: h(),
        body: JSON.stringify({ id: a.id, sort_order: b.sort_order }),
      }),
      fetch('/api/super-admin/no-sale-reasons', {
        method: 'PUT', headers: h(),
        body: JSON.stringify({ id: b.id, sort_order: a.sort_order }),
      }),
    ]);
  };

  // ── Toggle active ──────────────────────────────────────────────────────────
  const handleToggle = async (reason) => {
    // Optimistically flip in UI immediately
    setReasons(prev => prev.map(r =>
      r.id === reason.id ? { ...r, is_active: !r.is_active } : r
    ));
    const res  = await fetch('/api/super-admin/no-sale-reasons', {
      method: 'PUT',
      headers: h(),
      body: JSON.stringify({ id: reason.id, is_active: !reason.is_active }),
    });
    const body = await safeJson(res);
    if (res.ok) {
      setReasons(prev => prev.map(r => r.id === reason.id ? { ...r, ...body } : r));
      showToast(body.is_active ? 'Reason enabled' : 'Reason disabled');
    } else {
      // Revert on failure
      setReasons(prev => prev.map(r =>
        r.id === reason.id ? { ...r, is_active: reason.is_active } : r
      ));
      showToast(body.error || 'Failed to update', 'error');
    }
  };

  // ── Edit inline ────────────────────────────────────────────────────────────
  const startEdit = (reason) => {
    setEditId(reason.id);
    setEditLabel(reason.label);
  };

  const cancelEdit = () => { setEditId(null); setEditLabel(''); };

  const handleEditSave = async (id) => {
    if (!editLabel.trim()) return;
    setSaving(true);
    const res  = await fetch('/api/super-admin/no-sale-reasons', {
      method: 'PUT',
      headers: h(),
      body: JSON.stringify({ id, label: editLabel.trim() }),
    });
    const body = await safeJson(res);
    setSaving(false);
    if (res.ok) {
      setReasons(prev => prev.map(r => r.id === id ? body : r));
      setEditId(null);
      showToast('Reason updated');
    } else {
      showToast(body.error || 'Failed to update', 'error');
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!delTarget) return;
    setDeleting(true);
    const res  = await fetch('/api/super-admin/no-sale-reasons', {
      method: 'DELETE',
      headers: h(),
      body: JSON.stringify({ id: delTarget.id }),
    });
    const body = await safeJson(res);
    setDeleting(false);
    setDelTarget(null);
    if (res.ok) {
      showToast('Reason deleted');
      load();
    } else {
      showToast(body.error || 'Failed to delete', 'error');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 680 }}>

      {/* Toast */}
      {toast && (
        <div className={`${styles.toast} ${toast.type === 'error' ? styles.toastError : styles.toastSuccess}`}>
          {toast.type === 'success' ? '✓ ' : '✗ '}{toast.msg}
        </div>
      )}

      {/* ── Section header ── */}
      <div className={styles.cfgPageHeader} style={{ marginBottom: 20 }}>
        <div>
          <h2 className={styles.cfgPageTitle}>Custom Configurations</h2>
          <p className={styles.cfgPageSub}>
            Manage configurable lists used throughout the application
          </p>
        </div>
      </div>

      {/* ── No Sale Reasons card ── */}
      <div className={styles.cfgCard}>
        <div className={styles.cfgCardHeader}>
          <div
            className={styles.cfgIconBadge}
            style={{ background: 'linear-gradient(135deg, #f59e0b, #ef4444)' }}
          >
            🚫
          </div>
          <div>
            <div className={styles.cfgCardTitle}>No Sale Reasons</div>
            <div className={styles.cfgCardSub}>
              These options appear when a salesperson records a visit with no sale.
              Toggle to show/hide, or edit the label text.
            </div>
          </div>
        </div>

        {/* Add new reason form */}
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <input
              className={styles.cfgInput}
              value={addLabel}
              onChange={e => { setAddLabel(e.target.value); setAddErr(''); }}
              placeholder="e.g. Shop owner not around"
              disabled={adding}
              maxLength={120}
            />
            {addErr && (
              <div style={{ color: '#dc2626', fontSize: '0.78rem', marginTop: 4 }}>{addErr}</div>
            )}
          </div>
          <button
            type="submit"
            className={styles.btnPrimary}
            disabled={adding || !addLabel.trim()}
            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            {adding ? 'Adding…' : '+ Add Reason'}
          </button>
        </form>

        {/* Reasons list */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: '#64748b' }}>
            <div className={styles.regSpinner} style={{ margin: '0 auto 8px' }} />
            Loading…
          </div>
        ) : reasons.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#94a3b8', padding: '24px 0', fontSize: '0.9rem' }}>
            No reasons yet. Add one above.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {reasons.map(reason => (
              <div
                key={reason.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 14px',
                  background: reason.is_active ? '#f8fafc' : '#f1f5f9',
                  border: `1px solid ${reason.is_active ? '#e2e8f0' : '#cbd5e1'}`,
                  borderRadius: 10,
                  opacity: reason.is_active ? 1 : 0.6,
                  transition: 'opacity 0.15s',
                }}
              >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
                    <button
                      title="Move up"
                      onClick={() => handleMove(reasons.indexOf(reason), -1)}
                      disabled={reasons.indexOf(reason) === 0}
                      style={{
                        background: 'none', border: '1px solid #e2e8f0', cursor: 'pointer',
                        borderRadius: 5, padding: '1px 7px', fontSize: '0.7rem', color: '#64748b',
                        lineHeight: 1.4,
                        opacity: reasons.indexOf(reason) === 0 ? 0.3 : 1,
                      }}
                    >▲</button>
                    <button
                      title="Move down"
                      onClick={() => handleMove(reasons.indexOf(reason), 1)}
                      disabled={reasons.indexOf(reason) === reasons.length - 1}
                      style={{
                        background: 'none', border: '1px solid #e2e8f0', cursor: 'pointer',
                        borderRadius: 5, padding: '1px 7px', fontSize: '0.7rem', color: '#64748b',
                        lineHeight: 1.4,
                        opacity: reasons.indexOf(reason) === reasons.length - 1 ? 0.3 : 1,
                      }}
                    >▼</button>
                  </div>

                {/* Active toggle switch */}
                <button
                  title={reason.is_active ? 'Click to disable' : 'Click to enable'}
                  onClick={() => handleToggle(reason)}
                  style={{
                    position: 'relative',
                    width: 44,
                    height: 24,
                    borderRadius: 12,
                    border: 'none',
                    cursor: 'pointer',
                    background: reason.is_active ? '#16a34a' : '#cbd5e1',
                    transition: 'background 0.2s',
                    flexShrink: 0,
                    padding: 0,
                  }}
                >
                  <span style={{
                    position: 'absolute',
                    top: 3,
                    left: reason.is_active ? 22 : 3,
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: '#fff',
                    transition: 'left 0.2s',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }} />
                </button>

                {/* Label — inline edit */}
                {editId === reason.id ? (
                  <>
                    <input
                      className={styles.cfgInput}
                      value={editLabel}
                      onChange={e => setEditLabel(e.target.value)}
                      autoFocus
                      maxLength={120}
                      style={{ flex: 1, padding: '5px 10px', fontSize: '0.875rem' }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleEditSave(reason.id);
                        if (e.key === 'Escape') cancelEdit();
                      }}
                    />
                    <button
                      className={styles.btnPrimary}
                      onClick={() => handleEditSave(reason.id)}
                      disabled={saving || !editLabel.trim()}
                      style={{ padding: '5px 14px', fontSize: '0.8rem', flexShrink: 0 }}
                    >
                      {saving ? '…' : 'Save'}
                    </button>
                    <button
                      className={styles.btnSecondary}
                      onClick={cancelEdit}
                      style={{ padding: '5px 12px', fontSize: '0.8rem', flexShrink: 0 }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span style={{ flex: 1, fontSize: '0.9rem', color: '#334155' }}>
                      {reason.label}
                    </span>
                    <button
                      title="Edit"
                      onClick={() => startEdit(reason)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#64748b', fontSize: '0.85rem', padding: '2px 6px',
                        borderRadius: 6, flexShrink: 0,
                      }}
                    >
                      ✏️
                    </button>
                    <button
                      title="Delete"
                      onClick={() => setDelTarget(reason)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#dc2626', fontSize: '0.85rem', padding: '2px 6px',
                        borderRadius: 6, flexShrink: 0,
                      }}
                    >
                      🗑️
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 16, fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.5 }}>
          ✅ = visible to salesperson &nbsp;·&nbsp; ⬜ = hidden &nbsp;·&nbsp;
          Changes take effect immediately on the sales page.
        </div>
      </div>

      {/* ── Delete confirm dialog ── */}
      {delTarget && (
        <div className={styles.overlay} onClick={() => setDelTarget(null)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <div className={styles.panelHeader} style={{ borderRadius: '16px 16px 0 0' }}>
              <div>
                <h3 className={styles.panelTitle}>Delete Reason</h3>
                <p className={styles.panelSub}>This action cannot be undone</p>
              </div>
              <button className={styles.closeBtn} onClick={() => setDelTarget(null)}>✕</button>
            </div>
            <div className={styles.panelBody} style={{ padding: 24 }}>
              <p style={{ margin: 0, color: '#475569', fontSize: '0.9rem' }}>
                Are you sure you want to delete <strong>"{delTarget.label}"</strong>?
              </p>
            </div>
            <div className={styles.panelFooter}>
              <button className={styles.btnSecondary} onClick={() => setDelTarget(null)}>
                Cancel
              </button>
              <button
                className={styles.btnDanger}
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
