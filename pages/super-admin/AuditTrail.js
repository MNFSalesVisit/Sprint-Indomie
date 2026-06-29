import React, { useEffect, useState, useRef } from 'react';
import styles from '../../styles/superadmin.module.css';

// ── Action → colour mapping ────────────────────────────────────────────────
const ACTION_MAP = {
  stock_adjustment:  '#f59e0b',
  restore_backup:    '#ef4444',
  create_backup:     '#8b5cf6',
  login:             '#3b82f6',
  logout:            '#64748b',
  user_created:      '#10b981',
  user_updated:      '#3b82f6',
  user_deactivated:  '#ef4444',
  region_created:    '#10b981',
  product_created:   '#10b981',
  shop_created:      '#10b981',
  uplift_approved:   '#10b981',
  uplift_rejected:   '#ef4444',
};

function actionColor(act) {
  if (ACTION_MAP[act]) return ACTION_MAP[act];
  if (!act) return '#94a3b8';
  if (/^(create|add|register)/.test(act))  return '#10b981';
  if (/^(update|edit)|_adjustment$/.test(act)) return '#f59e0b';
  if (/^(delete|remove)|(reject)/.test(act))   return '#ef4444';
  if (/^approve/.test(act))                     return '#10b981';
  if (/(backup|restore)/.test(act))             return '#8b5cf6';
  return '#64748b';
}

// ── Date helpers ──────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );
}

function fmtRelative(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000)    return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

const PAGE_SIZE = 50;

