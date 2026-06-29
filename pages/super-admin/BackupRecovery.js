import React, { useEffect, useState, useCallback, useRef } from 'react';
import styles from '../../styles/superadmin.module.css';

const ALL_TABLES = [
  'roles', 'regions', 'subregions', 'products', 'app_users',
  'user_regions', 'shops', 'stock_balances', 'visits', 'visit_items',
  'uplifts', 'uplift_items', 'targets', 'audit_logs',
];

const TABLE_LABELS = {
  roles: 'Roles', regions: 'Regions', subregions: 'Subregions',
  products: 'Products & SKUs', app_users: 'Users', user_regions: 'User–Regions',
  shops: 'Shops', stock_balances: 'Stock Balances', visits: 'Visits',
  visit_items: 'Visit Items', uplifts: 'Uplifts', uplift_items: 'Uplift Items',
  targets: 'Targets', audit_logs: 'Audit Logs',
};

const AUDIT_ENTITIES = [
  'user', 'product', 'shop', 'region', 'uplift', 'visit', 'stock', 'config', 'system',
];

const QUICK_EXPORTS = [
  { tbl: 'visits',         icon: '📍', label: 'Visits',         desc: 'All shop visit records' },
  { tbl: 'app_users',      icon: '👥', label: 'Users',          desc: 'Active salesperson list' },
  { tbl: 'shops',          icon: '🏪', label: 'Shops',          desc: 'Outlet master data' },
  { tbl: 'stock_balances', icon: '📦', label: 'Stock Balances', desc: 'Current stock levels' },
  { tbl: 'targets',        icon: '🎯', label: 'Targets',        desc: 'Monthly targets' },
  { tbl: 'uplifts',        icon: '🔄', label: 'Uplifts',        desc: 'Uplift request log' },
];

const SUB_TABS = [
  { id: 'backup',   label: '💾 Manual Backup' },
  { id: 'export',   label: '📤 Export Data' },
  { id: 'schedule', label: '📅 Schedule' },
  { id: 'restore',  label: '🔄 Restore' },
  { id: 'audit',    label: '📋 Audit Trail' },
];

// ── Export helpers ────────────────────────────────────────────────────────
function toCSV(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function downloadJSON(obj, filename) {
  triggerDownload(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }), filename);
}

