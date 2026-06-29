import { useState, useEffect, useCallback } from 'react';
import styles from '../../styles/superadmin.module.css';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(bytes) {
  if (bytes == null || bytes === 0) return '0 B';
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  if (bytes >= 1024 * 1024)        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  if (bytes >= 1024)               return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

function bytesFromMB(mb) { return Math.round(parseFloat(mb) * 1024 * 1024); }
function mbFromBytes(b)  { return b ? (b / (1024 * 1024)).toFixed(0) : ''; }

function pct(value, limit) { return Math.min(100, Math.round((value / limit) * 100)); }

function barColor(p) {
  if (p >= 90) return '#ef4444';
  if (p >= 70) return '#f59e0b';
  return '#22c55e';
}

function ProgressBar({ value, limit }) {
  const p = pct(value || 0, limit || 1);
  const color = barColor(p);
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem', color: '#64748b', marginBottom: 3 }}>
        <span>{fmtBytes(value)} used</span>
        <span>{p}% of {fmtBytes(limit)}</span>
      </div>
      <div style={{ background: '#e2e8f0', borderRadius: 6, height: 9, overflow: 'hidden' }}>
        <div style={{ width: `${p}%`, background: color, height: '100%', borderRadius: 6, transition: 'width 0.4s' }} />
      </div>
    </div>
  );
}

// ── Inline edit helper ────────────────────────────────────────────────────────

function EditableValue({ label, unit, value, onSave, hint }) {
  const [mode, setMode]     = useState(false);
  const [draft, setDraft]   = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await onSave(draft);
    setSaving(false);
    setMode(false);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {mode ? (
        <>
          <input
            type="number"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            style={{ width: 90, padding: '5px 8px', borderRadius: 6, border: '1.5px solid #7c3aed', fontSize: '0.9rem', outline: 'none' }}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setMode(false); }}
          />
          <span style={{ fontSize: '0.82rem', color: '#64748b' }}>{unit}</span>
          <button onClick={save} disabled={saving} style={{ padding: '4px 12px', borderRadius: 6, background: '#7c3aed', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => setMode(false)} style={{ padding: '4px 10px', borderRadius: 6, background: '#f1f5f9', color: '#64748b', border: 'none', cursor: 'pointer', fontSize: '0.82rem' }}>Cancel</button>
        </>
      ) : (
        <>
          <span style={{ fontWeight: 700, fontSize: '1.2rem', color: '#1e293b' }}>{value} {unit}</span>
          {hint && <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{hint}</span>}
          <button onClick={() => { setDraft(value); setMode(true); }} style={{ marginLeft: 4, padding: '2px 8px', borderRadius: 6, background: 'none', border: '1px solid #cbd5e1', color: '#475569', cursor: 'pointer', fontSize: '0.76rem' }}>✏️ Edit</button>
        </>
      )}
    </div>
  );
}

// ── Selector helper ───────────────────────────────────────────────────────────

