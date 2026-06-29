import React, { useEffect, useState } from 'react';
import styles from '../../styles/superadmin.module.css';

export default function FeatureManagement({ token }) {
  const [features, setFeatures] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [saving,   setSaving]   = useState({}); // { [key]: true }
  const [saved,    setSaved]    = useState({}); // { [key]: true } flash

  // Split features into admin / manager / sales buckets
  const adminFeatures   = features.filter(f => !f.key.startsWith('sales_') && !f.key.startsWith('mgr_'));
  const managerFeatures = features.filter(f => f.key.startsWith('mgr_'));
  const salesFeatures   = features.filter(f => f.key.startsWith('sales_'));

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      try {
        const res  = await fetch('/api/admin/features', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error || 'Failed to load features.'); return; }
        setFeatures(data);
      } catch {
        setError('Network error. Please try again.');
      } finally {
        setLoading(false);
      }
    }
    if (token) load();
  }, [token]);

  const handleToggle = async (key, currentEnabled) => {
    const newEnabled = !currentEnabled;
    setSaving(p => ({ ...p, [key]: true }));
    try {
      const res  = await fetch('/api/admin/features', {
        method:  'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ key, enabled: newEnabled }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save.'); return; }
      setFeatures(prev => prev.map(f => f.key === key ? { ...f, enabled: newEnabled } : f));
      setSaved(p => ({ ...p, [key]: true }));
      setTimeout(() => setSaved(p => { const n = { ...p }; delete n[key]; return n; }), 1800);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(p => { const n = { ...p }; delete n[key]; return n; });
    }
  };

  return (
    <div>
      <h2 className={styles.tabHeading}>Feature Management</h2>
      <p style={{ color: '#64748b', marginBottom: 24, fontSize: '0.9rem' }}>
        Control which tabs are visible in the Admin, Manager, and Salesperson modules. Required tabs cannot be disabled.
      </p>

      {error && (
        <div className={styles.alertDanger} style={{ marginBottom: 20 }}>{error}</div>
      )}

      {loading ? (
        <div className={styles.loadingState}>Loading features…</div>
      ) : (
        <>
          {/* ══ ADMIN MODULE ══════════════════════════════════════════════════ */}
          <h3 style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.95rem', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ background: '#eef2ff', color: '#4f46e5', borderRadius: 8, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 700 }}>Admin Module</span>
          </h3>

          {/* Admin required tabs */}
          <div className={styles.card} style={{ marginBottom: 16 }}>
            <h3 className={styles.cardTitle} style={{ marginBottom: 16 }}>
              🔒 Required Tabs (always enabled)
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {['Dashboard', 'Uplift Approvals', 'Performance Analysis', 'Targets'].map((name, idx, arr) => (
                <div key={name} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '14px 0',
                  borderBottom: idx < arr.length - 1 ? '1px solid #f1f5f9' : 'none',
                }}>
                  <div>
                    <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>{name}</div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>Cannot be disabled</div>
                  </div>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: '#d1fae5', color: '#065f46',
                    borderRadius: 20, padding: '4px 12px',
                    fontSize: '0.75rem', fontWeight: 700,
                  }}>● Enabled</span>
                </div>
              ))}
            </div>
          </div>

          {/* Admin optional tabs */}
          <div className={styles.card} style={{ marginBottom: 32 }}>
            <h3 className={styles.cardTitle} style={{ marginBottom: 16 }}>⚙️ Optional Tabs</h3>
            {adminFeatures.length === 0 ? (
              <div className={styles.emptyState}>No optional admin features configured.</div>
            ) : (
              <ToggleList features={adminFeatures} saving={saving} saved={saved} onToggle={handleToggle} />
            )}
          </div>

          {/* ══ MANAGER MODULE ════════════════════════════════════════════════ */}
          <h3 style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.95rem', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ background: '#ecfdf5', color: '#065f46', borderRadius: 8, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 700 }}>Manager Module</span>
          </h3>

          {/* Manager required tabs */}
          <div className={styles.card} style={{ marginBottom: 16 }}>
            <h3 className={styles.cardTitle} style={{ marginBottom: 16 }}>
              🔒 Required Tabs (always enabled)
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {['Performance Analysis', 'Map'].map((name, idx, arr) => (
                <div key={name} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '14px 0',
                  borderBottom: idx < arr.length - 1 ? '1px solid #f1f5f9' : 'none',
                }}>
                  <div>
                    <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>{name}</div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>Cannot be disabled</div>
                  </div>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: '#d1fae5', color: '#065f46',
                    borderRadius: 20, padding: '4px 12px',
                    fontSize: '0.75rem', fontWeight: 700,
                  }}>&#9679; Enabled</span>
                </div>
              ))}
            </div>
          </div>

          {/* Manager optional tabs */}
          <div className={styles.card} style={{ marginBottom: 32 }}>
            <h3 className={styles.cardTitle} style={{ marginBottom: 16 }}>&#9881;&#65039; Optional Tabs</h3>
            {managerFeatures.length === 0 ? (
              <div className={styles.emptyState}>No optional manager features configured. Run migration 017_manager_features.sql in Supabase.</div>
            ) : (
              <ToggleList features={managerFeatures} saving={saving} saved={saved} onToggle={handleToggle} />
            )}
          </div>

          {/* ══ SALESPERSON MODULE ════════════════════════════════════════════ */}
          <h3 style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.95rem', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 8, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 700 }}>Salesperson Module</span>
          </h3>

          {/* Sales required tabs */}
          <div className={styles.card} style={{ marginBottom: 16 }}>
            <h3 className={styles.cardTitle} style={{ marginBottom: 16 }}>
              🔒 Required Tabs (always enabled)
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {[
                { name: 'Sales Visit', note: 'Core workflow — cannot be disabled' },
                { name: 'Uplift',      note: 'Core workflow — cannot be disabled' },
                { name: 'Stock',       note: 'Core workflow — cannot be disabled' },
              ].map(({ name, note }, idx, arr) => (
                <div key={name} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '14px 0',
                  borderBottom: idx < arr.length - 1 ? '1px solid #f1f5f9' : 'none',
                }}>
                  <div>
                    <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>{name}</div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>{note}</div>
                  </div>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: '#d1fae5', color: '#065f46',
                    borderRadius: 20, padding: '4px 12px',
                    fontSize: '0.75rem', fontWeight: 700,
                  }}>● Enabled</span>
                </div>
              ))}
            </div>
          </div>

          {/* Sales optional tabs */}
          <div className={styles.card} style={{ marginBottom: 24 }}>
            <h3 className={styles.cardTitle} style={{ marginBottom: 16 }}>⚙️ Optional Tabs</h3>
            {salesFeatures.length === 0 ? (
              <div className={styles.emptyState}>No optional sales features configured. Run migration 016_sales_features.sql in Supabase.</div>
            ) : (
              <ToggleList features={salesFeatures} saving={saving} saved={saved} onToggle={handleToggle} />
            )}
          </div>

          <p style={{ marginTop: 4, color: '#94a3b8', fontSize: '0.78rem' }}>
            Changes take effect immediately — users will see the updated tabs on their next page load.
          </p>
        </>
      )}
    </div>
  );
}