function downloadCSV(rows, filename) {
  triggerDownload(new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8;' }), filename);
}

async function downloadExcel(tablesObj, filename) {
  const mod  = await import('xlsx');
  const XLSX = mod.default || mod;
  const wb   = XLSX.utils.book_new();
  for (const [tbl, rows] of Object.entries(tablesObj)) {
    if (!rows.length) continue;
    const flat = rows.map(r => {
      const o = {};
      for (const [k, v] of Object.entries(r))
        o[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
      return o;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flat), tbl.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

function fmt(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function dstamp() {
  return new Date().toISOString().slice(0, 10);
}

// ── Main component ────────────────────────────────────────────────────────
export default function BackupRecovery({ token }) {
  const [subTab, setSubTab]   = useState('backup');
  const [stats,  setStats]    = useState(null);
  const [history, setHistory] = useState([]);

  // Manual backup
  const [selTables,     setSelTables]     = useState([]); // empty = all
  const [backupFmt,     setBackupFmt]     = useState('json');
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupMsg,     setBackupMsg]     = useState('');

  // Export
  const [exportTable,   setExportTable]   = useState('visits');
  const [exportFmt,     setExportFmt]     = useState('csv');
  const [exportLoading, setExportLoading] = useState(false);

  // Schedule
  const [schedule,      setSchedule]      = useState({ enabled: false, frequency: 'daily', hour: 2, format: 'json' });
  const [schedLocal,    setSchedLocal]    = useState({ enabled: false, frequency: 'daily', hour: 2, format: 'json' });
  const [schedSaving,   setSchedSaving]   = useState(false);
  const [schedMsg,      setSchedMsg]      = useState('');
  const [historyReady,  setHistoryReady]  = useState(false);
  const [schedReady,    setSchedReady]    = useState(false);
  const scheduledCheckDone = useRef(false);

  // Restore
  const [restoreFile,    setRestoreFile]    = useState(null);
  const [restorePreview, setRestorePreview] = useState(null);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreMsg,     setRestoreMsg]     = useState('');
  const fileInputRef = useRef(null);

  // Audit
  const [auditItems,    setAuditItems]    = useState([]);
  const [auditTotal,    setAuditTotal]    = useState(0);
  const [auditPage,     setAuditPage]     = useState(1);
  const [auditEntity,   setAuditEntity]   = useState('');
  const [auditDateFrom, setAuditDateFrom] = useState('');
  const [auditDateTo,   setAuditDateTo]   = useState('');
  const [auditLoading,  setAuditLoading]  = useState(false);

  const auth = { Authorization: `Bearer ${token}` };

  // ── Load on mount ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    fetchStats();
    fetchHistory();
    fetchSchedule();
  }, [token]);

  async function fetchStats() {
    const r = await fetch('/api/admin/backup?action=stats', { headers: auth });
    if (r.ok) setStats(await r.json());
  }

  async function fetchHistory() {
    const r = await fetch('/api/admin/backup?action=history', { headers: auth });
    if (r.ok) setHistory(await r.json());
    setHistoryReady(true);
  }

  async function fetchSchedule() {
    const r = await fetch('/api/admin/backup?action=schedule', { headers: auth });
    if (r.ok) {
      const s = await r.json();
      setSchedule(s);
      setSchedLocal(s);
    }
    setSchedReady(true);
  }

  // ── Scheduled backup auto-run ───────────────────────────────────────────
  function getLastScheduledRunTime(sched) {
    const now = new Date();
    const h = sched.hour; // stored as UTC hour internally
    if (sched.frequency === 'daily') {
      const run = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, 0, 0));
      if (run > now) run.setUTCDate(run.getUTCDate() - 1);
      return run;
    }
    if (sched.frequency === 'weekly') {
      const diff = (now.getUTCDay() - 1 + 7) % 7; // days since last Monday
      const run = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff, h, 0, 0));
      if (run > now) run.setUTCDate(run.getUTCDate() - 7);
      return run;
    }
    if (sched.frequency === 'monthly') {
      const run = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, h, 0, 0));
      if (run > now) run.setUTCMonth(run.getUTCMonth() - 1);
      return run;
    }
    return null;
  }

  useEffect(() => {
    if (!historyReady || !schedReady || scheduledCheckDone.current) return;
    scheduledCheckDone.current = true;
    if (!schedule.enabled) return;
    const lastRun = getLastScheduledRunTime(schedule);
    if (!lastRun) return;
    const lastBackupTime = history.length > 0 ? new Date(history[0].created_at) : null;
    if (!lastBackupTime || lastBackupTime < lastRun) {
      runScheduledBackup(schedule);
    }
  }, [historyReady, schedReady]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runScheduledBackup(sched) {
    try {
      const r = await fetch(
        `/api/admin/backup?action=dump&tables=${ALL_TABLES.join(',')}`,
        { headers: auth },
      );
      if (!r.ok) return;
      const data = await r.json();
      const name = `scheduled-backup-${dstamp()}`;
      if (sched.format === 'xlsx') {
        await downloadExcel(data.tables, `${name}.xlsx`);
      } else {
        downloadJSON(
          { backup_format: 'sprint_v1', meta: data.meta, tables: data.tables },
          `${name}.json`,
        );
      }
      fetchHistory();
    } catch (_) { /* silent */ }
  }

  // ── Audit load ──────────────────────────────────────────────────────────
  const fetchAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const p = new URLSearchParams({ action: 'audit', page: auditPage, limit: 25 });
      if (auditEntity)   p.set('entity',    auditEntity);
      if (auditDateFrom) p.set('date_from', auditDateFrom);
      if (auditDateTo)   p.set('date_to',   auditDateTo);
      const r = await fetch(`/api/admin/backup?${p}`, { headers: auth });
      if (r.ok) {
        const d = await r.json();
        setAuditItems(d.items || []);
        setAuditTotal(d.total  || 0);
      }
    } finally { setAuditLoading(false); }
  }, [token, auditPage, auditEntity, auditDateFrom, auditDateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (subTab === 'audit') fetchAudit();
  }, [subTab, fetchAudit]);

  // ── Manual backup ───────────────────────────────────────────────────────
  async function doBackup() {
    setBackupLoading(true); setBackupMsg('');
    try {
      const tables = selTables.length > 0 ? selTables : ALL_TABLES;
      const r = await fetch(
        `/api/admin/backup?action=dump&tables=${tables.join(',')}`,
        { headers: auth },
      );
      if (!r.ok) { setBackupMsg('❌ Backup request failed.'); return; }
      const data = await r.json();
      const name = `backup-${dstamp()}`;

      if (backupFmt === 'json') {
        // Bundle meta + tables into one portable file
        downloadJSON(
          { backup_format: 'sprint_v1', meta: data.meta, tables: data.tables },
          `${name}.json`,
        );
      } else if (backupFmt === 'csv') {
        let i = 0;
        for (const [tbl, rows] of Object.entries(data.tables)) {
          if (!rows.length) continue;
          if (i > 0) await new Promise(ok => setTimeout(ok, 300));
          downloadCSV(rows, `${name}-${tbl}.csv`);
          i++;
        }
      } else {
        await downloadExcel(data.tables, `${name}.xlsx`);
      }

      const meta = data.meta;
      setBackupMsg(
        `✅ Backup complete — ${(meta?.total_rows ?? 0).toLocaleString()} rows across ${meta?.tables?.length ?? tables.length} tables.`,
      );
      fetchHistory();
    } catch (e) {
      setBackupMsg(`❌ Error: ${e.message}`);
    } finally {
      setBackupLoading(false);
    }
  }

  // Toggle table selection
  function toggleTable(tbl) {
    if (selTables.length === 0) {
      setSelTables(ALL_TABLES.filter(t => t !== tbl));
    } else if (selTables.includes(tbl)) {
      const next = selTables.filter(t => t !== tbl);
      setSelTables(next);
    } else {
      const next = [...selTables, tbl];
      setSelTables(next.length === ALL_TABLES.length ? [] : next);
    }
  }

  function isTableSelected(tbl) {
    return selTables.length === 0 || selTables.includes(tbl);
  }

  // ── Export ──────────────────────────────────────────────────────────────
  async function doExport(tbl = exportTable, fmt = exportFmt) {
    setExportLoading(true);
    try {
      const r = await fetch(`/api/admin/backup?action=dump&tables=${tbl}`, { headers: auth });
      if (!r.ok) return;
      const data = await r.json();
      const rows = data.tables?.[tbl] || [];
      const name = `${tbl}-${dstamp()}`;
      if (fmt === 'csv')  downloadCSV(rows, `${name}.csv`);
      else if (fmt === 'json') downloadJSON({ [tbl]: rows }, `${name}.json`);
      else await downloadExcel({ [tbl]: rows }, `${name}.xlsx`);
    } finally { setExportLoading(false); }
  }

  // ── Schedule ────────────────────────────────────────────────────────────
  async function saveSchedule() {
    setSchedSaving(true); setSchedMsg('');
    try {
      const r = await fetch('/api/admin/backup', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_schedule', schedule: schedLocal }),
      });
      if (r.ok) { setSchedMsg('✅ Schedule saved.'); setSchedule(schedLocal); }
      else setSchedMsg('❌ Failed to save schedule.');
    } finally { setSchedSaving(false); }
  }

  // ── Restore ─────────────────────────────────────────────────────────────
  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreFile(file);
    setRestoreConfirm(false);
    setRestoreMsg('');
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target.result);
        // Accept both { tables: {...} } (full backup) and plain { table: [...] }
        const tables = parsed.tables || parsed;
        const preview = {};
        for (const [tbl, rows] of Object.entries(tables))
          if (Array.isArray(rows)) preview[tbl] = rows.length;
        setRestorePreview(Object.keys(preview).length > 0 ? preview : null);
        if (!Object.keys(preview).length) setRestoreMsg('⚠️ No recognisable table data found in this file.');
      } catch {
        setRestorePreview(null);
        setRestoreMsg('⚠️ Invalid JSON file. Only .json backups exported by this system are supported.');
      }
    };
    reader.readAsText(file);
  }

  async function doRestore() {
    setRestoreLoading(true); setRestoreMsg('');
    try {
      const text = await restoreFile.text();
      const parsed = JSON.parse(text);
      const tables = parsed.tables || parsed;
      const r = await fetch('/api/admin/backup', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore', tables }),
      });
      const d = await r.json();
      if (!r.ok) { setRestoreMsg(`❌ Restore failed: ${d.error || 'Unknown error'}`); return; }
      const summary = Object.entries(d.results || {}).map(([t, n]) => `${TABLE_LABELS[t] || t}: ${n}`).join(' · ');
      const errPart = d.errors?.length
        ? `\n⚠️ ${d.errors.length} table(s) had errors: ${d.errors.map(e => e.table).join(', ')}`
        : '';
      setRestoreMsg(`✅ Restore complete.\n${summary}${errPart}`);
      setRestorePreview(null); setRestoreFile(null); setRestoreConfirm(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      fetchStats(); fetchHistory();
    } catch (e) {
      setRestoreMsg(`❌ Error: ${e.message}`);
    } finally { setRestoreLoading(false); }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const totalRows   = stats?.total ?? 0;
  const auditPages  = Math.max(1, Math.ceil(auditTotal / 25));

  return (
    <div className={styles.brWrap}>

      {/* ── Page header ── */}
      <div className={styles.brPageHeader}>
        <div>
          <h2 className={styles.brPageTitle}>💾 Backup &amp; Recovery</h2>
          <p className={styles.brPageSub}>Manage database backups, scheduled exports, point-in-time restores, and audit history.</p>
        </div>
        <button
          className={styles.brHeaderBtn}
          onClick={() => { setSubTab('backup'); doBackup(); }}
          title="Create full backup now"
        >
          + Quick Backup
        </button>
      </div>

      {/* ── Stats strip ── */}
      {stats && (
        <div className={styles.brStatsStrip}>
          <div className={styles.brStripItem}>
            <span className={styles.brStripVal}>{totalRows.toLocaleString()}</span>
            <span className={styles.brStripLabel}>Total Records</span>
          </div>
          <div className={styles.brStripDivider} />
          {[['visits','📍'],['shops','🏪'],['app_users','👥'],['uplifts','🔄']].map(([tbl, icon]) => (
            <React.Fragment key={tbl}>
              <div className={styles.brStripItem}>
                <span className={styles.brStripVal}>{(stats.counts[tbl] ?? 0).toLocaleString()}</span>
                <span className={styles.brStripLabel}>{icon} {TABLE_LABELS[tbl]}</span>
              </div>
              <div className={styles.brStripDivider} />
            </React.Fragment>
          ))}
          <div className={styles.brStripItem}>
            <span className={styles.brStripVal}>{history.length}</span>
            <span className={styles.brStripLabel}>💾 Snapshots</span>
          </div>
          <div className={styles.brStripDivider} />
          <div className={styles.brStripItem}>
            <span className={styles.brStripVal}>{schedule.enabled ? '🟢 On' : '⚪ Off'}</span>
            <span className={styles.brStripLabel}>Auto-Backup</span>
          </div>
        </div>
      )}

      {/* ── Sub-tab bar ── */}
      <div className={styles.brTabBar}>
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            className={`${styles.brTab} ${subTab === t.id ? styles.brTabActive : ''}`}
            onClick={() => setSubTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════
          MANUAL BACKUP
          ════════════════════════════════════════════════════════════════ */}
      {subTab === 'backup' && (
        <div className={styles.brBody}>

          {/* Create backup card */}
          <div className={styles.brCard}>
            <div className={styles.brCardHead}>
              <div className={styles.brCardIcon}>💾</div>
              <div>
                <div className={styles.brCardTitle}>Create Manual Backup</div>
                <div className={styles.brCardDesc}>Snapshot all or selected tables and download as JSON, Excel, or CSV.</div>
              </div>
            </div>

            {/* Table checkboxes */}
            <div className={styles.brField}>
              <div className={styles.brFieldLabel}>
                Tables to include
                {selTables.length > 0 && selTables.length < ALL_TABLES.length && (
                  <button className={styles.brLinkBtn} onClick={() => setSelTables([])}>Select all</button>
                )}
              </div>
              <div className={styles.brTableGrid}>
                {ALL_TABLES.map(t => (
                  <label key={t} className={styles.brCheckLabel}>
                    <input
                      type="checkbox"
                      className={styles.brCheckbox}
                      checked={isTableSelected(t)}
                      onChange={() => toggleTable(t)}
                    />
                    <span className={styles.brCheckText}>{TABLE_LABELS[t]}</span>
                    {stats && (
                      <span className={styles.brCheckCount}>{(stats.counts[t] ?? 0).toLocaleString()}</span>
                    )}
                  </label>
                ))}
              </div>
            </div>

            {/* Format selector */}
            <div className={styles.brField}>
              <div className={styles.brFieldLabel}>Download format</div>
              <div className={styles.brFmtRow}>
                {[['json', '{ } JSON', 'Single portable file'],
                  ['xlsx', '📊 Excel', 'One sheet per table'],
                  ['csv',  '⇄ CSV',   'One file per table']].map(([v, l, hint]) => (
                  <label
                    key={v}
                    className={`${styles.brFmtOption} ${backupFmt === v ? styles.brFmtOptionActive : ''}`}
                  >
                    <input type="radio" name="backupFmt" value={v} checked={backupFmt === v} onChange={() => setBackupFmt(v)} hidden />
                    <span className={styles.brFmtLabel}>{l}</span>
                    <span className={styles.brFmtHint}>{hint}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className={styles.brActions}>
              <button className={styles.btnPrimary} onClick={doBackup} disabled={backupLoading}>
                {backupLoading ? '⏳ Creating backup…' : '💾 Create Backup & Download'}
              </button>
            </div>
            {backupMsg && <div className={`${styles.brMsg} ${backupMsg.startsWith('✅') ? styles.brMsgOk : styles.brMsgErr}`}>{backupMsg}</div>}
          </div>

          {/* Backup history card */}
          <div className={styles.brCard}>
            <div className={styles.brCardTitle}>🕓 Backup History</div>
            <p className={styles.brCardDesc} style={{ marginBottom: 16 }}>
              Last {history.length > 0 ? Math.min(history.length, 50) : 0} manual backups recorded in this session.
            </p>
            {history.length === 0 ? (
              <div className={styles.brEmpty}>No backups recorded yet. Create your first backup above.</div>
            ) : (
              <div className={styles.brHistWrap}>
                <div className={styles.brHistHead}>
                  <span>Date &amp; Time</span>
                  <span>Created By</span>
                  <span>Tables</span>
                  <span>Total Rows</span>
                </div>
                {history.map(h => (
                  <div key={h.id} className={styles.brHistRow}>
                    <span className={styles.brHistDate}>{fmt(h.created_at)}</span>
                    <span className={styles.brHistBy}>{h.created_by}</span>
                    <div className={styles.brHistPills}>
                      {(h.tables || []).slice(0, 4).map(t => (
                        <span key={t} className={styles.brHistPill}>{TABLE_LABELS[t] || t}</span>
                      ))}
                      {(h.tables || []).length > 4 && (
                        <span className={styles.brHistPillMore}>+{(h.tables || []).length - 4}</span>
                      )}
                    </div>
                    <span className={styles.brHistRows}>{(h.total_rows || 0).toLocaleString()} rows</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          EXPORT DATA
          ════════════════════════════════════════════════════════════════ */}
      {subTab === 'export' && (
        <div className={styles.brBody}>

          {/* Custom export card */}
          <div className={styles.brCard}>
            <div className={styles.brCardHead}>
              <div className={styles.brCardIcon}>📤</div>
              <div>
                <div className={styles.brCardTitle}>Export Table Data</div>
                <div className={styles.brCardDesc}>Download any table in your preferred format.</div>
              </div>
            </div>
            <div className={styles.brFormRow}>
              <div className={styles.brField} style={{ flex: 2 }}>
                <div className={styles.brFieldLabel}>Table</div>
                <select className={styles.filterSelect} value={exportTable} onChange={e => setExportTable(e.target.value)}>
                  {ALL_TABLES.map(t => (
                    <option key={t} value={t}>{TABLE_LABELS[t]}{stats ? ` (${(stats.counts[t] ?? 0).toLocaleString()})` : ''}</option>
                  ))}
                </select>
              </div>
              <div className={styles.brField} style={{ flex: 1 }}>
                <div className={styles.brFieldLabel}>Format</div>
                <select className={styles.filterSelect} value={exportFmt} onChange={e => setExportFmt(e.target.value)}>
                  <option value="csv">CSV</option>
                  <option value="xlsx">Excel (.xlsx)</option>
                  <option value="json">JSON</option>
                </select>
              </div>
            </div>
            {stats && (
              <div className={styles.brNote}>
                📊 <strong>{(stats.counts[exportTable] ?? 0).toLocaleString()}</strong> rows will be exported from <em>{TABLE_LABELS[exportTable]}</em>
              </div>
            )}
            <button className={styles.btnPrimary} onClick={() => doExport()} disabled={exportLoading}>
              {exportLoading ? '⏳ Exporting…' : `📥 Download ${exportFmt.toUpperCase()}`}
            </button>
          </div>

          {/* Quick-export grid */}
          <div className={styles.brCard}>
            <div className={styles.brCardTitle}>⚡ Quick Exports</div>
            <p className={styles.brCardDesc} style={{ marginBottom: 16 }}>One-click downloads for the most common datasets.</p>
            <div className={styles.brQuickGrid}>
              {QUICK_EXPORTS.map(({ tbl, icon, label, desc }) => (
                <div key={tbl} className={styles.brQuickCard}>
                  <div className={styles.brQuickIconWrap}>{icon}</div>
                  <div className={styles.brQuickInfo}>
                    <div className={styles.brQuickLabel}>{label}</div>
                    <div className={styles.brQuickDesc}>{desc}</div>
                    {stats && (
                      <div className={styles.brQuickCount}>{(stats.counts[tbl] ?? 0).toLocaleString()} rows</div>
                    )}
                  </div>
                  <div className={styles.brQuickBtns}>
                    {['csv', 'xlsx', 'json'].map(fmt => (
                      <button key={fmt} className={styles.actionBtn} onClick={() => doExport(tbl, fmt)}>
                        {fmt.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          SCHEDULED BACKUPS
          ════════════════════════════════════════════════════════════════ */}
      {subTab === 'schedule' && (
        <div className={styles.brBody}>
          <div className={styles.brCard}>
            <div className={styles.brCardHead}>
              <div className={styles.brCardIcon}>📅</div>
              <div>
                <div className={styles.brCardTitle}>Scheduled Backup Configuration</div>
                <div className={styles.brCardDesc}>
                  Set the frequency and timing for automatic backups.
                </div>
              </div>
            </div>

            {/* Enable toggle */}
            <div className={styles.brToggleRow}>
              <span className={styles.brFieldLabel} style={{ marginBottom: 0 }}>Enable Scheduled Backups</span>
              <button
                className={`${styles.brToggle} ${schedLocal.enabled ? styles.brToggleOn : ''}`}
                onClick={() => setSchedLocal(s => ({ ...s, enabled: !s.enabled }))}
                aria-pressed={schedLocal.enabled}
              >
                <span className={styles.brToggleThumb} style={{ left: schedLocal.enabled ? 26 : 3 }} />
              </button>
            </div>

            <div className={`${styles.brSchedFields} ${!schedLocal.enabled ? styles.brSchedDisabled : ''}`}>
              <div className={styles.brFormRow}>
                <div className={styles.brField}>
                  <div className={styles.brFieldLabel}>Frequency</div>
                  <select
                    className={styles.filterSelect}
                    value={schedLocal.frequency}
                    disabled={!schedLocal.enabled}
                    onChange={e => setSchedLocal(s => ({ ...s, frequency: e.target.value }))}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly (Monday)</option>
                    <option value="monthly">Monthly (1st)</option>
                  </select>
                </div>
                <div className={styles.brField}>
                  <div className={styles.brFieldLabel}>Run at hour (EAT)</div>
                  <select
                    className={styles.filterSelect}
                    value={schedLocal.hour}
                    disabled={!schedLocal.enabled}
                    onChange={e => setSchedLocal(s => ({ ...s, hour: parseInt(e.target.value) }))}
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{String((i + 3) % 24).padStart(2, '0')}:00 EAT</option>
                    ))}
                  </select>
                </div>
                <div className={styles.brField}>
                  <div className={styles.brFieldLabel}>Format</div>
                  <select
                    className={styles.filterSelect}
                    value={schedLocal.format}
                    disabled={!schedLocal.enabled}
                    onChange={e => setSchedLocal(s => ({ ...s, format: e.target.value }))}
                  >
                    <option value="json">JSON</option>
                    <option value="xlsx">Excel</option>
                  </select>
                </div>
              </div>
            </div>

            {schedLocal.enabled && (
              <div className={styles.brSchedPreview}>
                <span className={styles.brSchedBadge}>🟢 Active</span>
                Runs <strong>{schedLocal.frequency}</strong> at{' '}
                <strong>{String((schedLocal.hour + 3) % 24).padStart(2, '0')}:00 EAT</strong>{' '}
                — format: <strong>{schedLocal.format.toUpperCase()}</strong>
              </div>
            )}



            <div className={styles.brActions}>
              <button className={styles.btnPrimary} onClick={saveSchedule} disabled={schedSaving}>
                {schedSaving ? '⏳ Saving…' : '💾 Save Schedule'}
              </button>
              {schedMsg && <span className={`${styles.brMsg} ${schedMsg.startsWith('✅') ? styles.brMsgOk : styles.brMsgErr}`}>{schedMsg}</span>}
            </div>
          </div>

          {/* Current saved schedule readout */}
          <div className={styles.brCard}>
            <div className={styles.brCardTitle}>📋 Saved Schedule</div>
            <div className={styles.brSchedReadout}>
              <div className={styles.brSchedRow}>
                <span className={styles.brSchedKey}>Status</span>
                <span>{schedule.enabled
                  ? <span className={styles.brBadgeGreen}>Enabled</span>
                  : <span className={styles.brBadgeGrey}>Disabled</span>}
                </span>
              </div>
              <div className={styles.brSchedRow}>
                <span className={styles.brSchedKey}>Frequency</span>
                <span className={styles.brSchedValue}>{schedule.frequency?.charAt(0).toUpperCase() + schedule.frequency?.slice(1)}</span>
              </div>
              <div className={styles.brSchedRow}>
                <span className={styles.brSchedKey}>Run time</span>
                <span className={styles.brSchedValue}>{String(((schedule.hour ?? 0) + 3) % 24).padStart(2, '0')}:00 EAT</span>
              </div>
              <div className={styles.brSchedRow}>
                <span className={styles.brSchedKey}>Format</span>
                <span className={styles.brSchedValue}>{(schedule.format || 'json').toUpperCase()}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          RESTORE
          ════════════════════════════════════════════════════════════════ */}
      {subTab === 'restore' && (
        <div className={styles.brBody}>
          <div className={styles.brCard}>
            <div className={styles.brCardHead}>
              <div className={styles.brCardIcon}>🔄</div>
              <div>
                <div className={styles.brCardTitle}>Restore from Backup</div>
              </div>
            </div>

            <div className={styles.brWarning}>
              ⚠️ <strong>Warning:</strong> This operation overwrites existing records with matching IDs and cannot be undone from the UI. Create a fresh backup first if needed.
            </div>

            {/* Drop zone */}
            <div
              className={`${styles.brDropZone} ${restoreFile ? styles.brDropZoneFilled : ''}`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
              {restoreFile ? (
                <div className={styles.brFileSel}>
                  <span className={styles.brFileIcon}>📄</span>
                  <div>
                    <div className={styles.brFileName}>{restoreFile.name}</div>
                    <div className={styles.brFileSize}>{(restoreFile.size / 1024).toFixed(1)} KB</div>
                  </div>
                  <button
                    className={styles.brFileClear}
                    onClick={e => {
                      e.stopPropagation();
                      setRestoreFile(null); setRestorePreview(null);
                      setRestoreMsg(''); setRestoreConfirm(false);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                  >✕</button>
                </div>
              ) : (
                <div className={styles.brDropPrompt}>
                  <span style={{ fontSize: '2.4rem', display: 'block', marginBottom: 8 }}>📁</span>
                  <div className={styles.brDropText}>Click to select a JSON backup file</div>
                  <div className={styles.brDropHint}>Only .json files exported by this system are accepted</div>
                </div>
              )}
            </div>

            {/* Preview */}
            {restorePreview && (
              <div className={styles.brPreview}>
                <div className={styles.brPreviewTitle}>📋 Backup contents preview</div>
                <div className={styles.brPreviewGrid}>
                  {Object.entries(restorePreview).map(([tbl, cnt]) => (
                    <div key={tbl} className={styles.brPreviewItem}>
                      <span className={styles.brPreviewTbl}>{TABLE_LABELS[tbl] || tbl}</span>
                      <span className={styles.brPreviewCnt}>{cnt.toLocaleString()} rows</span>
                    </div>
                  ))}
                </div>
                <label className={styles.brConfirmRow}>
                  <input
                    type="checkbox"
                    checked={restoreConfirm}
                    onChange={e => setRestoreConfirm(e.target.checked)}
                    className={styles.brCheckbox}
                  />
                  <span>I understand this will overwrite existing data. Proceed with restore.</span>
                </label>
                <button
                  className={styles.brDangerBtn}
                  disabled={!restoreConfirm || restoreLoading}
                  onClick={doRestore}
                >
                  {restoreLoading ? '⏳ Restoring database…' : '🔄 Restore Database'}
                </button>
              </div>
            )}

            {restoreMsg && (
              <div className={`${styles.brMsg} ${restoreMsg.startsWith('✅') ? styles.brMsgOk : styles.brMsgErr}`}
                style={{ marginTop: 14, whiteSpace: 'pre-wrap' }}>
                {restoreMsg}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          AUDIT TRAIL
          ════════════════════════════════════════════════════════════════ */}
      {subTab === 'audit' && (
        <div className={styles.brBody}>
          <div className={styles.brCard}>
            <div className={styles.brCardHead}>
              <div className={styles.brCardIcon}>📋</div>
              <div>
                <div className={styles.brCardTitle}>Audit Trail</div>
              </div>
            </div>

            {/* Filters */}
            <div className={styles.filterBar} style={{ marginBottom: 16 }}>
              <select
                className={styles.filterSelect}
                value={auditEntity}
                onChange={e => { setAuditEntity(e.target.value); setAuditPage(1); }}
              >
                <option value="">All Entities</option>
                {AUDIT_ENTITIES.map(e => (
                  <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>
                ))}
              </select>
              <input
                type="date"
                className={styles.filterInput}
                value={auditDateFrom}
                onChange={e => { setAuditDateFrom(e.target.value); setAuditPage(1); }}
                style={{ maxWidth: 160, flex: 'none' }}
              />
              <span style={{ alignSelf: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>→</span>
              <input
                type="date"
                className={styles.filterInput}
                value={auditDateTo}
                onChange={e => { setAuditDateTo(e.target.value); setAuditPage(1); }}
                style={{ maxWidth: 160, flex: 'none' }}
              />
              <button className={styles.btnSecondary} onClick={() => { setAuditPage(1); fetchAudit(); }}>
                Refresh
              </button>
              {(auditEntity || auditDateFrom || auditDateTo) && (
                <button className={styles.brLinkBtn} onClick={() => {
                  setAuditEntity(''); setAuditDateFrom(''); setAuditDateTo(''); setAuditPage(1);
                }}>Clear filters</button>
              )}
            </div>

            {auditLoading ? (
              <div className={styles.brEmpty}>Loading audit logs…</div>
            ) : auditItems.length === 0 ? (
              <div className={styles.brEmpty}>No audit log entries match your filters.</div>
            ) : (
              <>
                <div className={styles.tableWrap}>
                  <table className={styles.brAuditTable}>
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Actor</th>
                        <th>Action</th>
                        <th>Entity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditItems.map(log => (
                        <tr key={log.id}>
                          <td className={styles.brAuditTime}>{fmt(log.created_at)}</td>
                          <td className={styles.brAuditActor}>
                            {log.app_users?.full_name
                              ? <span className={styles.brAuditName}>{log.app_users.full_name}</span>
                              : <span className={styles.brAuditUnknown}>System</span>}
                          </td>
                          <td>
                            <span className={styles.brAuditActionPill}>{log.action}</span>
                          </td>
                          <td className={styles.brAuditEntity}>{log.entity || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className={styles.brPager}>
                  <span className={styles.brPagerInfo}>{auditTotal.toLocaleString()} total entries</span>
                  <button
                    className={styles.brPagerBtn}
                    disabled={auditPage <= 1}
                    onClick={() => setAuditPage(p => p - 1)}
                  >← Prev</button>
                  <span className={styles.brPagerPage}>Page {auditPage} of {auditPages}</span>
                  <button
                    className={styles.brPagerBtn}
                    disabled={auditPage >= auditPages}
                    onClick={() => setAuditPage(p => p + 1)}
                  >Next →</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