function UnitSelect({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{ padding: '6px 10px', borderRadius: 6, border: '1.5px solid #e2e8f0', fontSize: '0.875rem', background: '#fff', cursor: 'pointer', color: '#1e293b' }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────

function SectionCard({ title, icon, color, children, badge }) {
  return (
    <div style={{
      background: '#fff',
      borderRadius: 14,
      boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
      overflow: 'hidden',
      marginBottom: 22,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px',
        borderBottom: '1px solid #f1f5f9',
        background: `linear-gradient(90deg, ${color}08, transparent)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ fontSize: '1.3rem' }}>{icon}</span>
          <span style={{ fontWeight: 700, fontSize: '1rem', color: '#1e293b' }}>{title}</span>
        </div>
        {badge}
      </div>
      <div style={{ padding: '18px 20px' }}>{children}</div>
    </div>
  );
}

// ── Row helper ────────────────────────────────────────────────────────────────

function SettingRow({ label, children, muted }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#334155' }}>{label}</div>
        {muted && <div style={{ fontSize: '0.76rem', color: '#94a3b8', marginTop: 2 }}>{muted}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 180 }}>
        {children}
      </div>
    </div>
  );
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 46, height: 26, borderRadius: 13,
        background: checked ? '#7c3aed' : '#cbd5e1',
        border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        position: 'relative', transition: 'background 0.2s', padding: 0, flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: checked ? 23 : 3,
        width: 20, height: 20, borderRadius: '50%',
        background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
        transition: 'left 0.2s',
      }} />
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StorageManager({ token }) {
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState({ selfie: false, receipt: false });
  const [cleanRunning, setCleanRunning] = useState(false);
  const [cleanResult,  setCleanResult]  = useState(null);
  const [toast,        setToast]        = useState(null); // { msg, type: 'ok'|'err' }
  const [usage,        setUsage]        = useState(null);
  const [migrationPending, setMigrationPending] = useState(false);

  // Settings state
  const [selfie, setSelfie] = useState({
    max_size_bytes:       2097152,
    retention_value:      30,
    retention_unit:       'days',
    compression_enabled:  true,
    compression_quality:  70,
  });
  const [receipt, setReceipt] = useState({
    max_size_bytes:   5242880,
    retention_value:  90,
    retention_unit:   'days',
  });

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, usageRes] = await Promise.all([
        fetch('/api/super-admin/storage-config',  { headers }),
        fetch('/api/super-admin/storage-usage',   { headers }),
      ]);
      if (cfgRes.ok) {
        const d = await cfgRes.json();
        if (d._migrationPending) setMigrationPending(true);
        if (d.selfie)  setSelfie(d.selfie);
        if (d.receipt) setReceipt(d.receipt);
      }
      if (usageRes.ok) {
        const u = await usageRes.json();
        if (u._migrationPending) setMigrationPending(true);
        setUsage(u);
      }
    } catch (e) {
      showToast('Failed to load storage settings: ' + e.message, 'err');
    } finally {
      setLoading(false);
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Save helpers ──────────────────────────────────────────────────────────

  const saveFileType = async (fileType, patch) => {
    setSaving(s => ({ ...s, [fileType]: true }));
    try {
      const res = await fetch('/api/super-admin/storage-config', {
        method: 'POST',
        headers,
        body: JSON.stringify({ fileType, ...patch }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Save failed');
      showToast(`${fileType === 'selfie' ? 'Selfie' : 'Receipt'} settings saved ✓`);
      // Refresh
      const cfgRes = await fetch('/api/super-admin/storage-config', { headers });
      if (cfgRes.ok) {
        const d = await cfgRes.json();
        if (d.selfie)  setSelfie(d.selfie);
        if (d.receipt) setReceipt(d.receipt);
      }
    } catch (e) {
      showToast(e.message, 'err');
    } finally {
      setSaving(s => ({ ...s, [fileType]: false }));
    }
  };

  // ── Cleanup ───────────────────────────────────────────────────────────────

  const runCleanup = async (fileType) => {
    if (!window.confirm(`Delete all ${fileType} files older than the retention period? This cannot be undone.`)) return;
    setCleanRunning(true);
    setCleanResult(null);
    try {
      const res = await fetch('/api/super-admin/storage-cleanup', {
        method: 'POST',
        headers,
        body: JSON.stringify({ fileType, triggeredBy: 'manual' }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Cleanup failed');
      setCleanResult(body.results);
      showToast('Cleanup completed ✓');
      // Refresh usage
      const usageRes = await fetch('/api/super-admin/storage-usage', { headers });
      if (usageRes.ok) setUsage(await usageRes.json());
    } catch (e) {
      showToast(e.message, 'err');
    } finally {
      setCleanRunning(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
        <div style={{ fontSize: '2rem', marginBottom: 12 }}>⏳</div>
        Loading storage settings…
      </div>
    );
  }

  const RETENTION_UNITS = [
    { value: 'days',   label: 'Days' },
    { value: 'weeks',  label: 'Weeks' },
    { value: 'months', label: 'Months' },
  ];

  const selfieMaxMB   = mbFromBytes(selfie.max_size_bytes);
  const receiptMaxMB  = mbFromBytes(receipt.max_size_bytes);

  // Retention display helpers
  const retentionLabel = (val, unit) => `${val} ${unit}`;

  return (
    <div style={{ maxWidth: 860 }}>
      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 28, right: 28, zIndex: 9999,
          background: toast.type === 'ok' ? '#16a34a' : '#dc2626',
          color: '#fff', padding: '12px 22px', borderRadius: 10,
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)', fontWeight: 600, fontSize: '0.9rem',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {toast.type === 'ok' ? '✓' : '✕'} {toast.msg}
        </div>
      )}

      <h2 className={styles.tabHeading}>Storage Management</h2>
      <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: 24, marginTop: -14 }}>
        Configure file size limits, retention policies, and auto-compression for selfies and receipts.
      </p>

      {/* ── Migration pending banner ── */}
      {migrationPending && (
        <div style={{
          background: '#fff7ed', border: '1.5px solid #fb923c', borderRadius: 10,
          padding: '14px 18px', marginBottom: 22, display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <span style={{ fontSize: '1.3rem', flexShrink: 0 }}>⚠️</span>
          <div>
            <div style={{ fontWeight: 700, color: '#9a3412', marginBottom: 4 }}>Database migration required</div>
            <div style={{ fontSize: '0.85rem', color: '#7c2d12' }}>
              The <code style={{ background: '#fed7aa', padding: '1px 5px', borderRadius: 4 }}>storage_settings</code> table
              doesn&apos;t exist yet. Settings are showing defaults and saves will fail until the migration is applied.
            </div>
            <div style={{ marginTop: 8, fontSize: '0.82rem', color: '#92400e' }}>
              Run <strong>supabase/migrations/009_storage_settings.sql</strong> in your{' '}
              <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer" style={{ color: '#ea580c', fontWeight: 600 }}>
                Supabase SQL editor
              </a>.
            </div>
          </div>
        </div>
      )}

      {/* ── USAGE OVERVIEW ── */}
      <SectionCard title="Storage Usage" icon="📊" color="#7c3aed">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, marginBottom: 18 }}>
          {/* Selfies */}
          <div style={{ background: '#faf5ff', borderRadius: 10, padding: '14px 16px', border: '1px solid #e9d5ff' }}>
            <div style={{ fontSize: '0.75rem', color: '#7c3aed', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>📸 Selfies</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#1e293b' }}>{fmtBytes(usage?.selfieBytes)}</div>
            <div style={{ fontSize: '0.76rem', color: '#7c3aed', marginTop: 3 }}>
              {usage?.selfieCount ?? 0} tracked · {usage?.totalSelfieFiles ?? 0} total files
            </div>
          </div>
          {/* Receipts */}
          <div style={{ background: '#f0fdf4', borderRadius: 10, padding: '14px 16px', border: '1px solid #bbf7d0' }}>
            <div style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>🧾 Receipts</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#1e293b' }}>{fmtBytes(usage?.receiptBytes)}</div>
            <div style={{ fontSize: '0.76rem', color: '#16a34a', marginTop: 3 }}>
              {usage?.receiptCount ?? 0} tracked · {usage?.totalReceiptFiles ?? 0} total files
            </div>
          </div>
          {/* Total */}
          <div style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 16px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>💾 Total Used</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#1e293b' }}>{fmtBytes(usage?.totalBytes)}</div>
            <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: 3 }}>of {fmtBytes(usage?.limitBytes)} limit</div>
          </div>
        </div>
        <ProgressBar value={usage?.totalBytes || 0} limit={usage?.limitBytes || 1} />
        <div style={{ marginTop: 8, fontSize: '0.75rem', color: '#94a3b8' }}>
          ⓘ File size tracking applies to new uploads only. Legacy files appear in &quot;total files&quot; count but not in bytes.
        </div>
      </SectionCard>

      {/* ── SELFIE SETTINGS ── */}
      <SectionCard
        title="Selfie Settings"
        icon="📸"
        color="#7c3aed"
        badge={
          <span style={{
            background: selfie.compression_enabled ? '#f3e8ff' : '#f1f5f9',
            color:      selfie.compression_enabled ? '#7c3aed' : '#64748b',
            border:     `1px solid ${selfie.compression_enabled ? '#d8b4fe' : '#cbd5e1'}`,
            borderRadius: 999, padding: '2px 10px', fontSize: '0.76rem', fontWeight: 700,
          }}>
            {selfie.compression_enabled ? '🗜 Compression ON' : '🗜 Compression OFF'}
          </span>
        }
      >
        {/* Max size */}
        <SettingRow
          label="Max Upload Size"
          muted="Uploads exceeding this limit are rejected before transmission"
        >
          <EditableValue
            value={selfieMaxMB}
            unit="MB"
            onSave={async (val) => {
              const bytes = bytesFromMB(val);
              if (bytes < 102400 || bytes > 52428800) { showToast('Size must be between 0.1 MB and 50 MB', 'err'); return; }
              await saveFileType('selfie', { maxSizeBytes: bytes });
            }}
          />
        </SettingRow>

        <div style={{ borderTop: '1px solid #f1f5f9', margin: '0 -20px 16px', padding: '0 20px 0' }} />

        {/* Retention */}
        <SettingRow
          label="Retention Period"
          muted="Files older than this are deleted by the cleanup job"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="number"
              min={1} max={3650}
              value={selfie.retention_value}
              onChange={e => setSelfie(s => ({ ...s, retention_value: parseInt(e.target.value) || 1 }))}
              style={{ width: 70, padding: '6px 8px', borderRadius: 6, border: '1.5px solid #e2e8f0', fontSize: '0.9rem', textAlign: 'center' }}
            />
            <UnitSelect
              value={selfie.retention_unit}
              onChange={v => setSelfie(s => ({ ...s, retention_unit: v }))}
              options={RETENTION_UNITS}
            />
            <button
              onClick={() => saveFileType('selfie', { retentionValue: selfie.retention_value, retentionUnit: selfie.retention_unit })}
              disabled={saving.selfie}
              style={{ padding: '6px 14px', borderRadius: 6, background: '#7c3aed', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.83rem' }}
            >
              {saving.selfie ? 'Saving…' : 'Save'}
            </button>
          </div>
        </SettingRow>

        <div style={{ borderTop: '1px solid #f1f5f9', margin: '0 -20px 16px', padding: '0 20px 0' }} />

        {/* Auto compression */}
        <SettingRow
          label="Auto Compression"
          muted="Compress selfies client-side before upload to reduce storage usage"
        >
          <Toggle
            checked={!!selfie.compression_enabled}
            onChange={async (v) => {
              const next = { ...selfie, compression_enabled: v };
              setSelfie(next);
              await saveFileType('selfie', { compressionEnabled: v });
            }}
          />
          <span style={{ fontSize: '0.85rem', color: selfie.compression_enabled ? '#7c3aed' : '#94a3b8', fontWeight: 600 }}>
            {selfie.compression_enabled ? 'Enabled' : 'Disabled'}
          </span>
        </SettingRow>

        {selfie.compression_enabled && (
          <div style={{ background: '#faf5ff', borderRadius: 10, border: '1px solid #e9d5ff', padding: '14px 18px', marginTop: 4 }}>
            <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#6d28d9', marginBottom: 12 }}>Compression Quality</div>

            {/* Quality slider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <input
                type="range"
                min={10} max={100} step={5}
                value={selfie.compression_quality}
                onChange={e => setSelfie(s => ({ ...s, compression_quality: parseInt(e.target.value) }))}
                style={{ flex: 1, minWidth: 140, accentColor: '#7c3aed' }}
              />
              <span style={{
                minWidth: 48, textAlign: 'center',
                fontWeight: 800, fontSize: '1.3rem', color: '#7c3aed',
                background: '#fff', borderRadius: 8, padding: '4px 8px',
                border: '1.5px solid #d8b4fe',
              }}>
                {selfie.compression_quality}%
              </span>
              <button
                onClick={() => saveFileType('selfie', { compressionQuality: selfie.compression_quality })}
                disabled={saving.selfie}
                style={{ padding: '6px 14px', borderRadius: 6, background: '#7c3aed', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.83rem' }}
              >
                {saving.selfie ? 'Saving…' : 'Save'}
              </button>
            </div>

            {/* Quality guide */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {[
                { range: '10–40%', label: 'Aggressive compression', color: '#ef4444' },
                { range: '50–70%', label: 'Recommended balance',    color: '#f59e0b' },
                { range: '80–100%',label: 'High quality',           color: '#22c55e' },
              ].map(g => (
                <div key={g.range} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.74rem', color: '#64748b' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
                  <strong style={{ color: g.color }}>{g.range}</strong> — {g.label}
                </div>
              ))}
            </div>
          </div>
        )}

        {!selfie.compression_enabled && (
          <div style={{ background: '#fff7ed', borderRadius: 8, border: '1px solid #fed7aa', padding: '10px 14px', marginTop: 4, fontSize: '0.82rem', color: '#92400e' }}>
            ⚠️ Compression is disabled. Original selfies will be stored as-is (still subject to the max size limit above).
          </div>
        )}
      </SectionCard>

      {/* ── RECEIPT SETTINGS ── */}
      <SectionCard
        title="Receipt Settings"
        icon="🧾"
        color="#16a34a"
        badge={
          <span style={{
            background: '#f0fdf4', color: '#16a34a',
            border: '1px solid #bbf7d0',
            borderRadius: 999, padding: '2px 10px', fontSize: '0.76rem', fontWeight: 700,
          }}>
            🔒 No Compression
          </span>
        }
      >
        {/* Max size */}
        <SettingRow
          label="Max Upload Size"
          muted="Uploads exceeding this limit are rejected. Receipts support JPEG, PNG, WebP, PDF."
        >
          <EditableValue
            value={receiptMaxMB}
            unit="MB"
            onSave={async (val) => {
              const bytes = bytesFromMB(val);
              if (bytes < 102400 || bytes > 52428800) { showToast('Size must be between 0.1 MB and 50 MB', 'err'); return; }
              await saveFileType('receipt', { maxSizeBytes: bytes });
            }}
          />
        </SettingRow>

        <div style={{ borderTop: '1px solid #f1f5f9', margin: '0 -20px 16px', padding: '0 20px 0' }} />

        {/* Retention */}
        <SettingRow
          label="Retention Period"
          muted="Files older than this are deleted by the cleanup job"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="number"
              min={1} max={3650}
              value={receipt.retention_value}
              onChange={e => setReceipt(s => ({ ...s, retention_value: parseInt(e.target.value) || 1 }))}
              style={{ width: 70, padding: '6px 8px', borderRadius: 6, border: '1.5px solid #e2e8f0', fontSize: '0.9rem', textAlign: 'center' }}
            />
            <UnitSelect
              value={receipt.retention_unit}
              onChange={v => setReceipt(s => ({ ...s, retention_unit: v }))}
              options={RETENTION_UNITS}
            />
            <button
              onClick={() => saveFileType('receipt', { retentionValue: receipt.retention_value, retentionUnit: receipt.retention_unit })}
              disabled={saving.receipt}
              style={{ padding: '6px 14px', borderRadius: 6, background: '#16a34a', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.83rem' }}
            >
              {saving.receipt ? 'Saving…' : 'Save'}
            </button>
          </div>
        </SettingRow>

        <div style={{ background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0', padding: '10px 14px', marginTop: 4, fontSize: '0.82rem', color: '#166534' }}>
          ✅ Receipts are <strong>never compressed or modified</strong>. Only the size limit is enforced. The original file is always stored as-is.
        </div>
      </SectionCard>

      {/* ── CLEANUP ── */}
      <SectionCard title="Cleanup & Retention Enforcement" icon="🔄" color="#0ea5e9">
        <p style={{ fontSize: '0.88rem', color: '#475569', marginBottom: 18, marginTop: 0 }}>
          The cleanup job deletes files from Supabase Storage that have exceeded their retention period and nulls
          the path in the database (visit and uplift records are preserved). Each deletion is logged.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, marginBottom: 20 }}>
          {/* Selfie schedule indicator */}
          <div style={{ background: '#faf5ff', borderRadius: 10, padding: '14px 16px', border: '1px solid #e9d5ff' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>📸 Selfie Retention</div>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: '#1e293b' }}>{retentionLabel(selfie.retention_value, selfie.retention_unit)}</div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>Files older than this will be removed</div>
          </div>
          {/* Receipt schedule indicator */}
          <div style={{ background: '#f0fdf4', borderRadius: 10, padding: '14px 16px', border: '1px solid #bbf7d0' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>🧾 Receipt Retention</div>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: '#1e293b' }}>{retentionLabel(receipt.retention_value, receipt.retention_unit)}</div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>Files older than this will be removed</div>
          </div>
        </div>

        {/* Manual trigger buttons */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={() => runCleanup('all')}
            disabled={cleanRunning}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 8, background: '#0ea5e9', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem', opacity: cleanRunning ? 0.6 : 1 }}
          >
            {cleanRunning ? '⏳ Running…' : '🔄 Clean Expired Files Now'}
          </button>
          <button
            onClick={() => runCleanup('selfie')}
            disabled={cleanRunning}
            style={{ padding: '8px 16px', borderRadius: 8, background: '#f5f3ff', color: '#7c3aed', border: '1.5px solid #e9d5ff', cursor: 'pointer', fontWeight: 600, fontSize: '0.83rem', opacity: cleanRunning ? 0.6 : 1 }}
          >
            📸 Selfies Only
          </button>
          <button
            onClick={() => runCleanup('receipt')}
            disabled={cleanRunning}
            style={{ padding: '8px 16px', borderRadius: 8, background: '#f0fdf4', color: '#16a34a', border: '1.5px solid #bbf7d0', cursor: 'pointer', fontWeight: 600, fontSize: '0.83rem', opacity: cleanRunning ? 0.6 : 1 }}
          >
            🧾 Receipts Only
          </button>
        </div>

        {/* Cleanup result */}
        {cleanResult && (
          <div style={{ marginTop: 18, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', padding: '14px 18px' }}>
            <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1e293b', marginBottom: 10 }}>Cleanup Results</div>
            {Object.entries(cleanResult).map(([ft, r]) => (
              <div key={ft} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: '1rem' }}>{ft === 'selfie' ? '📸' : '🧾'}</span>
                <span style={{ fontSize: '0.875rem', color: '#334155' }}>
                  <strong style={{ textTransform: 'capitalize' }}>{ft}s</strong>: {r.deleted} file(s) deleted
                  {r.errors > 0 && <span style={{ color: '#dc2626' }}> · {r.errors} error(s)</span>}
                </span>
              </div>
            ))}
          </div>
        )}


      </SectionCard>

      {/* ── HOW IT WORKS ── */}
      <SectionCard title="How It Works" icon="ℹ️" color="#64748b">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
          {[
            {
              icon: '🗜',
              title: 'Selfie Compression',
              bg: '#faf5ff', border: '#e9d5ff', color: '#7c3aed',
              body: 'Compression is applied client-side using the HTML5 Canvas API when the selfie is captured. Quality is configurable. This keeps uploads fast and reduces storage by up to 80%.',
            },
            {
              icon: '🔒',
              title: 'Receipt Integrity',
              bg: '#f0fdf4', border: '#bbf7d0', color: '#16a34a',
              body: 'Receipts are stored exactly as uploaded — no compression, no modification. Only the configured max size is enforced to prevent excessively large uploads.',
            },
            {
              icon: '📏',
              title: 'Size Validation',
              bg: '#f0f9ff', border: '#bae6fd', color: '#0369a1',
              body: 'File size is validated server-side after decoding (on the API). Oversized files are rejected with a user-friendly error before any storage write occurs.',
            },
            {
              icon: '🗑️',
              title: 'Retention Cleanup',
              bg: '#fff7ed', border: '#fed7aa', color: '#9a3412',
              body: 'The cleanup job queries visits/uplifts for files older than the retention period, removes them from Supabase Storage, and nulls the path. Visit/uplift records remain intact.',
            },
          ].map(card => (
            <div key={card.title} style={{ background: card.bg, borderRadius: 10, border: `1px solid ${card.border}`, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: '1.2rem' }}>{card.icon}</span>
                <span style={{ fontWeight: 700, fontSize: '0.88rem', color: card.color }}>{card.title}</span>
              </div>
              <p style={{ fontSize: '0.8rem', color: '#475569', margin: 0, lineHeight: 1.5 }}>{card.body}</p>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