export default function AuditTrail({ token }) {
  const auth = { Authorization: `Bearer ${token}` };

  // ── Meta (stats / filter options) ─────────────────────────────────────
  const [stats,       setStats]       = useState(null);
  const [actors,      setActors]      = useState([]);
  const [entities,    setEntities]    = useState([]);
  const [actionTypes, setActionTypes] = useState([]);

  // ── Log rows ───────────────────────────────────────────────────────────
  const [logs,    setLogs]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(false);
  const [page,    setPage]    = useState(1);

  // ── Filters ────────────────────────────────────────────────────────────
  const [search,       setSearch]       = useState('');
  const [filterEntity, setFilterEntity] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterActor,  setFilterActor]  = useState('');
  const [dateFrom,     setDateFrom]     = useState('');
  const [dateTo,       setDateTo]       = useState('');

  // ── Detail modal ───────────────────────────────────────────────────────
  const [detailLog, setDetailLog] = useState(null);

  // ── Auto-refresh ───────────────────────────────────────────────────────
  const [autoRefresh, setAutoRefresh] = useState(false);
  const refreshIntervalRef = useRef(null);

  // ── Initial meta load ──────────────────────────────────────────────────
  useEffect(() => {
    loadMeta();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Log load — triggered by every filter/page change ──────────────────
  useEffect(() => {
    let cancelled = false;
    const delay = search ? 380 : 0; // debounce only for free-text search
    const timer = setTimeout(() => {
      fetchLogs(cancelled).then(({ items, total: t }) => {
        if (!cancelled) { setLogs(items); setTotal(t); setLoading(false); }
      });
      if (!cancelled) setLoading(true);
    }, delay);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [page, search, filterEntity, filterAction, filterActor, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-refresh interval ──────────────────────────────────────────────
  useEffect(() => {
    clearInterval(refreshIntervalRef.current);
    if (autoRefresh) {
      refreshIntervalRef.current = setInterval(() => {
        loadMeta(true);
        fetchLogs(false).then(({ items, total: t }) => {
          setLogs(items); setTotal(t);
        });
      }, 30_000);
    }
    return () => clearInterval(refreshIntervalRef.current);
  }, [autoRefresh, page, search, filterEntity, filterAction, filterActor, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ────────────────────────────────────────────────────────────
  async function loadMeta(silent = false) {
    const [sRes, aRes, eRes, tRes] = await Promise.all([
      fetch('/api/admin/audit-trail?action=stats',        { headers: auth }),
      fetch('/api/admin/audit-trail?action=actors',       { headers: auth }),
      fetch('/api/admin/audit-trail?action=entities',     { headers: auth }),
      fetch('/api/admin/audit-trail?action=action_types', { headers: auth }),
    ]);

    const safeJson = async (res, fallback) => {
      try { const d = await res.json(); return res.ok ? d : fallback; }
      catch { return fallback; }
    };

    const [sData, aData, eData, tData] = await Promise.all([
      safeJson(sRes, null),
      safeJson(aRes, []),
      safeJson(eRes, []),
      safeJson(tRes, []),
    ]);

    setStats(sData);
    setActors(Array.isArray(aData) ? aData : []);
    setEntities(Array.isArray(eData) ? eData : []);
    setActionTypes(Array.isArray(tData) ? tData : []);
  }

  async function fetchLogs(cancelled) {
    const params = new URLSearchParams({ action: 'logs', page, limit: PAGE_SIZE });
    if (search)       params.set('search',      search);
    if (filterEntity) params.set('entity',      filterEntity);
    if (filterAction) params.set('action_type', filterAction);
    if (filterActor)  params.set('actor_id',    filterActor);
    if (dateFrom)     params.set('date_from',   dateFrom);
    if (dateTo)       params.set('date_to',     dateTo);
    try {
      const res  = await fetch(`/api/admin/audit-trail?${params}`, { headers: auth });
      const data = await res.json();
      return { items: data.items || [], total: data.total || 0 };
    } catch {
      return { items: [], total: 0 };
    }
  }

  function resetFilters() {
    setSearch(''); setFilterEntity(''); setFilterAction('');
    setFilterActor(''); setDateFrom(''); setDateTo('');
    setPage(1);
  }

  function handleRefresh() {
    loadMeta();
    setPage(p => {
      // force re-trigger the log effect even if page == 1
      if (p === 1) { setPage(0); setTimeout(() => setPage(1), 0); return p; }
      return 1;
    });
  }

  function exportData(fmt) {
    const now = new Date().toISOString().slice(0, 10);
    if (fmt === 'json') {
      const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
      dlBlob(blob, `audit-trail-${now}.json`);
    } else {
      const headers = ['ID', 'Timestamp', 'Actor', 'Action', 'Entity'];
      const rows = logs.map(l => [
        l.id,
        fmtDate(l.created_at),
        l.app_users?.full_name || 'System',
        l.action,
        l.entity || '',
      ]);
      const csv = [headers, ...rows]
        .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      dlBlob(new Blob([csv], { type: 'text/csv' }), `audit-trail-${now}.csv`);
    }
  }

  function dlBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }

  const totalPages  = Math.ceil(total / PAGE_SIZE);
  const hasFilters  = search || filterEntity || filterAction || filterActor || dateFrom || dateTo;

  // ── Pagination helpers ─────────────────────────────────────────────────
  function pageButtons() {
    if (totalPages <= 1) return [];
    const window  = 3;
    const buttons = [];
    let start = Math.max(1, page - window);
    let end   = Math.min(totalPages, page + window);
    if (page - window < 1)            end   = Math.min(totalPages, end + (window - (page - 1)));
    if (page + window > totalPages)   start = Math.max(1, start - (page + window - totalPages));
    for (let p = start; p <= end; p++) buttons.push(p);
    return buttons;
  }

  // ──────────────────────────────────────────────────────────────────────
  return (
    <div className={styles.atWrap}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className={styles.atHeader}>
        <div>
          <h2 className={styles.atTitle}>Audit Trail</h2>
          <p className={styles.atSub}>Compliance logs, data change history and system events</p>
        </div>
        <div className={styles.atHeaderActions}>
          <label className={styles.atAutoLabel}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh (30 s)
          </label>
          <button className={styles.atRefreshBtn} onClick={handleRefresh}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* ── Stats cards ────────────────────────────────────────────────── */}
      {stats && (
        <div className={styles.atStatsRow}>
          <div className={styles.atStatCard}>
            <div className={styles.atStatVal}>{(stats.total ?? 0).toLocaleString()}</div>
            <div className={styles.atStatLbl}>Total Events</div>
          </div>
          <div className={styles.atStatCard}>
            <div className={styles.atStatVal} style={{ color: '#059669' }}>
              {(stats.today ?? 0).toLocaleString()}
            </div>
            <div className={styles.atStatLbl}>Today</div>
          </div>
          <div className={styles.atStatCard}>
            <div className={styles.atStatVal} style={{ color: '#7c3aed' }}>
              {stats.distinctActors ?? 0}
            </div>
            <div className={styles.atStatLbl}>Distinct Actors</div>
          </div>
          <div className={styles.atStatCard}>
            <div className={styles.atStatValSm}>
              {stats.latestAt ? fmtRelative(stats.latestAt) : '—'}
            </div>
            <div className={styles.atStatLbl}>Last Event</div>
          </div>
        </div>
      )}

      {/* ── Entity breakdown ────────────────────────────────────────────── */}
      {stats?.byEntity?.length > 0 && (
        <div className={styles.atBreakdown}>
          <div className={styles.atBreakdownTitle}>Activity by Entity</div>
          <div className={styles.atBars}>
            {stats.byEntity.map(({ entity: ent, count }) => {
              const pct = stats.total > 0
                ? Math.max(3, Math.round((count / stats.total) * 100))
                : 3;
              return (
                <div
                  key={ent}
                  className={styles.atBarRow}
                  onClick={() => { setFilterEntity(ent); setPage(1); }}
                  title={`Filter by ${ent}`}
                >
                  <div className={styles.atBarLabel}>{ent}</div>
                  <div className={styles.atBarTrack}>
                    <div className={styles.atBarFill} style={{ width: `${pct}%` }} />
                  </div>
                  <div className={styles.atBarCount}>{count.toLocaleString()}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <div className={styles.atFilters}>
        <div className={styles.atFilterRow}>
          <div className={styles.atFGroup}>
            <label className={styles.atFLabel}>Search</label>
            <input
              className={styles.atSearchInput}
              placeholder="Action, entity, ID…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <div className={styles.atFGroup}>
            <label className={styles.atFLabel}>Entity</label>
            <select
              className={styles.atSelect}
              value={filterEntity}
              onChange={e => { setFilterEntity(e.target.value); setPage(1); }}
            >
              <option value="">All entities</option>
              {entities.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          <div className={styles.atFGroup}>
            <label className={styles.atFLabel}>Action</label>
            <select
              className={styles.atSelect}
              value={filterAction}
              onChange={e => { setFilterAction(e.target.value); setPage(1); }}
            >
              <option value="">All actions</option>
              {actionTypes.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className={styles.atFGroup}>
            <label className={styles.atFLabel}>Actor</label>
            <select
              className={styles.atSelect}
              value={filterActor}
              onChange={e => { setFilterActor(e.target.value); setPage(1); }}
            >
              <option value="">All actors</option>
              {actors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className={styles.atFGroup}>
            <label className={styles.atFLabel}>From</label>
            <input
              type="date"
              className={styles.atDateInput}
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setPage(1); }}
            />
          </div>
          <div className={styles.atFGroup}>
            <label className={styles.atFLabel}>To</label>
            <input
              type="date"
              className={styles.atDateInput}
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); setPage(1); }}
            />
          </div>
          {hasFilters && (
            <button className={styles.atClearBtn} onClick={resetFilters}>
              ✕ Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Summary bar ────────────────────────────────────────────────── */}
      <div className={styles.atSummaryBar}>
        <span className={styles.atSummaryText}>
          {loading
            ? 'Loading…'
            : `${total.toLocaleString()} event${total !== 1 ? 's' : ''}${hasFilters ? ' (filtered)' : ''}`}
        </span>
        <div className={styles.atExportBtns}>
          <button
            className={styles.atExportBtn}
            onClick={() => exportData('csv')}
            disabled={logs.length === 0}
          >
            ↓ CSV
          </button>
          <button
            className={styles.atExportBtn}
            onClick={() => exportData('json')}
            disabled={logs.length === 0}
          >
            ↓ JSON
          </button>
        </div>
      </div>

      {/* ── Table card ─────────────────────────────────────────────────── */}
      <div className={styles.atTableCard}>
        {loading ? (
          <div className={styles.atLoading}>Loading audit events…</div>
        ) : logs.length === 0 ? (
          <div className={styles.atEmpty}>
            <div className={styles.atEmptyIcon}>📋</div>
            <div className={styles.atEmptyTitle}>No events found</div>
            <div className={styles.atEmptySub}>
              {hasFilters
                ? 'Try adjusting or clearing the filters above.'
                : 'Audit events will appear here as actions are performed in the system.'}
            </div>
          </div>
        ) : (
          <div className={styles.atTableWrap}>
            <table className={styles.atTable}>
              <thead>
                <tr>
                  <th className={styles.atTh}>#</th>
                  <th className={styles.atTh}>Timestamp</th>
                  <th className={styles.atTh}>Actor</th>
                  <th className={styles.atTh}>Action</th>
                  <th className={styles.atTh}>Entity</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, idx) => {
                  const clr = actionColor(log.action);
                  return (
                    <tr key={log.id} className={styles.atTr}>
                      <td className={styles.atTdNum}>
                        {(page - 1) * PAGE_SIZE + idx + 1}
                      </td>
                      <td className={styles.atTd}>
                        <div className={styles.atTs}>{fmtDate(log.created_at)}</div>
                        <div className={styles.atRel}>{fmtRelative(log.created_at)}</div>
                      </td>
                      <td className={styles.atTd}>
                        {log.app_users?.full_name
                          ? <span className={styles.atActor}>{log.app_users.full_name}</span>
                          : <span className={styles.atSystem}>System</span>}
                      </td>
                      <td className={styles.atTd}>
                        <span
                          className={styles.atActionBadge}
                          style={{
                            background:   clr + '1a',
                            color:        clr,
                            borderColor:  clr + '50',
                          }}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className={styles.atTd}>
                        {log.entity
                          ? <span className={styles.atEntityPill}>{log.entity}</span>
                          : <span className={styles.atMuted}>—</span>}
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Pagination ─────────────────────────────────────────────── */}
        {totalPages > 1 && (
          <div className={styles.atPagination}>
            <button
              className={styles.atPgBtn}
              disabled={page <= 1}
              onClick={() => setPage(1)}
            >«</button>
            <button
              className={styles.atPgBtn}
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
            >‹</button>

            {pageButtons().map(p => (
              <button
                key={p}
                className={`${styles.atPgBtn} ${page === p ? styles.atPgActive : ''}`}
                onClick={() => setPage(p)}
              >{p}</button>
            ))}

            <button
              className={styles.atPgBtn}
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
            >›</button>
            <button
              className={styles.atPgBtn}
              disabled={page >= totalPages}
              onClick={() => setPage(totalPages)}
            >»</button>
            <span className={styles.atPgInfo}>
              Page {page} of {totalPages} · {total.toLocaleString()} events
            </span>
          </div>
        )}
      </div>

      {/* ── Detail modal ─────────────────────────────────────────────────── */}
      {detailLog && (
        <div
          className={styles.atOverlay}
          onClick={() => setDetailLog(null)}
        >
          <div
            className={styles.atModal}
            onClick={e => e.stopPropagation()}
          >
            <div className={styles.atModalHdr}>
              <div className={styles.atModalMeta}>
                <span
                  className={styles.atActionBadge}
                  style={{
                    background:  actionColor(detailLog.action) + '1a',
                    color:       actionColor(detailLog.action),
                    borderColor: actionColor(detailLog.action) + '50',
                  }}
                >
                  {detailLog.action}
                </span>
                {detailLog.entity && (
                  <span className={styles.atEntityPill} style={{ marginLeft: 8 }}>
                    {detailLog.entity}
                  </span>
                )}
                {detailLog.entity_id && (
                  <span className={styles.atModalId}>ID: {detailLog.entity_id}</span>
                )}
              </div>
              <div className={styles.atModalInfo}>
                <div className={styles.atTs}>{fmtDate(detailLog.created_at)}</div>
                <div className={styles.atModalBy}>
                  by {detailLog.app_users?.full_name || 'System'}
                </div>
              </div>
              <button
                className={styles.atModalClose}
                onClick={() => setDetailLog(null)}
              >✕</button>
            </div>
            <div className={styles.atModalBody}>
              <pre className={styles.atJsonPre}>
                {JSON.stringify(detailLog.details, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