/* Shared toggle-row list used by both Admin and Sales sections */
function ToggleList({ features, saving, saved, onToggle }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {features.map((f, idx) => {
        const isSaving = saving[f.key];
        const wasSaved = saved[f.key];
        return (
          <div key={f.key} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 0',
            borderBottom: idx < features.length - 1 ? '1px solid #f1f5f9' : 'none',
          }}>
            <div>
              <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>{f.name}</div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>
                key: <code style={{ fontSize: '0.72rem' }}>{f.key}</code>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {wasSaved && (
                <span style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 600 }}>&#10003; Saved</span>
              )}
              <button
                onClick={() => onToggle(f.key, f.enabled)}
                disabled={isSaving}
                title={f.enabled ? 'Click to disable' : 'Click to enable'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '7px 16px',
                  borderRadius: 20,
                  border: 'none',
                  cursor: isSaving ? 'not-allowed' : 'pointer',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  transition: 'background 0.15s, color 0.15s',
                  background: f.enabled ? '#d1fae5' : '#fee2e2',
                  color:      f.enabled ? '#065f46' : '#991b1b',
                  opacity:    isSaving ? 0.6 : 1,
                }}
              >
                {isSaving ? '…' : (
                  <>
                    <span style={{
                      display: 'inline-block', width: 10, height: 10,
                      borderRadius: '50%',
                      background: f.enabled ? '#10b981' : '#ef4444',
                    }} />
                    {f.enabled ? 'Enabled' : 'Disabled'}
                  </>
                )}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
