import { useState, useEffect, useRef, useCallback } from 'react';
import styles from '../../styles/superadmin.module.css';

// ── Throttle level metadata ───────────────────────────────────────────────────
const LEVEL_META = {
  NORMAL:   { label: 'NORMAL',   color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', icon: '🟢', desc: 'No throttling active. All endpoints running at full speed.' },
  WARNING:  { label: 'WARNING',  color: '#d97706', bg: '#fffbeb', border: '#fde68a', icon: '🟡', desc: 'Light throttling: low-priority endpoints delayed 500 ms.' },
  HIGH:     { label: 'HIGH',     color: '#dc2626', bg: '#fff7ed', border: '#fed7aa', icon: '🟠', desc: 'Strong throttling: low-priority endpoints delayed 1.5 s. Dashboard auto-refresh limited.' },
  CRITICAL: { label: 'CRITICAL', color: '#7f1d1d', bg: '#fef2f2', border: '#fecaca', icon: '🔴', desc: 'Maximum throttling: low-priority endpoints delayed 3 s. Maps and reports rate-limited.' },
};

const DB_SIZE_LIMIT_FALLBACK      = 500  * 1024 * 1024; // 500 MB default
const FILE_STORAGE_LIMIT_FALLBACK = 1024 * 1024 * 1024; //   1 GB default
const EDGE_LIMIT_FALLBACK         = 1_000_000;           //   1 M  default
const AUTO_REFRESH_MS    = 60_000;

function fmtBytes(bytes) {
  if (bytes == null) return '--';
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  if (bytes >= 1024 * 1024)        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  if (bytes >= 1024)               return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

function pct(value, limit) {
  return Math.min(100, Math.round((value / limit) * 100));
}

// Storage: green <70%, yellow 70-90%, red >=90%
function storageBarColor(p) {
  if (p >= 90) return '#ef4444';
  if (p >= 70) return '#f59e0b';
  return '#22c55e';
}

// Edge: green <50%, yellow 50-80%, red >=80%
function edgeBarColor(p) {
  if (p >= 80) return '#ef4444';
  if (p >= 50) return '#f59e0b';
  return '#22c55e';
}

function ProgressBar({ value, limit, colorFn = storageBarColor }) {
  const p = pct(value, limit);
  const color = colorFn(p);
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#64748b', marginBottom: 4 }}>
        <span>{fmtBytes(value)} used</span>
        <span>{p}% of {fmtBytes(limit)}</span>
      </div>
      <div style={{ background: '#e2e8f0', borderRadius: 6, height: 10, overflow: 'hidden' }}>
        <div style={{ width: `${p}%`, background: color, height: '100%', borderRadius: 6, transition: 'width 0.4s' }} />
      </div>
    </div>
  );
}

export default function ApiUsageMonitor({ token }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [lastAt,  setLastAt]  = useState(null);
  const timerRef = useRef(null);

  // Throttle status state
  const [throttleStatus,  setThrottleStatus]  = useState(null);
  const [throttleLoading, setThrottleLoading] = useState(true);
  const [toggleSaving,    setToggleSaving]    = useState(false);

  // Storage limits config (loaded once from throttle-config)
  const [limitsConfig, setLimitsConfig] = useState(null);

  // Inline edit state — edge limit
  const [limitEditMode, setLimitEditMode] = useState(false);
  const [limitDraft,    setLimitDraft]    = useState('');
  const [limitSaving,   setLimitSaving]   = useState(false);

  // Inline edit state — DB limit (input in MB)
  const [dbEditMode,  setDbEditMode]  = useState(false);
  const [dbDraft,     setDbDraft]     = useState('');
  const [dbSaving,    setDbSaving]    = useState(false);

  // Inline edit state — File Storage limit (input in MB)
  const [fileEditMode, setFileEditMode] = useState(false);
  const [fileDraft,    setFileDraft]    = useState('');
  const [fileSaving,   setFileSaving]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/super-admin/usage-metrics', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastAt(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadThrottleStatus = useCallback(async () => {
    setThrottleLoading(true);
    try {
      const res = await fetch('/api/super-admin/throttle-status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setThrottleStatus(await res.json());
    } catch { /* silent — non-critical */ }
    finally { setThrottleLoading(false); }
  }, [token]);

  const loadLimitsConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/super-admin/throttle-config', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const d = await res.json();
      setLimitsConfig(d);
    } catch { /* silent */ }
  }, [token]);

  const handleThrottleToggle = async () => {
    if (!throttleStatus || toggleSaving) return;
    setToggleSaving(true);
    try {
      const res = await fetch('/api/super-admin/throttle-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: !throttleStatus.throttlingEnabled }),
      });
      if (res.ok) {
        const d = await res.json();
        setThrottleStatus(prev => ({ ...prev, throttlingEnabled: d.enabled }));
      }
    } catch { /* silent */ }
    finally { setToggleSaving(false); }
  };

  const handleLimitSave = async () => {
    const limitNum = parseInt(limitDraft.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(limitNum) || limitNum < 1000) return;
    setLimitSaving(true);
    try {
      const res = await fetch('/api/super-admin/throttle-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ edgeLimit: limitNum }),
      });
      if (res.ok) {
        const d = await res.json();
        setThrottleStatus(prev => ({ ...prev, edgeLimit: d.edgeLimit }));
        setLimitsConfig(d);
        setLimitEditMode(false);
      }
    } catch { /* silent */ }
    finally { setLimitSaving(false); }
  };

  const handleDbLimitSave = async () => {
    const mb = parseInt(dbDraft.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(mb) || mb < 1) return;
    setDbSaving(true);
    try {
      const res = await fetch('/api/super-admin/throttle-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dbSizeLimit: mb * 1024 * 1024 }),
      });
      if (res.ok) {
        const d = await res.json();
        setLimitsConfig(d);
        setDbEditMode(false);
      }
    } catch { /* silent */ }
    finally { setDbSaving(false); }
  };

  const handleFileLimitSave = async () => {
    const mb = parseInt(fileDraft.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(mb) || mb < 1) return;
    setFileSaving(true);
    try {
      const res = await fetch('/api/super-admin/throttle-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fileStorageLimit: mb * 1024 * 1024 }),
      });
      if (res.ok) {
        const d = await res.json();
        setLimitsConfig(d);
        setFileEditMode(false);
      }
    } catch { /* silent */ }
    finally { setFileSaving(false); }
  };

  useEffect(() => {
    load();
    loadThrottleStatus();
    loadLimitsConfig();
    timerRef.current = setInterval(() => { load(); loadThrottleStatus(); }, AUTO_REFRESH_MS);
    return () => clearInterval(timerRef.current);
  }, [load, loadThrottleStatus, loadLimitsConfig]);

  const edgeLimit       = throttleStatus?.edgeLimit      ?? EDGE_LIMIT_FALLBACK;
  const dbSizeLimit     = limitsConfig?.dbSizeLimit      ?? DB_SIZE_LIMIT_FALLBACK;
  const fileStorageLimit = limitsConfig?.fileStorageLimit ?? FILE_STORAGE_LIMIT_FALLBACK;

  const dbPct            = data ? pct(data.dbSizeBytes              ?? 0, dbSizeLimit) : 0;
  const filePct          = data ? pct(data.fileStorageBytes         ?? 0, fileStorageLimit) : 0;
  const edgePct          = data ? pct(data.totals?.thisMonth        ?? 0, edgeLimit) : 0;
  const estimatedEdgePct = data ? pct(data.totals?.estimatedMonthly ?? 0, edgeLimit) : 0;

  const monthLabel = data?.totals?.monthStart
    ? 'Since ' + new Date(data.totals.monthStart + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : 'This month';

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 className={styles.tabHeading} style={{ margin: 0 }}>API Usage Monitor</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastAt && (
            <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
              Updated {lastAt.toLocaleTimeString()}
            </span>
          )}
          <button
            className={styles.btnSecondary}
            onClick={load}
            disabled={loading}
            style={{ padding: '8px 18px' }}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '14px 18px', color: '#dc2626', marginBottom: 20 }}>
          Failed to load metrics: {error}
        </div>
      )}

      {/* Edge Requests hero card */}
      <div className={styles.card} style={{ borderLeft: '4px solid #0ea5e9', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div className={styles.cardTitle} style={{ margin: 0 }}>Edge Requests &mdash; Vercel Monthly Limit</div>
          <span style={{ fontSize: '0.7rem', fontWeight: 600, background: '#f0f9ff', color: '#0369a1', borderRadius: 6, padding: '2px 10px' }}>Limit: {edgeLimit.toLocaleString()} / month</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: '2.4rem', fontWeight: 800, color: edgeBarColor(edgePct) }}>
            {loading ? '--' : (data?.totals?.thisMonth ?? 0).toLocaleString()}
          </span>
          <span style={{ color: '#94a3b8', fontSize: '1rem' }}>/ {edgeLimit.toLocaleString()}</span>
          <span style={{ marginLeft: 'auto', fontSize: '1.2rem', fontWeight: 700, color: edgeBarColor(edgePct) }}>
            {edgePct}%
          </span>
        </div>
        {!loading && data && (
          <>
            <div style={{ background: '#e2e8f0', borderRadius: 6, height: 14, overflow: 'hidden', margin: '10px 0 8px' }}>
              <div style={{ width: `${edgePct}%`, background: edgeBarColor(edgePct), height: '100%', borderRadius: 6, transition: 'width 0.4s' }} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: '0.8rem', color: '#64748b' }}>
              <span>{monthLabel} &middot; {data.totals?.daysElapsed ?? 0} days elapsed</span>
              {data.totals?.estimatedMonthly != null && (
                <span>Estimated month-end: <strong style={{ color: edgeBarColor(estimatedEdgePct) }}>{data.totals.estimatedMonthly.toLocaleString()}</strong> ({estimatedEdgePct}%)</span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Stat cards */}
      <div className={styles.statsGrid}>
        {[
          { label: 'Edge Requests - Today',    key: 'last24h' },
          { label: 'Edge Requests - Last 7 d', key: 'last7d'  },
          { label: 'Edge Requests - Last 30 d',key: 'last30d' },
        ].map(({ label, key }) => (
          <div className={styles.statCard} key={key}>
            <div className={styles.statLabel}>{label}</div>
            <div className={styles.statValue} style={{ fontSize: '1.9rem' }}>
              {loading ? '--' : (data?.totals?.[key] ?? 0).toLocaleString()}
            </div>
          </div>
        ))}

        {/* DB Size card */}
        <div className={styles.statCard} style={{ borderLeft: '4px solid #3b82f6' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
            <div className={styles.statLabel} style={{ margin: 0 }}>Table Data (DB)</div>
            {dbEditMode ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number"
                  value={dbDraft}
                  onChange={e => setDbDraft(e.target.value)}
                  style={{ width: 72, fontSize: '0.78rem', padding: '2px 5px', border: '1px solid #94a3b8', borderRadius: 5 }}
                  autoFocus
                />
                <span style={{ fontSize: '0.72rem', color: '#64748b' }}>MB</span>
                <button onClick={handleDbLimitSave} disabled={dbSaving} style={{ fontSize: '0.7rem', padding: '2px 7px', borderRadius: 5, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer' }}>{dbSaving ? '…' : 'Save'}</button>
                <button onClick={() => setDbEditMode(false)} style={{ fontSize: '0.7rem', padding: '2px 7px', borderRadius: 5, border: 'none', background: '#e2e8f0', color: '#475569', cursor: 'pointer' }}>✕</button>
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 600, background: '#eff6ff', color: '#1d4ed8', borderRadius: 6, padding: '2px 8px' }}>Limit: {fmtBytes(dbSizeLimit)}</span>
                <button onClick={() => { setDbDraft(String(Math.round(dbSizeLimit / (1024 * 1024)))); setDbEditMode(true); }} title="Edit limit" style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: 5, border: '1px solid #cbd5e1', background: '#f8fafc', color: '#475569', cursor: 'pointer' }}>✏️</button>
              </span>
            )}
          </div>
          <div className={styles.statValue} style={{ fontSize: '1.6rem', color: storageBarColor(dbPct) }}>
            {loading ? '--' : fmtBytes(data?.dbSizeBytes)}
          </div>
          {!loading && data && (
            <ProgressBar value={data.dbSizeBytes ?? 0} limit={dbSizeLimit} colorFn={storageBarColor} />
          )}
        </div>

        {/* File Storage card */}
        <div className={styles.statCard} style={{ borderLeft: '4px solid #8b5cf6' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
            <div className={styles.statLabel} style={{ margin: 0 }}>File Storage</div>
            {fileEditMode ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number"
                  value={fileDraft}
                  onChange={e => setFileDraft(e.target.value)}
                  style={{ width: 72, fontSize: '0.78rem', padding: '2px 5px', border: '1px solid #94a3b8', borderRadius: 5 }}
                  autoFocus
                />
                <span style={{ fontSize: '0.72rem', color: '#64748b' }}>MB</span>
                <button onClick={handleFileLimitSave} disabled={fileSaving} style={{ fontSize: '0.7rem', padding: '2px 7px', borderRadius: 5, border: 'none', background: '#8b5cf6', color: '#fff', cursor: 'pointer' }}>{fileSaving ? '…' : 'Save'}</button>
                <button onClick={() => setFileEditMode(false)} style={{ fontSize: '0.7rem', padding: '2px 7px', borderRadius: 5, border: 'none', background: '#e2e8f0', color: '#475569', cursor: 'pointer' }}>✕</button>
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 600, background: '#f5f3ff', color: '#6d28d9', borderRadius: 6, padding: '2px 8px' }}>Limit: {fmtBytes(fileStorageLimit)}</span>
                <button onClick={() => { setFileDraft(String(Math.round(fileStorageLimit / (1024 * 1024)))); setFileEditMode(true); }} title="Edit limit" style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: 5, border: '1px solid #cbd5e1', background: '#f8fafc', color: '#475569', cursor: 'pointer' }}>✏️</button>
              </span>
            )}
          </div>
          <div className={styles.statValue} style={{ fontSize: '1.6rem', color: storageBarColor(filePct) }}>
            {loading ? '--' : fmtBytes(data?.fileStorageBytes)}
          </div>
          {!loading && data && (
            <ProgressBar value={data.fileStorageBytes ?? 0} limit={fileStorageLimit} colorFn={storageBarColor} />
          )}
        </div>
      </div>

      {/* Insights panel */}
      {!loading && data && (
        (() => {
          const warnings = [];
          if (edgePct >= 80) warnings.push(`Edge requests over 80% of the ${edgeLimit.toLocaleString()} monthly limit - you may incur Vercel overage charges.`);
          else if (edgePct >= 50) warnings.push(`Edge requests over 50% of the ${edgeLimit.toLocaleString()} monthly limit.`);
          if (dbPct >= 90) warnings.push(`Table data is over 90% of the ${fmtBytes(dbSizeLimit)} DB limit - consider archiving old records.`);
          else if (dbPct >= 70) warnings.push(`Table data is over 70% of the ${fmtBytes(dbSizeLimit)} DB limit.`);
          if (filePct >= 90) warnings.push(`File storage is over 90% of the ${fmtBytes(fileStorageLimit)} limit - remove unused media files.`);
          else if (filePct >= 70) warnings.push(`File storage is over 70% of the ${fmtBytes(fileStorageLimit)} limit.`);
          return warnings.length > 0 ? (
            <div className={styles.card} style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
              <div className={styles.cardTitle} style={{ color: '#92400e' }}>Usage Insights</div>
              {warnings.map((w, i) => (
                <p key={i} style={{ margin: '4px 0', fontSize: '0.875rem', color: '#78350f' }}>{w}</p>
              ))}
            </div>
          ) : null;
        })()
      )}

      {/* Module Breakdown */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>Edge Requests by Module &mdash; Last 30 Days</div>
        {loading ? (
          <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Loading...</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ textAlign: 'left',  padding: '8px 12px', color: '#475569', fontWeight: 600 }}>Module</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', color: '#475569', fontWeight: 600 }}>Requests</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', color: '#475569', fontWeight: 600 }}>Share</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data?.moduleCounts ?? {})
                .sort((a, b) => b[1] - a[1])
                .map(([mod, count]) => {
                  const total = data.totals?.last30d || 1;
                  const share = Math.round((count / total) * 100);
                  return (
                    <tr key={mod} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 12px', color: '#1e293b', textTransform: 'capitalize' }}>{mod}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#0ea5e9' }}>{count.toLocaleString()}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#64748b' }}>{share}%</td>
                    </tr>
                  );
                })}
              {Object.keys(data?.moduleCounts ?? {}).length === 0 && (
                <tr>
                  <td colSpan={3} style={{ padding: '16px 12px', textAlign: 'center', color: '#94a3b8' }}>
                    No data yet - requests will appear here after the first instrumented call.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* 7-Day Daily Trend */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>Daily Trend &mdash; Last 7 Days</div>
        {loading ? (
          <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Loading...</p>
        ) : (() => {
          const days = data?.last7Days ?? [];
          const maxCount = Math.max(...days.map(d => d.count), 1);
          return (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 90, marginBottom: 8 }}>
                {days.map(({ date, count }) => {
                  const barH = Math.max(3, Math.round((count / maxCount) * 80));
                  const p    = pct(count, Math.ceil(edgeLimit / 30));
                  return (
                    <div key={date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 3 }}>
                      {count > 0 && <span style={{ fontSize: '0.62rem', color: '#64748b' }}>{count.toLocaleString()}</span>}
                      <div style={{ width: '100%', height: barH, background: edgeBarColor(p), borderRadius: '4px 4px 0 0' }} />
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {days.map(({ date }) => (
                  <div key={date} style={{ flex: 1, textAlign: 'center', fontSize: '0.65rem', color: '#94a3b8' }}>
                    {new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </div>
                ))}
              </div>
            </>
          );
        })()}
      </div>

      {/* ── System Load Status (Intelligent Throttling) ──────────────────── */}
      {(() => {
        const ts   = throttleStatus;
        const meta = ts ? (LEVEL_META[ts.level] ?? LEVEL_META.NORMAL) : null;
        const lim      = ts?.edgeLimit ?? EDGE_LIMIT_FALLBACK;
        const monthPct = ts ? Math.round((ts.thisMonth / lim) * 100) : 0;

        return (
          <div style={{
            marginTop: 24,
            padding: 20,
            borderRadius: 12,
            background: meta?.bg ?? '#f8fafc',
            border: `1.5px solid ${meta?.border ?? '#e2e8f0'}`,
          }}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '1.1rem' }}>🧠</span>
                <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1e293b' }}>
                  Intelligent Throttling — System Load Status
                </span>
                {ts && (
                  <span style={{
                    fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em',
                    padding: '2px 8px', borderRadius: 99,
                    background: ts.throttlingEnabled ? '#dcfce7' : '#f1f5f9',
                    color:      ts.throttlingEnabled ? '#15803d' : '#64748b',
                  }}>
                    Throttling {ts.throttlingEnabled ? 'ON' : 'OFF'}
                  </span>
                )}
              </div>

              {/* Toggle button */}
              <button
                onClick={handleThrottleToggle}
                disabled={toggleSaving || throttleLoading || !ts}
                title={ts?.throttlingEnabled
                  ? 'Turn off request delays — low-priority endpoints will run at full speed. Monitoring stays active.'
                  : 'Turn on request delays — low-priority endpoints will be slowed at WARNING/HIGH/CRITICAL load levels.'}
                style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600,
                  cursor: toggleSaving || throttleLoading || !ts ? 'not-allowed' : 'pointer',
                  border: 'none',
                  background: ts?.throttlingEnabled ? '#fca5a5' : '#86efac',
                  color:      ts?.throttlingEnabled ? '#7f1d1d'  : '#14532d',
                  opacity: toggleSaving || throttleLoading || !ts ? 0.55 : 1,
                }}
              >
                {toggleSaving ? 'Saving…' : ts?.throttlingEnabled ? '⏸ Disable Throttling' : '▶ Enable Throttling'}
              </button>
            </div>

            {throttleLoading && !ts && (
              <p style={{ color: '#94a3b8', fontSize: '0.8rem', margin: 0 }}>Loading throttle status…</p>
            )}

            {ts && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                {/* Current level */}
                <div style={{ background: '#fff', borderRadius: 8, padding: '12px 14px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current Level</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: '1.2rem' }}>{meta.icon}</span>
                    <span style={{ fontWeight: 800, fontSize: '1rem', color: meta.color }}>{meta.label}</span>
                  </div>
                </div>

                {/* Monthly usage */}
                <div style={{ background: '#fff', borderRadius: 8, padding: '12px 14px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Monthly Usage</div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e293b' }}>
                    {ts.thisMonth.toLocaleString()}
                    {limitEditMode ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 6 }}>
                        <span style={{ fontWeight: 400, color: '#94a3b8' }}>/</span>
                        <input
                          type="number"
                          value={limitDraft}
                          onChange={e => setLimitDraft(e.target.value)}
                          style={{ width: 110, fontSize: '0.82rem', padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 6 }}
                          autoFocus
                        />
                        <button
                          onClick={handleLimitSave}
                          disabled={limitSaving}
                          style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 6, border: 'none', background: '#0ea5e9', color: '#fff', cursor: 'pointer' }}
                        >{limitSaving ? '…' : 'Save'}</button>
                        <button
                          onClick={() => setLimitEditMode(false)}
                          style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 6, border: 'none', background: '#e2e8f0', color: '#475569', cursor: 'pointer' }}
                        >Cancel</button>
                      </span>
                    ) : (
                      <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 2 }}>
                        / {lim.toLocaleString()}
                        <button
                          onClick={() => { setLimitDraft(String(lim)); setLimitEditMode(true); }}
                          title="Edit limit"
                          style={{ marginLeft: 6, fontSize: '0.68rem', padding: '1px 7px', borderRadius: 5, border: '1px solid #cbd5e1', background: '#f8fafc', color: '#475569', cursor: 'pointer' }}
                        >✏️ Edit</button>
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: 6, height: 5, borderRadius: 99, background: '#e2e8f0', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 99, background: meta.color, width: `${Math.min(monthPct, 100)}%`, transition: 'width 0.6s ease' }} />
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 3 }}>{monthPct}% used</div>
                </div>

                {/* Today */}
                <div style={{ background: '#fff', borderRadius: 8, padding: '12px 14px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Today</div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e293b' }}>{ts.todayCount.toLocaleString()}</div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 3 }}>Expected: ~{Math.round(ts.expectedDaily).toLocaleString()}</div>
                  {ts.spikeDetected && (
                    <div style={{ marginTop: 6, padding: '3px 7px', borderRadius: 6, background: '#fef9c3', color: '#92400e', fontSize: '0.68rem', fontWeight: 600 }}>
                      ⚡ Spike detected
                    </div>
                  )}
                </div>

                {/* Billing cycle */}
                <div style={{ background: '#fff', borderRadius: 8, padding: '12px 14px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Billing Day</div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e293b' }}>Day {ts.daysElapsed}</div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 3 }}>of cycle</div>
                </div>
              </div>
            )}

            {/* Insight text */}
            {ts && meta && (
              <p style={{ margin: '14px 0 0', fontSize: '0.78rem', color: meta.color, fontWeight: 500 }}>
                {meta.icon} {meta.desc}
              </p>
            )}
          </div>
        );
      })()}

      {/* Footer */}
      <p style={{ fontSize: '0.75rem', color: '#94a3b8', textAlign: 'center', marginTop: 8 }}>
        Auto-refreshes every 60 seconds &middot; Counts instrumented API calls only &middot; DB limit 500 MB &middot; Storage limit 1 GB &middot; Edge limit 1M / month
      </p>
    </div>
  );
}
