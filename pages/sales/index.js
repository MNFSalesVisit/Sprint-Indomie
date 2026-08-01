import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabaseClient';
import { useBranding } from '../../lib/brandingContext';
import { getAccuratePosition } from '../../lib/geolocation';
import styles from '../../styles/sales.module.css';
import UpliftTab from '../../components/UpliftTab';
import MyPerformance from '../../components/sales/MyPerformance';


// ── Session-level caches — survive tab remounts (component unmount/remount on tab switch) ────
const _dashCache  = { stats: null, statsTs: 0, mtdPercent: null, mtdTs: 0, uplifts: null, upliftTs: 0 };
const DASH_CACHE_TTL_MS  = 3 * 60 * 1000; // 3 min — dashboard stats, MTD, uplift list
const _metaCache  = { data: null, ts: 0 };  // /api/sales/meta (region + subregions + competitors)
const META_CACHE_TTL_MS  = 5 * 60 * 1000; // 5 min — meta is static within a session
const _stockCache = { data: null, ts: 0 };  // /api/sales/stock (salesperson stock balances)
const STOCK_CACHE_TTL_MS = 2 * 60 * 1000; // 2 min — invalidated after visit submission

/* ── Tab definitions ── */
// Required tabs are never hidden regardless of feature flags.
const REQUIRED_SALES_TAB_IDS = new Set(['visit', 'uplift', 'stock']);

const TABS = [
  { id: 'dashboard',   label: 'Dashboard',      icon: '🏠', featureKey: 'sales_dashboard'   },
  { id: 'visit',       label: 'Sales Visit',    icon: '🛒' },
  { id: 'uplift',      label: 'Uplift',         icon: '⬆️' },
  { id: 'performance', label: 'My Performance', icon: '📈', featureKey: 'sales_performance' },
  { id: 'history',     label: 'Daily Visit Log',icon: '📋', featureKey: 'sales_history'     },
  { id: 'stock',       label: 'Stock',          icon: '📦' },
  { id: 'profile',     label: 'Profile',        icon: '👤', featureKey: 'sales_profile'     },
];

/* ── Small helper components ── */
function StatCard({ label, value, color, sub, subClass }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statValue} style={{ color }}>{value ?? '—'}</div>
      <div className={styles.statLabel}>{label}</div>
      {sub && <div className={`${styles.statChange} ${styles[subClass]}`}>{sub}</div>}
    </div>
  );
}

function ActionCard({ icon, label, onClick }) {
  return (
    <button className={styles.actionCard} onClick={onClick}>
      <span className={styles.actionIcon}>{icon}</span>
      <span className={styles.actionLabel}>{label}</span>
    </button>
  );
}

function PlaceholderTab({ title, description }) {
  return (
    <div className={styles.placeholder}>
      <div className={styles.placeholderIcon}>🚧</div>
      <h3>{title}</h3>
      <p>{description}</p>
      <span className={styles.comingSoon}>Coming soon</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   DASHBOARD TAB
   ══════════════════════════════════════════════════════════ */
function DashboardTab({ currentUser, primary, accent, onNavigate }) {
  const name = currentUser?.full_name?.split(' ')[0] || 'Sales Rep';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const [stats,          setStats]          = useState(null);
  const [loadingStats,   setLoadingStats]   = useState(true);
  const [statsError,     setStatsError]     = useState('');
  const [mtdPercent, setMtdPercent] = useState(null);
  const [mtdLoading, setMtdLoading] = useState(true);

  // Uplift requests history (all statuses, MTD)
  const [uplifts,        setUplifts]        = useState([]);
  const [loadingUplifts,   setLoadingUplifts]   = useState(true);
  const [upliftError,      setUpliftError]      = useState('');
  const [upliftFilter,     setUpliftFilter]     = useState('all');
  const [upliftRefreshKey, setUpliftRefreshKey] = useState(0);

  // ── Reupload modal state ──────────────────────────────────────────────────
  const [reuploadTarget,     setReuploadTarget]     = useState(null);
  const [reuploadFile,       setReuploadFile]       = useState(null);
  const [reuploadPreview,    setReuploadPreview]    = useState(null);
  const [reuploadNote,       setReuploadNote]       = useState('');
  const [reuploadSubmitting, setReuploadSubmitting] = useState(false);
  const [reuploadError,      setReuploadError]      = useState('');
  const [reuploadDone,       setReuploadDone]       = useState(false);
  const reuploadReceiptRef = useRef(null);

  useEffect(() => {
    if (_dashCache.stats && (Date.now() - _dashCache.statsTs) < DASH_CACHE_TTL_MS) {
      setStats(_dashCache.stats); setLoadingStats(false); return;
    }
    async function load() {
      setLoadingStats(true);
      setStatsError('');
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const tok = session?.access_token;
        if (!tok) { setStatsError('Session expired.'); setLoadingStats(false); return; }
        const res  = await fetch('/api/sales/dashboard', { headers: { Authorization: `Bearer ${tok}` } });
        const data = await res.json();
        if (!res.ok) { setStatsError(data.error || 'Could not load stats.'); setLoadingStats(false); return; }
        _dashCache.stats   = data;
        _dashCache.statsTs = Date.now();
        setStats(data);
      } catch {
        setStatsError('Network error loading stats.');
      } finally {
        setLoadingStats(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (_dashCache.mtdTs && (Date.now() - _dashCache.mtdTs) < DASH_CACHE_TTL_MS) {
      setMtdPercent(_dashCache.mtdPercent); setMtdLoading(false); return;
    }
    // fetch monthly-to-date percent vs target
    async function loadMtd() {
      setMtdLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const tok = session?.access_token;
        if (!tok) { setMtdPercent(null); setMtdLoading(false); return; }
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const res = await fetch(`/api/sales/performance?year=${year}&month=${month}`, { headers: { Authorization: `Bearer ${tok}` } });
        const d = await res.json();
        if (!res.ok) { setMtdPercent(null); setMtdLoading(false); return; }
        const monthly = d.monthly || {};
        const target = monthly.target || (d.targets && d.targets.monthly_target) || null;
        const actual = monthly.cartons || 0;
        const pct = (target && target > 0) ? Math.min(100, Math.round((actual / target) * 100)) : null;
        _dashCache.mtdPercent = pct;
        _dashCache.mtdTs      = Date.now();
        setMtdPercent(pct);
      } catch (e) {
        setMtdPercent(null);
      } finally { setMtdLoading(false); }
    }
    loadMtd();
  }, []);

  useEffect(() => {
    // upliftRefreshKey resets to 0 on each remount — only bypass cache when a reupload was just submitted
    if (upliftRefreshKey === 0 && _dashCache.uplifts && (Date.now() - _dashCache.upliftTs) < DASH_CACHE_TTL_MS) {
      setUplifts(_dashCache.uplifts); setLoadingUplifts(false); return;
    }
    async function loadUplifts() {
      setLoadingUplifts(true); setUpliftError('');
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const tok = session?.access_token;
        if (!tok) { setUpliftError('Session expired.'); setLoadingUplifts(false); return; }
        const r = await fetch('/api/sales/history', { headers: { Authorization: `Bearer ${tok}` } });
        const d = await r.json();
        if (!r.ok) { setUpliftError(d.error || 'Could not load uplift history.'); setLoadingUplifts(false); return; }
        _dashCache.uplifts  = d.uplifts || [];
        _dashCache.upliftTs = Date.now();
        setUplifts(d.uplifts || []);
      } catch { setUpliftError('Network error.'); }
      finally  { setLoadingUplifts(false); }
    }
    loadUplifts();
  }, [upliftRefreshKey]); // re-fetch after a reupload

  const now       = new Date();
  const monthName = now.toLocaleString('default', { month: 'long' });
  const fmtDate   = iso => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  const fmtTime   = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const STATUS_LABELS = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };
  const STATUS_COLORS = {
    pending:  { bg: '#fef9c3', color: '#854d0e', icon: '⏳' },
    approved: { bg: '#dcfce7', color: '#166534', icon: '✅' },
    rejected: { bg: '#fee2e2', color: '#991b1b', icon: '❌' },
  };
  const filteredUplifts = upliftFilter === 'all' ? uplifts : uplifts.filter(u => u.status === upliftFilter);
  const upliftCounts = {
    all:      uplifts.length,
    pending:  uplifts.filter(u => u.status === 'pending').length,
    approved: uplifts.filter(u => u.status === 'approved').length,
    rejected: uplifts.filter(u => u.status === 'rejected').length,
  };

  const closeReuploadModal = () => {
    setReuploadTarget(null); setReuploadFile(null); setReuploadPreview(null);
    setReuploadNote(''); setReuploadError(''); setReuploadDone(false);
  };

  const handleReuploadFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReuploadFile(file);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = ev => setReuploadPreview(ev.target.result);
      reader.readAsDataURL(file);
    } else {
      setReuploadPreview(null);
    }
  };

  const handleReuploadSubmit = async () => {
    if (!reuploadFile) { setReuploadError('Please attach the new receipt.'); return; }
    setReuploadError('');
    setReuploadSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token;
      if (!tok) { setReuploadError('Session expired. Please sign in again.'); setReuploadSubmitting(false); return; }
      const receiptBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = ev => resolve(ev.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(reuploadFile);
      });
      const res = await fetch('/api/sales/uplift-reupload', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body:    JSON.stringify({ uplift_id: reuploadTarget.id, receipt_base64: receiptBase64, note: reuploadNote }),
      });
      const data = await res.json();
      if (!res.ok) { setReuploadError(data.error || 'Reupload failed. Please try again.'); setReuploadSubmitting(false); return; }
      setReuploadDone(true);
      setTimeout(() => { closeReuploadModal(); setUpliftRefreshKey(k => k + 1); }, 2200);
    } catch {
      setReuploadError('Network error. Please try again.');
    } finally {
      setReuploadSubmitting(false);
    }
  };

  return (
    <div>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{greeting}, {name} 👋</h1>
      </div>

      {/* KPI stats */}
      <div className={styles.statsGrid}>
        <StatCard
          label={`MTD Visits`}
          value={loadingStats ? '…' : (stats?.visitsMTD ?? '—')}
          color={primary}
        />
        <StatCard
          label="Conversion Rate"
          value={loadingStats ? '…' : (stats?.conversionPct != null ? `${stats.conversionPct}%` : '—')}
          color="#059669"
          sub={loadingStats ? null : (stats?.visitsMTD > 0 ? `${stats.convertedMTD} of ${stats.visitsMTD} visits` : null)}
          subClass="statChangeNeutral"
        />
        <StatCard
          label="Pending Uplifts"
          value={loadingStats ? '…' : (stats?.pendingUplifts ?? '—')}
          color="#d97706"
        />
        <StatCard
          label="Total Stock (ctn)"
          value={loadingStats ? '…' : (stats?.totalStock ?? '—')}
          color={accent}
          sub={loadingStats ? null : (stats?.stockItems?.length > 0 ? `${stats.stockItems.length} SKU${stats.stockItems.length !== 1 ? 's' : ''}` : null)}
          subClass="statChangeNeutral"
        />
        <StatCard
          label="MTD vs Target"
          value={mtdLoading ? '…' : (mtdPercent != null ? `${mtdPercent}%` : '—')}
          color="#0ea5a4"
        />
      </div>

      {statsError && (
        <div className={styles.alertDanger} style={{ marginBottom: 16 }}>{statsError}</div>
      )}

      {/* Quick actions */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}>Quick Actions</span>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.actionsGrid}>
            <ActionCard icon="🛒" label="New Visit"       onClick={() => onNavigate('visit')}   />
            <ActionCard icon="⬆️" label="Request Uplift"  onClick={() => onNavigate('uplift')}  />
            <ActionCard icon="📋" label="Daily Visit Log" onClick={() => onNavigate('history')} />
            <ActionCard icon="📦" label="View Stock"      onClick={() => onNavigate('stock')}   />
          </div>
        </div>
      </div>

      {/* ── Uplift Requests ── */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}>📦 Uplift Requests</span>
          <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>MTD</span>
        </div>

        {/* Status filter tabs */}
        <div style={{ padding: '0 16px 12px' }}>
          <div className={styles.pillTabs}>
            {[
              { key: 'all',      label: 'All'      },
              { key: 'pending',  label: 'Pending'  },
              { key: 'approved', label: 'Approved' },
              { key: 'rejected', label: 'Rejected' },
            ].map(f => (
              <button
                key={f.key}
                className={`${styles.pillTab} ${upliftFilter === f.key ? styles.pillTabActive : ''}`}
                style={upliftFilter === f.key ? { background: primary, borderColor: primary } : {}}
                onClick={() => setUpliftFilter(f.key)}
              >
                {f.label}
                <span style={{
                  marginLeft: 5, fontSize: '0.68rem', fontWeight: 700,
                  background: upliftFilter === f.key ? 'rgba(255,255,255,0.35)' : '#e2e8f0',
                  color: upliftFilter === f.key ? 'inherit' : '#64748b',
                  padding: '0 5px', borderRadius: 8,
                }}>{upliftCounts[f.key]}</span>
              </button>
            ))}
          </div>
        </div>

        {upliftError && <div className={styles.alertDanger} style={{ margin: '0 16px 12px' }}>{upliftError}</div>}

        {loadingUplifts ? (
          <div style={{ textAlign: 'center', padding: '28px 0', color: '#94a3b8' }}>Loading…</div>
        ) : filteredUplifts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '28px 0', color: '#94a3b8', fontSize: '0.85rem' }}>
            No {upliftFilter === 'all' ? '' : (upliftFilter + ' ')}uplift requests this month.
          </div>
        ) : (
          <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredUplifts.map(u => {
              const totalCtns = (u.uplift_items || []).reduce((s, i) => s + (i.cartons || 0), 0);
              const sc = STATUS_COLORS[u.status] || {};
              return (
                <div key={u.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.9rem' }}>{u.shops?.name || '—'}</div>
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 1 }}>
                        {fmtDate(u.created_at)} · {fmtTime(u.created_at)}
                      </div>
                    </div>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: sc.bg, color: sc.color }}>
                      {sc.icon} {STATUS_LABELS[u.status]}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                    {(u.uplift_items || []).map((item, idx) => (
                      <span key={idx} style={{ fontSize: '0.7rem', background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: 6, fontWeight: 600 }}>
                        {item.products?.sku} · {item.cartons} ctn
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    Total: <strong>{totalCtns} carton{totalCtns !== 1 ? 's' : ''}</strong>
                  </div>
                  {u.status === 'approved' && u.approved_at && (
                    <div style={{ fontSize: '0.7rem', color: '#16a34a', marginTop: 3 }}>✓ Approved {fmtDate(u.approved_at)}</div>
                  )}
                  {u.is_reuploaded && (
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 5,
                      background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6,
                      padding: '2px 9px', fontSize: '0.68rem', fontWeight: 700, color: '#c2410c',
                    }}>
                      🔄 Resubmitted{u.reupload_count > 1 ? ` · Attempt ${u.reupload_count}` : ''}
                    </div>
                  )}
                  {u.status === 'rejected' && (
                    <div style={{ marginTop: 8, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 12px' }}>
                      {u.rejected_reason && (
                        <div style={{ fontSize: '0.78rem', color: '#991b1b', marginBottom: (u.reupload_count || 0) < 3 ? 10 : 0, lineHeight: 1.5 }}>
                          <strong>✗ Rejected:</strong> {u.rejected_reason}
                        </div>
                      )}
                      {(u.reupload_count || 0) >= 3 ? (
                        <div style={{ fontSize: '0.72rem', color: '#64748b', textAlign: 'center', padding: '4px 0' }}>
                          Maximum reupload attempts reached. Please contact your admin.
                        </div>
                      ) : (
                        <button
                          onClick={() => { setReuploadTarget(u); setReuploadFile(null); setReuploadPreview(null); setReuploadNote(''); setReuploadError(''); setReuploadDone(false); }}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            background: '#7c3aed', color: '#fff',
                            border: 'none', borderRadius: 7,
                            padding: '8px 14px', fontSize: '0.8rem', fontWeight: 700,
                            cursor: 'pointer', width: '100%',
                          }}
                        >
                          🔄 Reupload Receipt
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Reupload Receipt Modal ── */}
      {reuploadTarget && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)',
            backdropFilter: 'blur(4px)', zIndex: 1000,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
          onClick={closeReuploadModal}
        >
          <div
            style={{
              background: '#fff', borderRadius: '20px 20px 0 0',
              width: '100%', maxWidth: 520, maxHeight: '90vh',
              overflowY: 'auto', padding: '20px 20px 32px',
              boxShadow: '0 -8px 32px rgba(0,0,0,0.18)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div style={{ width: 40, height: 4, background: '#e2e8f0', borderRadius: 99, margin: '0 auto 18px' }} />

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 800, color: '#1e293b', fontSize: '1rem' }}>🔄 Reupload Receipt</div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 3 }}>
                  {reuploadTarget.shops?.name || '—'}
                  {(reuploadTarget.reupload_count || 0) > 0 ? ` · Attempt ${(reuploadTarget.reupload_count || 0) + 1}` : ''}
                </div>
              </div>
              <button
                onClick={closeReuploadModal}
                style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: '0.9rem', color: '#64748b' }}
              >✕</button>
            </div>

            {/* Rejection reason reminder */}
            {reuploadTarget.rejected_reason && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: '0.82rem', color: '#991b1b', lineHeight: 1.5 }}>
                <strong>Rejection reason:</strong> {reuploadTarget.rejected_reason}
              </div>
            )}

            {reuploadDone ? (
              <div style={{ textAlign: 'center', padding: '28px 0' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>✅</div>
                <div style={{ fontWeight: 700, color: '#065f46', marginBottom: 6 }}>Receipt Resubmitted!</div>
                <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Your request is back in pending review.</div>
              </div>
            ) : (
              <>
                {/* File picker */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: 8 }}>
                    New Receipt / Delivery Note <span style={{ color: '#ef4444' }}>*</span>
                  </div>
                  <input
                    ref={reuploadReceiptRef}
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleReuploadFileChange}
                    style={{ display: 'none' }}
                  />
                  {reuploadPreview && (
                    <div style={{ position: 'relative', textAlign: 'center', marginBottom: 8 }}>
                      <img
                        src={reuploadPreview}
                        alt="receipt preview"
                        style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 10, border: '1px solid #e2e8f0', objectFit: 'contain' }}
                      />
                      <button
                        onClick={() => { setReuploadFile(null); setReuploadPreview(null); }}
                        style={{ position: 'absolute', top: 6, right: 6, background: '#ef4444', color: '#fff', border: 'none', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}
                      >✕</button>
                    </div>
                  )}
                  {!reuploadPreview && reuploadFile && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 9, padding: '10px 14px', marginBottom: 8 }}>
                      <span>📄</span>
                      <span style={{ fontSize: '0.82rem', color: '#334155', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{reuploadFile.name}</span>
                      <button onClick={() => setReuploadFile(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>✕</button>
                    </div>
                  )}
                  <button
                    onClick={() => reuploadReceiptRef.current?.click()}
                    style={{
                      width: '100%', padding: '12px', borderRadius: 10,
                      border: '2px dashed #c4b5fd', background: '#faf5ff',
                      color: '#7c3aed', fontWeight: 700, fontSize: '0.88rem',
                      cursor: 'pointer', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', gap: 8,
                    }}
                  >
                    📎 {reuploadFile ? 'Change file' : 'Select receipt / delivery note'}
                  </button>
                </div>

                {/* Note to admin */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                    Note to admin{' '}
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 400 }}>(optional)</span>
                  </div>
                  <textarea
                    rows={3}
                    placeholder="e.g. Attached is the correct receipt — the original had the wrong shop."
                    value={reuploadNote}
                    onChange={e => setReuploadNote(e.target.value)}
                    style={{ width: '100%', border: '1.5px solid #e2e8f0', borderRadius: 9, padding: '10px 12px', fontSize: '0.85rem', color: '#334155', resize: 'none', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>

                {reuploadError && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 9, padding: '10px 14px', fontSize: '0.82rem', marginBottom: 12 }}>
                    {reuploadError}
                  </div>
                )}

                <button
                  onClick={handleReuploadSubmit}
                  disabled={reuploadSubmitting || !reuploadFile}
                  style={{
                    width: '100%', padding: '13px',
                    background: reuploadSubmitting || !reuploadFile ? '#c4b5fd' : '#7c3aed',
                    color: '#fff', border: 'none', borderRadius: 10,
                    fontWeight: 800, fontSize: '0.95rem',
                    cursor: reuploadSubmitting || !reuploadFile ? 'not-allowed' : 'pointer',
                  }}
                >
                  {reuploadSubmitting ? 'Submitting…' : '🔄 Resubmit Receipt'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   SALES VISIT TAB  (skeleton)
   ══════════════════════════════════════════════════════════ */
// Fallback reasons used if the API is unreachable or the table doesn't exist yet
const FALLBACK_NOT_SOLD_REASONS = [
  { label: 'Financial constraints'  },
  { label: 'Stock available'        },
  { label: 'Other (enter manually)' },
];

/** Returns true if a not-sold reason label represents the free-text "Other" option */
function isOtherReason(label) { return /^other/i.test((label || '').trim()); }

/** Clamp a numeric string to min 0 */
function clamp0(v) { return Math.max(0, parseInt(v, 10) || 0); }

/** Haversine distance (metres) */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // metres
  const toRad = d => (d * Math.PI) / 180;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const dφ = toRad(lat2 - lat1), dλ = toRad(lon2 - lon1);
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Module-level shop list cache: persists across VisitTab remounts (tab switches).
// Key: subregionId (string) → { shops: [], ts: number }
const _visitShopsCache = new Map();
const VISIT_SHOPS_CACHE_TTL = 120_000; // 2 minutes

function VisitTab({ primary, accent, onNavigate }) {
  const [step, setStep] = useState(1); // 1=shop, 2=stock, 3=selfie/submit

  // Region & sub-region state (auto-resolved)
  const [region,       setRegion]       = useState(null);   // { id, name }
  const [subregions,   setSubregions]   = useState([]);
  const [loadingMeta,  setLoadingMeta]  = useState(true);
  const [metaError,    setMetaError]    = useState('');

  // Step 1 selections
  const [subregionId,  setSubregionId]  = useState('');
  const [shopMode,     setShopMode]     = useState('existing'); // 'existing' | 'new'
  const [shops,        setShops]        = useState([]);
  const [loadingShops, setLoadingShops] = useState(false);
  const [shopId,       setShopId]       = useState('');
  const [shopSearch,   setShopSearch]   = useState('');
  const [newShopName,  setNewShopName]  = useState('');
  const [newShopLoc,   setNewShopLoc]   = useState('');
  const [newShopLat,   setNewShopLat]   = useState(null); // GPS captured at registration
  const [newShopLng,   setNewShopLng]   = useState(null);
  const [locCapturing, setLocCapturing] = useState(false);
  const [locError,     setLocError]     = useState('');
  const [dupMatches,   setDupMatches]   = useState([]);   // potential duplicate shops
  const [dupChecking,  setDupChecking]  = useState(false);
  const [dupDismissed, setDupDismissed] = useState(false);
  const [step1Error,   setStep1Error]   = useState('');
  // Nearby-shops state (300 meters suggestions)
  const [nearbyShops, setNearbyShops] = useState([]);
  const [nearbyChecking, setNearbyChecking] = useState(false);
  const [nearbyConfirmNew, setNearbyConfirmNew] = useState(false);
  const [nearbyWarning, setNearbyWarning] = useState('');
  // Current captured GPS (reused to avoid repeated prompts)
  const [currentLat, setCurrentLat] = useState(null);
  const [currentLng, setCurrentLng] = useState(null);
  // Distance (metres) from current GPS to the selected existing shop
  const [selectedShopDistance, setSelectedShopDistance] = useState(null);
  // Prevent duplicate fetch on React Strict Mode mount
  const hasFetchedOnMountRef = useRef(false);

  // Memoised filtered shop list — only recomputes when shops array or search text changes
  const filteredShops = useMemo(() => {
    const q = shopSearch.toLowerCase();
    return shops.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.location || '').toLowerCase().includes(q)
    );
  }, [shops, shopSearch]);

  // Step 2 — products from super admin + per-SKU carton qty
  const [products,        setProducts]        = useState([]);   // [{ id, sku, name }]
  const [loadingProds,    setLoadingProds]    = useState(false);
  const [prodsError,      setProdsError]      = useState('');
  const [soldQty,         setSoldQty]         = useState({});   // { [id]: number } cartons sold
  const [stockPos,        setStockPos]        = useState({});   // { [id]: number } qty at shop
  const [stockUnit,       setStockUnit]       = useState({});   // { [id]: 'cartons'|'pcs' }
  const [stockBalances,   setStockBalances]   = useState({});   // { [id]: number } — rep's own stock
  // Single visit-level sold decision
  const [visitSold,      setVisitSold]      = useState('');   // 'yes' | 'no'
  const [visitReason,    setVisitReason]    = useState('');   // label text
  const [visitOtherText, setVisitOtherText] = useState('');
  const [step2Error,     setStep2Error]     = useState('');
  // No-sale reasons — loaded dynamically from the server
  const [noSaleReasons,  setNoSaleReasons]  = useState(FALLBACK_NOT_SOLD_REASONS);
  // Competitor presence — multi-select; empty array = none selected
  const [competitorSelected, setCompetitorSelected] = useState([]); // array of selected brand names
  const [competitorOther, setCompetitorOther] = useState('');
  const [competitorOptions, setCompetitorOptions] = useState([]); // server-sourced names
  const [competitorLoading, setCompetitorLoading] = useState(false);
  const [competitorError, setCompetitorError] = useState('');

  

  // Step 3 — camera / selfie
  const videoRef           = useRef(null);
  const canvasRef          = useRef(null);
  const streamRef          = useRef(null);
  const pendingShopIdRef   = useRef(null); // used when auto-selecting shop in a different subregion
  const [selfieDataUrl,  setSelfieDataUrl]  = useState(null);
  const [cameraError,    setCameraError]    = useState('');
  const [submitting,     setSubmitting]     = useState(false);
  const [submitError,    setSubmitError]    = useState('');
  const [submitDone,     setSubmitDone]     = useState(false);

  // Storage settings — compression quality & max sizes (loaded once on mount)
  const [storageSettings, setStorageSettings] = useState({
    selfie:  { compressionEnabled: true, compressionQuality: 70, maxSizeBytes: 2097152 },
    receipt: { maxSizeBytes: 5242880 },
  });

  // On mount: fetch the salesperson's profile to get their region, then load subregions
  useEffect(() => {
    async function load() {
      // Serve from module-level cache — avoids a round-trip every time user switches back to Visit tab
      if (_metaCache.data && (Date.now() - _metaCache.ts) < META_CACHE_TTL_MS) {
        const d = _metaCache.data;
        setRegion({ id: d.region_id, name: d.region_name });
        setSubregions(d.subregions ?? []);
        setCompetitorOptions((d.competitor_products ?? []).map(x => x.name));
        setLoadingMeta(false);
        return;
      }
      setLoadingMeta(true);
      setMetaError('');
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const tok = session?.access_token;
        if (!tok) { setMetaError('Session expired. Please sign in again.'); setLoadingMeta(false); return; }

        // Single request: profile + subregions + competitor products in one round-trip
        const metaRes  = await fetch('/api/sales/meta', { headers: { Authorization: `Bearer ${tok}` } });
        const metaData = await metaRes.json();
        if (!metaRes.ok) { setMetaError(metaData.error || 'Could not load profile.'); setLoadingMeta(false); return; }

        if (!metaData.region_id) {
          setMetaError('No region has been assigned to your account. Contact your administrator.');
          setLoadingMeta(false);
          return;
        }

        _metaCache.data = metaData;
        _metaCache.ts   = Date.now();
        setRegion({ id: metaData.region_id, name: metaData.region_name });
        setSubregions(metaData.subregions ?? []);
        setCompetitorOptions((metaData.competitor_products ?? []).map(x => x.name));

        // Fetch storage settings (compression quality, max sizes) — non-blocking
        try {
          const ssRes = await fetch('/api/sales/storage-settings', { headers: { Authorization: `Bearer ${tok}` } });
          if (ssRes.ok) {
            const ssData = await ssRes.json();
            setStorageSettings(ssData);
          }
        } catch { /* use defaults silently */ }

        // Fetch no-sale reasons — non-blocking, falls back to FALLBACK_NOT_SOLD_REASONS
        try {
          const nsr = await fetch('/api/sales/no-sale-reasons');
          if (nsr.ok) {
            const nsrData = await nsr.json();
            if (Array.isArray(nsrData) && nsrData.length > 0) {
              setNoSaleReasons(nsrData.map(r => ({ label: r.label })));
            }
          }
        } catch { /* keep fallback silently */ }
      } catch (err) {
        setMetaError('Network error. Please try again.');
      } finally {
        setLoadingMeta(false);
      }
    }
    load();
  }, []);

  // When subregion changes, fetch shops for it
  useEffect(() => {
    if (!subregionId) { setShops([]); setShopId(''); setShopSearch(''); return; }
    async function loadShops() {
      // Check module-level cache first (survives tab switches)
      const cacheKey = String(subregionId);
      const cached = _visitShopsCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < VISIT_SHOPS_CACHE_TTL) {
        setShops(cached.shops);
        setShopId('');
        setShopSearch('');
        return;
      }

      setLoadingShops(true);
      setShopId('');
      setShopSearch('');
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const tok = session?.access_token;
        const res  = await fetch(`/api/sales/shops?subregion_id=${subregionId}`, { headers: { Authorization: `Bearer ${tok}` } });
        const data = await res.json();
        const loaded = res.ok ? data : [];
        // Populate module-level cache
        _visitShopsCache.set(cacheKey, { shops: loaded, ts: Date.now() });
        setShops(loaded);
        // Apply any pending auto-selection from cross-subregion duplicate pick
        if (pendingShopIdRef.current) {
          const target = String(pendingShopIdRef.current);
          if (loaded.some(s => String(s.id) === target)) {
            setShopId(target);
            // validate immediately after auto-select
            const found = loaded.find(s => String(s.id) === target);
            try { validateSelectedShop(found); } catch (e) { console.log('validateSelectedShop error', e); }
          }
          pendingShopIdRef.current = null;
        }
      } catch { setShops([]); }
      finally { setLoadingShops(false); }
    }
    loadShops();
  }, [subregionId]);

  // Auto-start front camera when entering Step 3; stop when leaving
  useEffect(() => {
    if (step !== 3) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      return;
    }
    if (selfieDataUrl) return; // photo already taken, don't restart stream
    setCameraError('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Camera not available. Please ensure you are on a secure (HTTPS) connection and your browser supports camera access.');
      return;
    }
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 640 } },
      audio: false,
    }).then(stream => {
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    }).catch(err => {
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setCameraError('Camera access denied. Please allow camera permissions and reload.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setCameraError('No camera found on this device. Please connect a camera and try again.');
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setCameraError('Camera is in use by another application. Please close it and try again.');
      } else if (name === 'OverconstrainedError') {
        // Retry without the facingMode constraint - some devices reject 'user'
        navigator.mediaDevices.getUserMedia({ video: true, audio: false })
          .then(stream => {
            streamRef.current = stream;
            if (videoRef.current) videoRef.current.srcObject = stream;
          })
          .catch(() => setCameraError('Could not start camera. Please check your device and try again.'));
      } else {
        setCameraError('Could not start camera. Please check your device settings and try again.');
      }
    });
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Auto-capture GPS as soon as 'Register New Shop' mode is selected ── */
  useEffect(() => {
    if (shopMode !== 'new') return;
    if (newShopLat != null) return; // already have a fix
    setLocError('');
    setLocCapturing(true);
    (async () => {
      try {
        const pos = await getAccuratePosition({ timeout: 7000 });
        setNewShopLat(pos.latitude);
        setNewShopLng(pos.longitude);
      } catch (e) {
        setLocError('Could not get GPS location — please enable location services.');
      } finally {
        setLocCapturing(false);
      }
    })();
  }, [shopMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // When we obtain coordinates for a new shop, fetch nearby shops (within 300 meters)
  useEffect(() => {
    if (newShopLat == null || newShopLng == null) return;
    const mountedRef = { current: true };
    setNearbyConfirmNew(false);
    // reuse shared helper which includes debug logs and dedupe
    fetchNearbyFromCoords(newShopLat, newShopLng, mountedRef);
    return () => { mountedRef.current = false; };
  }, [newShopLat, newShopLng]);

  // When in existing-shop mode, capture current GPS and suggest nearby shops (non-blocking)
  // Helper to call nearby-shops API and update state with debug logs
  const fetchNearbyFromCoords = async (lat, lng, mountedFlagRef) => {
    console.log('VisitTab: fetching nearby shops...', { lat, lng });
    setNearbyChecking(true);
    setNearbyShops([]);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token;
      if (!tok) {
        console.log('VisitTab: no auth token for nearby-shops call');
        return;
      }
      const url = `/api/sales/nearby-shops?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`;
      console.log('VisitTab: calling API', url);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
      const data = await res.json();
      console.log('VisitTab: API response:', { ok: res.ok, status: res.status, data });
      if (!res.ok) return;
      if (!mountedFlagRef.current) return;
      // Deduplicate by shop id and overwrite state (do not append)
      const unique = Array.from(new Map((data || []).map(s => [String(s.id), s])).values());
      setNearbyShops(unique);
      console.log('VisitTab: nearbyShops set, count=', unique.length);
    } catch (e) {
      console.log('VisitTab: nearby-shops fetch failed', e);
    } finally {
      setNearbyChecking(false);
    }
  };

  // GPS capture — fires once on mount, result stored in currentLat/currentLng for reuse.
  // hasFetchedOnMountRef prevents double-fire in React Strict Mode.
  useEffect(() => {
    if (hasFetchedOnMountRef.current) return;
    hasFetchedOnMountRef.current = true;
    (async () => {
      try {
        const pos = await getAccuratePosition({ timeout: 10000 });
        setCurrentLat(pos.latitude);
        setCurrentLng(pos.longitude);
      } catch (err) {
        console.log('VisitTab: GPS error on mount', err);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch nearby shops whenever GPS becomes available OR shop context changes.
  // Reuses the already-captured GPS — no additional geolocation call.
  useEffect(() => {
    if (shopMode !== 'existing') return;
    if (currentLat == null || currentLng == null) return;
    const mountedRef = { current: true };
    setNearbyWarning('');
    fetchNearbyFromCoords(currentLat, currentLng, mountedRef);
    return () => { mountedRef.current = false; };
  }, [shopMode, subregionId, currentLat, currentLng]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Auto-select an existing shop found by duplicate detection ── */
  const handleAutoSelectShop = (match) => {
    setShopMode('existing');
    setNewShopName('');
    setNewShopLoc('');
    setNewShopLat(null);
    setNewShopLng(null);
    setDupMatches([]);
    setDupDismissed(false);
    const targetSubId = String(match.subregion_id);
    if (targetSubId !== subregionId) {
      // Shop lives in a different subregion — switch to it, then apply the ID once loaded
      pendingShopIdRef.current = match.id;
      setSubregionId(targetSubId);
    } else {
      setShopId(String(match.id));
      try { validateSelectedShop(match); } catch (e) { console.log('validateSelectedShop error', e); }
    }
  };

  /* ── Debounced duplicate-shop check: requires BOTH a name (3+ chars) AND captured coords ── */
  useEffect(() => {
    if (shopMode !== 'new') { setDupMatches([]); return; }
    const name = newShopName.trim();
    // Need at least a name — coords are used when available but not mandatory
    // (legacy shops with no stored coords are matched by name-only at ≥ 85%)
    if (name.length < 3) { setDupMatches([]); return; }

    setDupDismissed(false);
    const timer = setTimeout(async () => {
      setDupChecking(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const tok = session?.access_token;
        if (!tok) return;
        const res = await fetch('/api/sales/shop-duplicate-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
          body: JSON.stringify({ name, latitude: newShopLat, longitude: newShopLng }),
        });
        const data = await res.json();
        if (res.ok) setDupMatches(data.matches || []);
      } catch { /* network error — silent */ }
      finally { setDupChecking(false); }
    }, 700);
    return () => clearTimeout(timer);
  }, [newShopName, newShopLat, newShopLng, shopMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Validate proximity immediately when a shop is selected (VisitTab)
  const validateSelectedShop = (shop) => {
    try {
      // IMPORTANT:
      // Nearby shops (within 300 meters) are ONLY suggestions.
      // ALL selections (including suggested shops) MUST pass 150m GPS validation.
      // Do NOT allow progression based on 300 meters proximity.
      setStep1Error('');
      if (!shop || shop.latitude == null || shop.longitude == null) return;
      const shopLat = Number(shop.latitude), shopLon = Number(shop.longitude);
      if (!isFinite(shopLat) || !isFinite(shopLon)) { setStep1Error('Selected shop has invalid coordinates. Please choose another shop.'); return; }
      // If we already have a captured GPS (from nearby-suggestion fetch), reuse it to avoid prompting again
      if (currentLat != null && currentLng != null) {
        const dist = haversineMeters(currentLat, currentLng, shopLat, shopLon);
        setSelectedShopDistance(dist);
        console.log('VisitTab.validateSelectedShop: reused coords -> distance (m)', dist);
        if (!isFinite(dist) || dist > 150) setStep1Error('You are too far from the selected shop. Please move closer (within 150 meters) or select another shop.');
        else setStep1Error('');
        return;
      }
      // Fallback: prompt for geolocation if we don't have a recent captured position
      console.log('VisitTab.validateSelectedShop: requesting geolocation', { shopLat, shopLon });
      (async () => {
        try {
          const pos = await getAccuratePosition({ timeout: 10000 });
          setCurrentLat(pos.latitude); setCurrentLng(pos.longitude);
          console.log('VisitTab.validateSelectedShop: got coords', pos);
          const dist = haversineMeters(pos.latitude, pos.longitude, shopLat, shopLon);
          setSelectedShopDistance(dist);
          console.log('VisitTab.validateSelectedShop: distance (m)', dist);
          if (!isFinite(dist) || dist > 150) setStep1Error('You are too far from the selected shop. Please move closer (within 150 meters) or select another shop.');
          else setStep1Error('');
        } catch (err) {
          console.log('VisitTab.validateSelectedShop: geolocation error', err);
          if (err?.code === 1) setStep1Error('Location permission denied. Allow location access to confirm your presence at the selected shop.');
          else if (err?.code === 3) setStep1Error('Location request timed out. Try again or ensure GPS is available.');
          else if (err?.code === 2) setStep1Error('Location unavailable. Ensure device GPS is working.');
          else setStep1Error('Could not get GPS location — please enable location services to confirm you are at the selected shop.');
        }
      })();
    } catch (e) { console.log('VisitTab.validateSelectedShop: unexpected', e); }
  };

  

  // Validate Step 1 and advance
  const handleStep1Continue = async () => {
    console.log('VisitTab.handleStep1Continue: start', { shopMode, shopId });
    // IMPORTANT:
    // This is the single enforcement point that MUST prevent progression
    // if the selected shop is >150m away. Nearby 300 meters suggestions are NOT sufficient.
    // Respect any existing validation error instead of clearing it here
    if (step1Error) return;
    if (!subregionId) { setStep1Error('Please select a sub-region.'); return; }
    if (shopMode === 'existing' && !shopId) { setStep1Error('Please select a shop.'); return; }
    if (shopMode === 'new' && !newShopName.trim()) { setStep1Error('Please enter the new shop name.'); return; }
    if (shopMode === 'new' && locCapturing) { setStep1Error('GPS location is still being captured — please wait a moment before continuing.'); return; }
    if (shopMode === 'new' && newShopLat == null) { setStep1Error('GPS location is required to register a new shop. Please enable location services and wait for the location to be captured.'); return; }
    // Block progress if a duplicate is detected and the user has not dismissed it.
    // They must either auto-select the existing shop or explicitly dismiss the warning.
    if (shopMode === 'new' && dupMatches.length > 0 && !dupDismissed) {
      setStep1Error('A potential duplicate shop was found nearby. Please Auto-select it, or click “Proceed anyway” if you are certain this is a different shop.');
      return;
    }
    // If the user captured a location that has nearby existing shops (within 300 meters), require explicit confirmation
    if (shopMode === 'new' && nearbyShops.length > 0 && !nearbyConfirmNew) {
      setStep1Error('Nearby shops were found close to the location you captured. Review the suggestions, or click "Proceed and register new shop anyway".');
      return;
    }
    // ── NEW: If selecting an existing shop, capture current GPS and compare to shop coords
    if (shopMode === 'existing') {
      try {
        const selected = shops.find(s => String(s.id) === String(shopId));
        // Block if the selected shop has no stored coordinates
        if (selected && (selected.latitude == null || selected.longitude == null)) {
          setStep1Error('Selected shop does not have location data. Please contact admin or select another shop.');
          return;
        }

        if (selected && selected.latitude != null && selected.longitude != null) {
          try {
            // Reuse already-captured GPS (from mount) to avoid a second geolocation prompt
            let lat, lon;
            if (currentLat != null && currentLng != null) {
              lat = currentLat; lon = currentLng;
            } else {
              const pos = await getAccuratePosition({ timeout: 10000 });
              lat = pos.latitude; lon = pos.longitude;
              setCurrentLat(lat); setCurrentLng(lon);
            }
            const shopLat = Number(selected.latitude), shopLon = Number(selected.longitude);
            console.log('VisitTab: geolocation used', { lat, lon, shopLat, shopLon });
            if (!isFinite(shopLat) || !isFinite(shopLon)) {
              setStep1Error('Selected shop has invalid coordinates. Please choose another shop.');
              return;
            }
            const dist = haversineMeters(lat, lon, shopLat, shopLon);
            console.log('VisitTab: distance (m)', dist);
            if (!isFinite(dist) || dist > 150) {
              setStep1Error('You are too far from the selected shop. Please move closer (within 150 meters) or select another shop.');
              return;
            }
            // within range — proceed as before
            if (products.length === 0 && !loadingProds) {
              setLoadingProds(true);
              setProdsError('');
              supabase.auth.getSession().then(async ({ data: { session } }) => {
                const tok = session?.access_token;
                if (!tok) { setProdsError('Session expired.'); setLoadingProds(false); return; }
                try {
                  const [prodsRes, stockRes] = await Promise.all([
                    fetch('/api/sales/products', { headers: { Authorization: `Bearer ${tok}` } }),
                    fetch('/api/sales/stock',    { headers: { Authorization: `Bearer ${tok}` } }),
                  ]);
                  const prodsData = await prodsRes.json();
                  const stockData = await stockRes.json();
                  if (!Array.isArray(prodsData)) { setProdsError(prodsData.error || 'Could not load products.'); setLoadingProds(false); return; }
                  setProducts(prodsData);
                  const balMap = {};
                  if (Array.isArray(stockData)) stockData.forEach(s => { balMap[String(s.product_id)] = s.quantity ?? 0; });
                  setStockBalances(balMap);
                  const initQty = {}, initPos = {}, initUnit = {};
                  prodsData.forEach(p => { initQty[String(p.id)] = 0; initPos[String(p.id)] = 0; initUnit[String(p.id)] = 'cartons'; });
                  setSoldQty(initQty); setStockPos(initPos); setStockUnit(initUnit);
                } catch { setProdsError('Network error loading products.'); }
                finally { setLoadingProds(false); }
              });
            }
            setStep(2);
          } catch (err) {
            setStep1Error('Could not get GPS location — please enable location services to confirm you are at the selected shop.');
          }
          return; // wait for async geolocation
        }
        // If shop has no stored coords, we have already blocked above
      } catch (e) {
        // fall through to normal flow on unexpected errors
      }
    }

    // Fetch products + stock balances when entering Step 2
    if (products.length === 0 && !loadingProds) {
      setLoadingProds(true);
      setProdsError('');
      supabase.auth.getSession().then(async ({ data: { session } }) => {
        const tok = session?.access_token;
        if (!tok) { setProdsError('Session expired.'); setLoadingProds(false); return; }
        try {
          const [prodsRes, stockRes] = await Promise.all([
            fetch('/api/sales/products', { headers: { Authorization: `Bearer ${tok}` } }),
            fetch('/api/sales/stock',    { headers: { Authorization: `Bearer ${tok}` } }),
          ]);
          const prodsData = await prodsRes.json();
          const stockData = await stockRes.json();
          if (!Array.isArray(prodsData)) { setProdsError(prodsData.error || 'Could not load products.'); setLoadingProds(false); return; }
          setProducts(prodsData);
          // Build balance map
          const balMap = {};
          if (Array.isArray(stockData)) stockData.forEach(s => { balMap[String(s.product_id)] = s.quantity ?? 0; });
          setStockBalances(balMap);
          // Initialise per-SKU quantities to 0
          const initQty = {}, initPos = {}, initUnit = {};
          prodsData.forEach(p => { initQty[String(p.id)] = 0; initPos[String(p.id)] = 0; initUnit[String(p.id)] = 'cartons'; });
          setSoldQty(initQty);
          setStockPos(initPos);
          setStockUnit(initUnit);
        } catch { setProdsError('Network error loading products.'); }
        finally { setLoadingProds(false); }
      });
    }
    setStep(2);
  };
  // UpliftTab validator is implemented inside components/UpliftTab.js

  const adjustSoldQty = (id, delta) =>
    setSoldQty(prev => {
      const bal = stockBalances[String(id)] ?? 0;
      return { ...prev, [String(id)]: Math.min(bal, Math.max(0, (prev[String(id)] || 0) + delta)) };
    });
  const updateSoldQty = (id, val) =>
    setSoldQty(prev => {
      const bal = stockBalances[String(id)] ?? 0;
      return { ...prev, [String(id)]: Math.min(bal, clamp0(val)) };
    });

  const adjustStockPos = (id, delta) =>
    setStockPos(prev => ({ ...prev, [String(id)]: Math.max(0, (prev[String(id)] || 0) + delta) }));
  const updateStockPos = (id, val) =>
    setStockPos(prev => ({ ...prev, [String(id)]: clamp0(val) }));
  const toggleStockUnit = (id) =>
    setStockUnit(prev => ({ ...prev, [String(id)]: prev[String(id)] === 'pcs' ? 'cartons' : 'pcs' }));

  // Validate Step 2 before advancing
  const handleStep2Continue = () => {
    setStep2Error('');
    if (!visitSold) { setStep2Error('Please select whether items were sold or not.'); return; }
    if (visitSold === 'yes') {
      // Check at least one SKU sold
      const totalSold = products.reduce((s, p) => s + (soldQty[String(p.id)] || 0), 0);
      if (totalSold === 0) { setStep2Error('Enter the number of cartons sold for at least one SKU.'); return; }
      // Check no sold qty exceeds balance
      for (const p of products) {
        const k       = String(p.id);
        const selling = soldQty[k] || 0;
        const bal     = stockBalances[k] ?? 0;
        if (selling > 0 && bal === 0) { setStep2Error(`Cannot sell ${p.name} — your stock balance is 0. Submit an uplift first.`); return; }
        if (selling > bal) { setStep2Error(`Cannot sell ${selling} cartons of ${p.name} — only ${bal} available.`); return; }
      }
    }
    if (visitSold === 'no') {
      if (!visitReason) { setStep2Error('Please select a reason why nothing was sold.'); return; }
      if (isOtherReason(visitReason) && !visitOtherText.trim()) { setStep2Error('Please describe the reason under "Other".'); return; }
    }
    setStep(3);
  };

  const captureSelfie = () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width  = video.videoWidth  || 480;
    canvas.height = video.videoHeight || 640;
    canvas.getContext('2d').drawImage(video, 0, 0);

    // Apply configured compression quality (or high quality if compression is disabled)
    const { compressionEnabled, compressionQuality } = storageSettings.selfie || {};
    const quality = compressionEnabled !== false
      ? Math.max(0.1, Math.min(1, (compressionQuality ?? 70) / 100))
      : 0.92; // high quality when compression is disabled
    setSelfieDataUrl(canvas.toDataURL('image/jpeg', quality));

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  };

  const retakeSelfie = () => {
    setSelfieDataUrl(null);
    setSubmitError('');
    setCameraError('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Camera not available. Please ensure you are on a secure (HTTPS) connection and your browser supports camera access.');
      return;
    }
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 640 } },
      audio: false,
    }).then(stream => {
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    }).catch(err => {
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setCameraError('Camera access denied. Please allow camera permissions and reload.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setCameraError('No camera found on this device. Please connect a camera and try again.');
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setCameraError('Camera is in use by another application. Please close it and try again.');
      } else if (name === 'OverconstrainedError') {
        // Retry without the facingMode constraint - some devices reject 'user'
        navigator.mediaDevices.getUserMedia({ video: true, audio: false })
          .then(stream => {
            streamRef.current = stream;
            if (videoRef.current) videoRef.current.srcObject = stream;
          })
          .catch(() => setCameraError('Could not start camera. Please check your device and try again.'));
      } else {
        setCameraError('Could not start camera. Please check your device settings and try again.');
      }
    });
  };

  // Chosen shop label (for summary display in later steps)
  const shopLabel = shopMode === 'existing'
    ? shops.find(s => String(s.id) === shopId)?.name || ''
    : newShopName.trim();
  const subregionLabel = subregions.find(s => String(s.id) === subregionId)?.name || '';

  // Submit the visit
  const handleSubmit = async () => {
    setSubmitError('');
    setSubmitting(true);
    try {
      // 1. Get GPS coordinates — reuse cached position if available, fallback to fresh fetch
      let latitude = null, longitude = null;
      if (currentLat != null && currentLng != null) {
        latitude = currentLat; longitude = currentLng;
      } else {
        try {
          const pos = await getAccuratePosition({ timeout: 10000 });
          latitude  = pos.latitude;
          longitude = pos.longitude;
        } catch { /* GPS not available — submit anyway */ }
      }

      // 2. Get auth token
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token;
      if (!tok) { setSubmitError('Session expired. Please sign in again.'); setSubmitting(false); return; }

      // 3. If new shop, register it first and get back its id
      let resolvedShopId = shopMode === 'existing' ? Number(shopId) : null;
      if (shopMode === 'new') {
        const shopRes = await fetch('/api/sales/shops', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
          body: JSON.stringify({
            name:         newShopName.trim(),
            location:     newShopLoc.trim() || null,
            subregion_id: Number(subregionId),
            latitude:     newShopLat,
            longitude:    newShopLng,
          }),
        });
        const shopData = await shopRes.json();
        if (!shopRes.ok) {
          // 409 means the backend caught a duplicate — surface a specific message
          const msg = shopRes.status === 409
            ? `Duplicate shop blocked: ${shopData.error}`
            : shopData.error || 'Failed to register shop.';
          setSubmitError(msg);
          setSubmitting(false);
          return;
        }
        resolvedShopId = shopData.id;
        // Invalidate cached shop list so the new shop appears on next subregion load
        _visitShopsCache.delete(String(subregionId));
      }

      // 4. POST visit to API
      const body = {
        shop_id:           resolvedShopId,
        subregion_id:      Number(subregionId),
        region_id:         region?.id,
        latitude,
        longitude,
        selfie_base64:     selfieDataUrl,
        visit_sold:        visitSold,
        visit_reason:      visitSold === 'no' ? visitReason    : null,
        visit_other_reason: visitSold === 'no' && isOtherReason(visitReason) ? visitOtherText : null,
        sold_qty:          visitSold === 'yes' ? soldQty       : {},
        stock_pos:         stockPos,
        stock_pos_unit:    stockUnit,
        products,
        // Competitor presence (client-only field)
        competitor_presence: (() => {
          if (competitorSelected.length === 0) return null;
          const arr = competitorSelected.filter(x => x !== 'other').concat(
            competitorSelected.includes('other') && competitorOther.trim() ? [competitorOther.trim()] : []
          );
          return arr.length > 0 ? arr : null;
        })(),
      };

      const res  = await fetch('/api/sales/visits', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body:    JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setSubmitError(data.error || 'Submission failed. Please try again.'); setSubmitting(false); return; }

      setSubmitDone(true);
      // Invalidate stock cache — sold cartons reduce balance, StockTab must show fresh data
      _stockCache.ts = 0;
      // Invalidate dashboard cache so stats reflect the new visit
      _dashCache.statsTs = 0;
    } catch (e) {
      setSubmitError('Network error. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>New Sales Visit</h1>
        <p className={styles.pageSubtitle}>Log a shop visit and record stock positions.</p>
      </div>

      {/* Step progress */}
      <div className={styles.card}>
        <div className={styles.cardBody} style={{ paddingBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            {['Select Shop', 'Stock / Sales', 'Submit'].map((s, i) => (
              <span key={i} style={{
                fontSize: '0.72rem', fontWeight: 600,
                color: step > i ? primary : step === i + 1 ? primary : '#94a3b8',
              }}>{i + 1}. {s}</span>
            ))}
          </div>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${((step - 1) / 2) * 100}%` }} />
          </div>
        </div>
      </div>

      {/* Step 1 — Sub-region & Shop */}
      {step === 1 && (
        <div className={styles.card}>
          <div className={styles.cardHeader}><span className={styles.cardTitle}>Step 1 — Select Sub-region & Shop</span></div>
          <div className={styles.cardBody}>

            {/* Assigned region — read-only display */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Your Assigned Region</label>
              {loadingMeta ? (
                <div style={{ color: '#94a3b8', fontSize: '0.85rem', padding: '8px 0' }}>Loading…</div>
              ) : metaError ? (
                <div className={styles.alertDanger}>{metaError}</div>
              ) : (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: '#f8fafc', border: '1.5px solid #e2e8f0',
                  borderRadius: 9, padding: '10px 14px',
                }}>
                  <span style={{ fontSize: '1rem' }}>📍</span>
                  <span style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.95rem' }}>{region?.name}</span>
                  <span style={{
                    marginLeft: 'auto', fontSize: '0.68rem', fontWeight: 700,
                    background: `linear-gradient(90deg, var(--sa-primary, #7c3aed), var(--sa-accent, #06b6d4))`,
                    color: '#fff', padding: '2px 10px', borderRadius: 20,
                  }}>Assigned</span>
                </div>
              )}
            </div>

            {/* Sub-region dropdown — populated automatically from their region */}
            {!loadingMeta && !metaError && (
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Sub-region <span style={{ color: '#ef4444' }}>*</span></label>
                {subregions.length === 0 ? (
                  <div className={styles.alertWarning}>
                    No sub-regions found for <strong>{region?.name}</strong>. Contact your administrator.
                  </div>
                ) : (
                  <select
                    className={styles.formControl}
                    value={subregionId}
                    onChange={e => setSubregionId(e.target.value)}
                  >
                    <option value="">— Select sub-region —</option>
                    {subregions.map(s => (
                      <option key={s.id} value={String(s.id)}>{s.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Shop section — only visible once sub-region is chosen */}
            {subregionId && (
              <>
                <hr className={styles.divider} />
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Shop <span style={{ color: '#ef4444' }}>*</span></label>
                  <div className={styles.pillTabs} style={{ marginBottom: 12 }}>
                    <button
                      className={`${styles.pillTab} ${shopMode === 'existing' ? styles.pillTabActive : ''}`}
                      onClick={() => setShopMode('existing')}
                    >Existing Shop</button>
                    <button
                      className={`${styles.pillTab} ${shopMode === 'new' ? styles.pillTabActive : ''}`}
                      onClick={() => setShopMode('new')}
                    >Register New Shop</button>
                  </div>

                  {shopMode === 'existing' && (
                    loadingShops ? (
                      <div style={{ padding: '4px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                          <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2.5px solid #bae6fd', borderTopColor: '#0284c7', animation: 'sprintSpin 0.7s linear infinite', flexShrink: 0 }} />
                          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0369a1' }}>Loading shops…</span>
                        </div>
                        {[1,2,3].map(i => (
                          <div key={i} style={{ height: 40, borderRadius: 9, marginBottom: 8, background: 'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%)', backgroundSize: '200% 100%', animation: `sprintSkeleton 1.5s ease-in-out infinite`, animationDelay: `${i * 0.12}s` }} />
                        ))}
                      </div>
                    ) : (() => {
                      const selected = shops.find(s => String(s.id) === shopId);
                      return (
                        <div style={{ position: 'relative' }}>
                          {/* Selected shop chip */}
                          {selected && (
                            <div style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              background: '#f0fdf4', border: '1.5px solid #bbf7d0',
                              borderRadius: 9, padding: '10px 14px', marginBottom: 4,
                            }}>
                              <div>
                                <span style={{ fontWeight: 700, color: '#065f46', fontSize: '0.9rem' }}>{selected.name}</span>
                                {selectedShopDistance != null && (
                                  <span style={{ marginLeft: 10, fontSize: '0.72rem', fontWeight: 700, color: selectedShopDistance <= 150 ? '#065f46' : '#b45309' }}>
                                    {selectedShopDistance <= 150 ? '✅' : '⚠️'} {Math.round(selectedShopDistance)}m
                                  </span>
                                )}
                                {selected.location && <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: 8 }}>{selected.location}</span>}
                              </div>
                              <button
                                onClick={() => setShopId('')}
                                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1rem' }}
                              >✕</button>
                            </div>
                          )}
                          {/* Nearby suggestions for existing mode (non-blocking) */}
                          {shopMode === 'existing' && nearbyChecking && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, background: 'linear-gradient(135deg, #f0f9ff, #e0f2fe)', border: '1px solid #bae6fd', marginTop: 8, marginBottom: 4 }}>
                              <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2.5px solid #bae6fd', borderTopColor: '#0284c7', animation: 'sprintSpin 0.7s linear infinite', flexShrink: 0 }} />
                              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0369a1' }}>Finding shops near you…</span>
                            </div>
                          )}
                          {nearbyWarning && (
                            <div className={styles.alertWarning} style={{ marginTop: 8 }}>{nearbyWarning}</div>
                          )}
                          {/* Nearby suggestions for existing mode (non-blocking) */}
                          {shopMode === 'existing' && !nearbyChecking && nearbyShops.length > 0 && (
                            <div style={{ marginTop: 12, background: '#f8fafc', border: '1px solid #e6e6fa', padding: 12, borderRadius: 10 }}>
                              <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Nearby Shops (within 300 meters)</div>
                              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
                                  {nearbyShops.map(ns => {
                                    const isSel = String(ns.id) === String(shopId);
                                    return (
                                    <div key={ns.id} style={{ minWidth: 200, border: isSel ? '1.5px solid #bbf7d0' : '1px solid #eef2ff', borderRadius: 8, padding: 10, background: isSel ? '#f0fdf4' : '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                      <div>
                                        <div style={{ fontWeight: 700, color: '#111827' }}>{ns.name}</div>
                                        <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 6 }}>{ns.location || ns.subregion_name || ''} · {ns.distance_m != null ? (ns.distance_m < 1000 ? `${ns.distance_m} m` : `${(ns.distance_m/1000).toFixed(1)} km`) : 'location unknown'}</div>
                                      </div>
                                      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                                        <button className={`${styles.btn} ${isSel ? styles.btnPrimary : styles.btnOutline}`} style={{ flex: 1, fontSize: '0.78rem', padding: '6px 10px' }} onClick={() => {
                                          setShopId(String(ns.id)); setShopSearch(''); setNearbyWarning('');
                                          validateSelectedShop(ns);
                                        }} disabled={isSel}>
                                          {isSel ? 'Selected' : 'Select'}
                                        </button>
                                      </div>
                                    </div>)
                                  })}
                                </div>
                            </div>
                          )}
                          {shopMode === 'existing' && !nearbyChecking && nearbyShops.length === 0 && !selected && (
                            <div style={{ padding: '16px', color: '#94a3b8', fontSize: '0.85rem', textAlign: 'center', border: '1.5px dashed #e2e8f0', borderRadius: 10 }}>
                              📍 Move closer to a shop — nearby suggestions will appear here
                            </div>
                          )}
                        </div>
                      );
                    })()
                  )}

                  {shopMode === 'new' && (
                    <>
                      {/* ── Duplicate-shop warning banner ── */}
                      {!dupDismissed && dupMatches.length > 0 && (
                        <div style={{
                          background: dupMatches[0].match_type === 'strong' ? '#fef3c7' : '#fff7ed',
                          border: `1.5px solid ${dupMatches[0].match_type === 'strong' ? '#dc2626' : '#fb923c'}`,
                          borderRadius: 12, padding: '14px 16px', marginBottom: 14,
                        }}>
                          <div style={{ fontWeight: 700, color: '#92400e', fontSize: '0.85rem', marginBottom: 6 }}>
                            ⚠️ Possible Duplicate Shop{dupMatches.length > 1 ? 's' : ''} Detected
                          </div>
                          <div style={{ fontSize: '0.77rem', color: '#78350f', marginBottom: 12 }}>
                            {dupMatches[0].match_type === 'strong'
                              ? `A shop within ${dupMatches[0].distance_m} m with a similar name is already registered. Checked: distance first (≤ 150 m ✓), then name (≥ 60% ✓). Auto-select it, or confirm this is genuinely different.`
                              : 'A shop with the same or very similar name already exists. Location could not be verified (no GPS on record). Checked: name only (≥ 85% ✓). Auto-select it, or confirm this is a different shop.'}
                          </div>
                          {dupMatches.map(m => (
                            <div key={m.id} style={{
                              background: '#fff', border: '1px solid #fde68a',
                              borderRadius: 9, padding: '10px 12px', marginBottom: 8,
                            }}>
                              <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.88rem', marginBottom: 4 }}>{m.name}</div>
                              <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: 10 }}>
                                {[
                                  m.subregion_name ? `📍 ${m.subregion_name}` : null,
                                  m.location       ? m.location               : null,
                                  m.distance_m != null
                                    ? m.distance_m < 1000
                                      ? `${m.distance_m} m away`
                                      : `${(m.distance_m / 1000).toFixed(1)} km away`
                                    : '🚧 location unverified (no GPS on record)',
                                  m.name_similarity > 0 ? `${m.name_similarity}% name match` : null,
                                ].filter(Boolean).join(' · ')}
                              </div>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                  className={`${styles.btn} ${styles.btnPrimary}`}
                                  style={{ flex: 1, fontSize: '0.78rem', padding: '7px 12px' }}
                                  onClick={() => handleAutoSelectShop(m)}
                                >✓ Auto-select this shop</button>
                              </div>
                            </div>
                          ))}
                          {/* Explicit opt-out — user consciously overrides the warning */}
                          <button
                            style={{
                              width: '100%', marginTop: 4,
                              background: 'none', border: '1.5px solid #d97706',
                              borderRadius: 9, padding: '8px 14px',
                              fontSize: '0.77rem', fontWeight: 600, color: '#92400e',
                              cursor: 'pointer',
                            }}
                            onClick={() => setDupDismissed(true)}
                          >Proceed anyway — this is a different shop</button>
                        </div>
                      )}

                      <div className={styles.formGroup}>
                        <label className={styles.formLabel}>Shop Name <span style={{ color: '#ef4444' }}>*</span></label>
                        <div style={{ position: 'relative' }}>
                          <input
                            className={styles.formControl}
                            placeholder="e.g. Mama Mboga Store"
                            value={newShopName}
                            onChange={e => { setNewShopName(e.target.value); setDupDismissed(false); }}
                          />
                          {dupChecking && (
                            <span style={{
                              position: 'absolute', right: 12, top: '50%',
                              transform: 'translateY(-50%)',
                              fontSize: '0.68rem', color: '#94a3b8',
                            }}>Checking…</span>
                          )}
                        </div>
                      </div>

                      <div className={styles.formGroup}>
                        <label className={styles.formLabel}>Location / Landmark</label>
                        <input
                          className={styles.formControl}
                          placeholder="E.g Guraya/VOK/Old town"
                          maxLength={30}
                          value={newShopLoc}
                          onChange={e => setNewShopLoc(e.target.value)}
                        />
                      </div>

                      {/* GPS status — auto-captured; required for new shop registration */}
                      <div style={{ marginTop: 8 }}>
                        {locCapturing && (
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
                            border: '1.5px solid #93c5fd',
                            borderRadius: 12, padding: '12px 16px',
                          }}>
                            <div style={{
                              width: 28, height: 28, flexShrink: 0,
                              borderRadius: '50%',
                              border: '3px solid #bfdbfe',
                              borderTopColor: '#2563eb',
                              animation: 'sprintSpin 0.8s linear infinite',
                            }} />
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1d4ed8', marginBottom: 2 }}>
                                📡 Capturing GPS Location…
                              </div>
                              <div style={{ fontSize: '0.72rem', color: '#3b82f6' }}>
                                Please stay still. The Continue button will unlock once location is confirmed.
                              </div>
                            </div>
                          </div>
                        )}
                        {!locCapturing && newShopLat != null && (
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
                            border: '1.5px solid #86efac',
                            borderRadius: 12, padding: '12px 16px',
                          }}>
                            <div style={{
                              width: 28, height: 28, flexShrink: 0,
                              borderRadius: '50%',
                              background: '#16a34a',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 14,
                            }}>📍</div>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#15803d', marginBottom: 2 }}>
                                Location Captured
                              </div>
                              <div style={{ fontSize: '0.72rem', color: '#16a34a' }}>
                                GPS coordinates locked. You may proceed.
                              </div>
                            </div>
                          </div>
                        )}
                        {!locCapturing && newShopLat == null && locError && (
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            background: '#fef2f2', border: '1.5px solid #fca5a5',
                            borderRadius: 12, padding: '12px 16px',
                          }}>
                            <div style={{ fontSize: 20, flexShrink: 0 }}>📍</div>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#dc2626', marginBottom: 2 }}>
                                Location Required
                              </div>
                              <div style={{ fontSize: '0.72rem', color: '#ef4444' }}>{locError}</div>
                            </div>
                          </div>
                        )}
                        {/* Nearby suggestions for new-shop (require confirmation before registering) */}
                        {!locCapturing && !nearbyChecking && nearbyShops.length > 0 && (
                          <div style={{ marginTop: 12, border: '1.5px solid #fed7aa', borderRadius: 12, overflow: 'hidden' }}>
                            {!nearbyConfirmNew ? (
                              <>
                                <div style={{ background: '#fff7ed', padding: '12px 14px', borderBottom: '1px solid #fed7aa' }}>
                                  <div style={{ fontWeight: 800, color: '#c2410c', fontSize: '0.88rem', marginBottom: 2 }}>📍 Nearby shops detected at this location</div>
                                  <div style={{ fontSize: '0.78rem', color: '#92400e' }}>A shop near this spot may already be registered. Select one to use it, or register a new shop.</div>
                                </div>
                                <div style={{ background: '#fff', padding: '12px 14px' }}>
                                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Option A — Use a nearby shop</div>
                                  <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
                                    {nearbyShops.map(ns => (
                                      <div key={ns.id} style={{ minWidth: 190, border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                                        <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.88rem' }}>{ns.name}</div>
                                        <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{ns.location || ns.subregion_name || ''}{ns.distance_m != null ? ` · ${ns.distance_m < 1000 ? `${ns.distance_m}m` : `${(ns.distance_m / 1000).toFixed(1)}km`}` : ''}</div>
                                        <button className={`${styles.btn} ${styles.btnPrimary}`} style={{ fontSize: '0.78rem', padding: '6px 10px', marginTop: 4 }} onClick={() => handleAutoSelectShop(ns)}>✓ Use this shop</button>
                                      </div>
                                    ))}
                                  </div>
                                  <div style={{ marginTop: 6, fontSize: '0.72rem', color: '#94a3b8' }}>After selecting, tap <strong>Continue →</strong> below to proceed.</div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: '#fff' }}>
                                  <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
                                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em' }}>OR</span>
                                  <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
                                </div>
                                <div style={{ background: '#fff', padding: '8px 14px 14px' }}>
                                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Option B — None of these match</div>
                                  <button
                                    style={{ width: '100%', background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)', border: 'none', borderRadius: 9, padding: '10px 14px', fontSize: '0.85rem', fontWeight: 700, color: '#fff', cursor: 'pointer', boxShadow: '0 2px 8px rgba(249,115,22,0.3)' }}
                                    onClick={() => { setNearbyConfirmNew(true); setStep1Error(''); }}
                                  >Register New Shop Anyway →</button>
                                </div>
                              </>
                            ) : (
                              <div style={{ background: '#f0fdf4', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ fontSize: '1.1rem' }}>✅</span>
                                <div>
                                  <div style={{ fontWeight: 700, color: '#166534', fontSize: '0.88rem' }}>Proceeding to register a new shop</div>
                                  <div style={{ fontSize: '0.75rem', color: '#15803d', marginTop: 2 }}>Click <strong>Continue →</strong> below to complete registration.</div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {nearbyChecking && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, background: 'linear-gradient(135deg, #f0f9ff, #e0f2fe)', border: '1px solid #bae6fd', marginTop: 8, marginBottom: 4 }}>
                            <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2.5px solid #bae6fd', borderTopColor: '#0284c7', animation: 'sprintSpin 0.7s linear infinite', flexShrink: 0 }} />
                            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0369a1' }}>Checking for nearby shops…</span>
                          </div>
                        )}
                        
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            {step1Error && (
              <div className={styles.alertDanger} style={{ marginBottom: 12 }}>{step1Error}</div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button
                className={`${styles.btn} ${styles.btnOutline}`}
                onClick={() => onNavigate('dashboard')}
              >← Home</button>
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                style={{ flex: 1 }}
                onClick={handleStep1Continue}
                disabled={loadingMeta || !!metaError || !!step1Error || (shopMode === 'new' && (locCapturing || newShopLat == null))}
              >
                {shopMode === 'new' && locCapturing ? '📡 Getting Location…' : shopMode === 'new' && newShopLat == null ? '📍 Location Required' : 'Continue →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2 — Stock Positions & Sales */}
      {step === 2 && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>Step 2 — Stock Positions & Sales</span>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
              {subregionLabel} › {shopLabel}
            </span>
          </div>
          <div className={styles.cardBody}>

            {loadingProds && (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8' }}>Loading products…</div>
            )}
            {prodsError && (
              <div className={styles.alertDanger} style={{ marginBottom: 16 }}>{prodsError}</div>
            )}
            {!loadingProds && !prodsError && products.length === 0 && (
              <div className={styles.alertWarning}>No active products found. Contact your administrator to add SKUs.</div>
            )}

            {/* ── SOLD? — single question for the whole visit ── */}
            {!loadingProds && products.length > 0 && (
              <>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#374151', marginBottom: 10 }}>
                    Were items sold at this shop? <span style={{ color: '#ef4444' }}>*</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <button
                      onClick={() => setVisitSold('yes')}
                      style={{
                        flex: 1, padding: '12px', borderRadius: 10, border: '2px solid',
                        borderColor: visitSold === 'yes' ? '#059669' : '#e2e8f0',
                        background:  visitSold === 'yes' ? '#d1fae5' : '#f8fafc',
                        color:       visitSold === 'yes' ? '#065f46' : '#64748b',
                        fontWeight: 700, fontSize: '1rem', cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >✓ Yes — Sold</button>
                    <button
                      onClick={() => setVisitSold('no')}
                      style={{
                        flex: 1, padding: '12px', borderRadius: 10, border: '2px solid',
                        borderColor: visitSold === 'no' ? '#dc2626' : '#e2e8f0',
                        background:  visitSold === 'no' ? '#fee2e2' : '#f8fafc',
                        color:       visitSold === 'no' ? '#991b1b' : '#64748b',
                        fontWeight: 700, fontSize: '1rem', cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >✗ No — Not Sold</button>
                  </div>
                </div>

                {/* ── IF YES → cartons per SKU ── */}
                {visitSold === 'yes' && (
                  <div style={{
                    background: '#f0fdf4', border: '1.5px solid #bbf7d0',
                    borderRadius: 12, padding: '16px',
                    marginBottom: 16,
                  }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#065f46', marginBottom: 14 }}>
                      Enter cartons sold per SKU
                    </div>
                    {products.map((p, idx) => {
                      const k      = String(p.id);
                      const bal    = stockBalances[k] ?? 0;
                      const isLast = idx === products.length - 1;
                      const atMax  = (soldQty[k] || 0) >= bal;
                      return (
                        <div key={p.id} style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          gap: 12, flexWrap: 'wrap',
                          borderBottom: isLast ? 'none' : '1px solid #d1fae5',
                          paddingBottom: isLast ? 0 : 12,
                          marginBottom:  isLast ? 0 : 12,
                          opacity: bal === 0 ? 0.5 : 1,
                        }}>
                          <div style={{ flex: 1 }}>
                            <span style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.9rem' }}>{p.name}</span>
                            <span style={{
                              marginLeft: 8, fontSize: '0.68rem', fontWeight: 700,
                              background: '#bbf7d0', color: '#065f46',
                              padding: '1px 7px', borderRadius: 5,
                            }}>{p.sku}</span>
                            <div style={{ fontSize: '0.7rem', marginTop: 3, color: bal === 0 ? '#ef4444' : '#64748b' }}>
                              {bal === 0 ? '⚠️ No stock — request uplift' : `Available: ${bal} ctn`}
                            </div>
                          </div>
                          <div className={styles.qtyControl}>
                            <button className={styles.qtyBtn} onClick={() => adjustSoldQty(p.id, -1)} disabled={bal === 0}>−</button>
                            <input
                              className={styles.qtyInput}
                              value={soldQty[k] ?? 0}
                              onChange={e => updateSoldQty(p.id, e.target.value)}
                              disabled={bal === 0}
                            />
                            <button className={styles.qtyBtn} onClick={() => adjustSoldQty(p.id, 1)} disabled={bal === 0 || atMax}>+</button>
                          </div>
                          <span style={{ fontSize: '0.75rem', color: '#059669', minWidth: 48, textAlign: 'right' }}>cartons</span>
                        </div>
                      );
                    })}
                    <div style={{ fontSize: '0.72rem', color: '#059669', marginTop: 12 }}>
                      Sold quantity is capped to your available stock balance per SKU.
                    </div>
                  </div>
                )}

                {/* ── IF NO → single reason selector ── */}
                {visitSold === 'no' && (
                  <div style={{
                    background: '#fef2f2', border: '1.5px solid #fecaca',
                    borderRadius: 12, padding: '16px',
                    marginBottom: 16,
                  }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#991b1b', marginBottom: 12 }}>
                      Reason Not Sold <span style={{ color: '#ef4444' }}>*</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {noSaleReasons.map(r => (
                        <label key={r.label} style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          cursor: 'pointer', fontSize: '0.9rem', color: '#374151',
                          background: visitReason === r.label ? '#fee2e2' : '#fff',
                          border: '1.5px solid',
                          borderColor: visitReason === r.label ? '#fca5a5' : '#e2e8f0',
                          borderRadius: 9, padding: '10px 14px',
                          transition: 'all 0.15s',
                        }}>
                          <input
                            type="radio"
                            name="visit-reason"
                            value={r.label}
                            checked={visitReason === r.label}
                            onChange={() => { setVisitReason(r.label); setVisitOtherText(''); }}
                            style={{ accentColor: '#dc2626', width: 16, height: 16, flexShrink: 0 }}
                          />
                          <span style={{ fontWeight: visitReason === r.label ? 700 : 400 }}>{r.label}</span>
                        </label>
                      ))}
                    </div>
                    {isOtherReason(visitReason) && (
                      <textarea
                        className={styles.formControl}
                        style={{ marginTop: 12, background: '#fff' }}
                        rows={2}
                        placeholder="Describe the reason…"
                        value={visitOtherText}
                        onChange={e => setVisitOtherText(e.target.value)}
                      />
                    )}
                  </div>
                )}

                {/* ── SHOP'S CURRENT STOCK BALANCE — shown after sold/not-sold selection ── */}
                <div style={{
                  background: '#fafafa', border: '2px solid #e2e8f0',
                  borderRadius: 12, padding: '16px', marginBottom: 4,
                }}>
                  {/* Header */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#1e293b', marginBottom: 3 }}>
                      📦 Shop’s Current Stock Balance
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', lineHeight: 1.5 }}>
                      How many units of each SKU are <strong>still at this shop</strong> right now
                      {visitSold === 'yes' && ' (after today’s sale)'}?
                      Select <strong>Cartons</strong> or <strong>Pcs</strong> per SKU.
                    </div>
                  </div>

                  {products.map((p, idx) => {
                    const k    = String(p.id);
                    const unit = stockUnit[k] || 'cartons';
                    const isLast = idx === products.length - 1;
                    return (
                      <div key={p.id} style={{
                        borderBottom: isLast ? 'none' : '1px solid #e9eef5',
                        paddingBottom: isLast ? 0 : 14,
                        marginBottom:  isLast ? 0 : 14,
                      }}>
                        {/* SKU label row */}
                        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>

                          <span style={{ fontWeight: 700, color: p.is_active ? '#1e293b' : '#b91c1c', fontSize: '0.9rem' }}>{p.name}</span>
                          <span style={{
                            fontSize: '0.68rem', fontWeight: 700,
                            background: p.is_active ? '#e2e8f0' : '#fee2e2',
                            color:      p.is_active ? '#475569' : '#b91c1c',
                            padding: '1px 7px', borderRadius: 5,
                          }}>{p.sku}</span>
                          {!p.is_active && (
                            <span style={{
                              marginLeft: 8,
                              fontSize: '0.68rem', fontWeight: 700,
                              background: '#fee2e2', color: '#b91c1c',
                              padding: '1px 7px', borderRadius: 5,
                            }}>INACTIVE</span>
                          )}

                          {/* Unit toggle pill */}
                          <div style={{
                            marginLeft: 'auto',
                            display: 'flex', borderRadius: 8, overflow: 'hidden',
                            border: '1.5px solid #e2e8f0',
                          }}>
                            {['cartons', 'pcs'].map(u => (
                              <button
                                key={u}
                                onClick={() => toggleStockUnit(p.id)}
                                style={{
                                  padding: '4px 10px', border: 'none', cursor: 'pointer',
                                  fontSize: '0.72rem', fontWeight: 700,
                                  background: unit === u ? 'var(--sa-primary, #7c3aed)' : '#f8fafc',
                                  color:      unit === u ? '#fff' : '#64748b',
                                  transition: 'all 0.15s',
                                }}
                              >{u === 'cartons' ? 'Cartons' : 'Pcs'}</button>
                            ))}
                          </div>
                        </div>

                        {/* Qty control row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div className={styles.qtyControl} style={{ flex: 1 }}>
                            <button className={styles.qtyBtn} onClick={() => adjustStockPos(p.id, -1)}>−</button>
                            <input
                              className={styles.qtyInput}
                              style={{ flex: 1 }}
                              value={stockPos[k] ?? 0}
                              onChange={e => updateStockPos(p.id, e.target.value)}
                            />
                            <button className={styles.qtyBtn} onClick={() => adjustStockPos(p.id, 1)}>+</button>
                          </div>
                          <span style={{
                            fontSize: '0.8rem', fontWeight: 600,
                            color: unit === 'cartons' ? '#7c3aed' : '#0891b2',
                            minWidth: 52,
                          }}>{unit === 'cartons' ? 'cartons' : 'pcs'}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* ── Competitor Presence — multi-select ── */}
            <div style={{
              background: '#f8fafc', border: '1.5px solid #e0e7ff',
              borderRadius: 12, padding: '14px', marginTop: 8, marginBottom: 4,
            }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#0f172a', marginBottom: 4 }}>
                🏷️ Competitor Presence
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: 10, lineHeight: 1.5 }}>
                Select <strong>all</strong> competitor brands this shop currently stocks (tap each to toggle).
                Select <strong>None</strong> if no competitor brands are present.
              </div>
              {!competitorLoading && Array.isArray(competitorOptions) && competitorOptions.length === 0 && (
                <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: 8 }}>
                  No competitor brands configured for your region — use &ldquo;Other&rdquo; to add one manually.
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={() => { setCompetitorSelected([]); setCompetitorOther(''); }}
                  style={{
                    padding: '7px 14px', borderRadius: 10, border: '1.5px solid', cursor: 'pointer',
                    background: competitorSelected.length === 0 ? '#eef2ff' : '#f8fafc',
                    borderColor: competitorSelected.length === 0 ? '#a5b4fc' : '#dde4f0',
                    color: competitorSelected.length === 0 ? '#3730a3' : '#64748b',
                    fontWeight: 700, fontSize: '0.82rem', transition: 'all 0.15s',
                  }}
                >{competitorSelected.length === 0 ? '✓ None' : 'None'}</button>
                {[...(Array.isArray(competitorOptions) ? competitorOptions : []), 'other'].map(opt => {
                  const isOn = competitorSelected.includes(opt);
                  return (
                    <button
                      key={opt}
                      onClick={() => {
                        if (isOn) { setCompetitorSelected(prev => prev.filter(x => x !== opt)); if (opt === 'other') setCompetitorOther(''); }
                        else { setCompetitorSelected(prev => [...prev, opt]); }
                      }}
                      style={{
                        padding: '7px 14px', borderRadius: 10, border: '1.5px solid', cursor: 'pointer',
                        background: isOn ? (opt === 'other' ? '#fce7f3' : '#fef3c7') : '#f8fafc',
                        borderColor: isOn ? (opt === 'other' ? '#f472b6' : '#f59e0b') : '#dde4f0',
                        color: isOn ? (opt === 'other' ? '#9d174d' : '#92400e') : '#64748b',
                        fontWeight: isOn ? 700 : 500, fontSize: '0.82rem', transition: 'all 0.15s',
                      }}
                    >{isOn ? '✓ ' : ''}{opt === 'other' ? 'Other' : opt}</button>
                  );
                })}
              </div>
              {competitorSelected.includes('other') && (
                <input
                  className={styles.formControl}
                  placeholder="Enter competitor brand name"
                  value={competitorOther}
                  onChange={e => setCompetitorOther(e.target.value)}
                  style={{ marginTop: 10 }}
                />
              )}
              {competitorSelected.length > 0 && (
                <div style={{ marginTop: 8, fontSize: '0.72rem', color: '#059669', fontWeight: 600 }}>
                  {competitorSelected.includes('other') && !competitorOther.trim()
                    ? `${competitorSelected.filter(x => x !== 'other').length} brand(s) selected — enter name for Other above`
                    : `Selected: ${competitorSelected.filter(x => x !== 'other').concat(competitorSelected.includes('other') && competitorOther.trim() ? [competitorOther.trim()] : []).join(', ')}`
                  }
                </div>
              )}
            </div>

            {step2Error && (
              <div className={styles.alertDanger} style={{ marginBottom: 12 }}>{step2Error}</div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button className={`${styles.btn} ${styles.btnOutline}`} onClick={() => setStep(1)}>← Back</button>
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                style={{ flex: 1 }}
                onClick={handleStep2Continue}
                disabled={loadingProds || products.length === 0}
              >Continue →</button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3 — Selfie & Submit */}
      {step === 3 && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>Step 3 — Selfie & Submit</span>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
              {subregionLabel} › {shopLabel}
            </span>
          </div>
          <div className={styles.cardBody}>

            {/* Camera / selfie capture */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Selfie at Shop <span style={{ color: '#ef4444' }}>*</span></label>

              {cameraError && (
                <div className={styles.alertDanger} style={{ marginBottom: 12 }}>{cameraError}</div>
              )}

              {selfieDataUrl ? (
                /* Captured photo preview */
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <img
                    src={selfieDataUrl}
                    alt="Selfie preview"
                    style={{
                      width: '100%', maxWidth: 480,
                      aspectRatio: '3/4',
                      objectFit: 'cover',
                      borderRadius: 14,
                      border: '2px solid #bbf7d0',
                    }}
                  />
                  <button className={`${styles.btn} ${styles.btnOutline}`} onClick={retakeSelfie}>
                    ↺ Retake
                  </button>
                </div>
              ) : (
                /* Live camera feed */
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{
                      width: '100%',
                      maxWidth: 480,
                      aspectRatio: '3/4',
                      objectFit: 'cover',
                      borderRadius: 14,
                      background: '#0f172a',
                      transform: 'scaleX(-1)',
                    }}
                  />
                  <button
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    onClick={captureSelfie}
                    disabled={!!cameraError}
                  >
                    📸 Take Selfie
                  </button>
                </div>
              )}

              {/* Hidden canvas used for pixel capture */}
              <canvas ref={canvasRef} style={{ display: 'none' }} />
            </div>

            {!selfieDataUrl && !cameraError && (
              <div className={styles.alertWarning} style={{ marginBottom: 16 }}>
                Take a selfie at the shop before submitting.
              </div>
            )}

            {submitError && (
              <div className={styles.alertDanger} style={{ marginBottom: 12 }}>{submitError}</div>
            )}

            {submitDone ? (
              <div style={{ textAlign: 'center' }}>
                <div className={styles.alertSuccess} style={{ marginBottom: 20, fontWeight: 700 }}>
                  ✓ Visit submitted successfully!
                </div>
                <button
                  className={`${styles.btn} ${styles.btnPrimary} ${styles.btnFull}`}
                  onClick={() => {
                    // Reset entire visit flow back to step 1
                    setStep(1);
                    setSubregionId(''); setShopId(''); setShopSearch('');
                    setShopMode('existing'); setNewShopName(''); setNewShopLoc('');
                    setNewShopLat(null); setNewShopLng(null); setLocCapturing(false); setLocError('');
                    setDupMatches([]); setDupChecking(false); setDupDismissed(false);
                    setProducts([]); setSoldQty({}); setStockPos({}); setStockUnit({});
                    setVisitSold(''); setVisitReason(''); setVisitOtherText('');
                    setSelfieDataUrl(null); setCameraError('');
                    setSubmitDone(false); setSubmitError('');
                  }}
                >
                  ← Start New Visit
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className={`${styles.btn} ${styles.btnOutline}`}
                  onClick={() => setStep(2)}
                  disabled={submitting}
                >← Back</button>
                <button
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  style={{ flex: 1 }}
                  onClick={handleSubmit}
                  disabled={!selfieDataUrl || submitting}
                >
                  {submitting ? 'Submitting…' : 'Submit Visit ✓'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* UpliftTab has been extracted to components/UpliftTab.js and is imported at the top of this file. */

// Module-level cache for HistoryTab — avoids re-fetching on every tab switch within a session
const _historyCache = { data: null, fetchedAt: 0 };
const HISTORY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/* ══════════════════════════════════════════════════════════
   HISTORY TAB  (skeleton)
   ══════════════════════════════════════════════════════════ */
function HistoryTab({ primary }) {
  const [visits,  setVisits]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    // Use cached data if still within TTL — avoids refetch on tab switch
    if (_historyCache.data && (Date.now() - _historyCache.fetchedAt) < HISTORY_CACHE_TTL_MS) {
      setVisits(_historyCache.data);
      setLoading(false);
      return;
    }
    async function load() {
      setLoading(true); setError('');
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const tok = session?.access_token;
        if (!tok) { setError('Session expired.'); setLoading(false); return; }
        const res  = await fetch('/api/sales/history', { headers: { Authorization: `Bearer ${tok}` } });
        const data = await res.json();
        if (!res.ok) { setError(data.error || 'Could not load history.'); setLoading(false); return; }
        // Merge today's uplifts into the visits list so Daily Visit Log includes uplift actions
        const fetchedVisits = data.visits || [];
        const fetchedUplifts = data.uplifts || [];
        const todayStart = new Date();
        todayStart.setHours(0,0,0,0);
        const todaysUplifts = (fetchedUplifts || []).filter(u => new Date(u.created_at) >= todayStart).map(u => ({
          id: `uplift-${u.id}`,
          visit_type: 'uplift',
          created_at: u.created_at,
          shops: u.shops,
          visit_items: (u.uplift_items || []).map(ii => ({ sold: ii.cartons, products: ii.products })),
        }));
        const merged = [...fetchedVisits, ...todaysUplifts].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        _historyCache.data = merged;
        _historyCache.fetchedAt = Date.now();
        setVisits(merged);
      } catch { setError('Network error.'); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const fmtDate = iso => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  const fmtTime = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  return (
    <div>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Daily Visit Log</h1>
        <p className={styles.pageSubtitle}>Today&apos;s visit activity.</p>
      </div>

      {error && <div className={styles.alertDanger} style={{ marginBottom: 14 }}>{error}</div>}

      {/* ── Visit Log ───────────────────────────────────────────── */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}>Visit Log</span>
          <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Today · {visits.length} visit{visits.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '28px 0', color: '#94a3b8' }}>Loading…</div>
        ) : visits.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '28px 0', color: '#94a3b8', fontSize: '0.85rem' }}>
            No visits recorded today.
          </div>
        ) : (
          <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {visits.map(v => {
              const qtyItems = (v.visit_items || []).filter(i => (i.sold || 0) > 0);
              const totalQty = qtyItems.reduce((s, i) => s + (i.sold || 0), 0);
              return (
                <div key={v.id} style={{
                  border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', background: '#fff',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.9rem' }}>
                        {v.shops?.name || '—'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 1 }}>
                        {fmtDate(v.created_at)} · {fmtTime(v.created_at)}
                      </div>
                    </div>
                    <span style={{
                      fontSize: '0.7rem', fontWeight: 700, padding: '2px 9px', borderRadius: 20,
                      background: totalQty > 0 ? (v.visit_type === 'uplift' ? '#fff7ed' : '#dcfce7') : '#f1f5f9',
                      color: totalQty > 0 ? (v.visit_type === 'uplift' ? '#92400e' : '#166534') : '#64748b',
                    }}>
                      {totalQty > 0 ? (v.visit_type === 'uplift' ? `Uplifted ${totalQty} ctn` : `Sold ${totalQty} ctn`) : 'No Sale'}
                    </span>
                  </div>

                  {/* SKU chips */}
                  {(v.visit_items || []).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {v.visit_items.map((item, idx) => (
                        <span key={idx} style={{
                          fontSize: '0.7rem', background: '#f1f5f9', color: '#475569',
                          padding: '2px 8px', borderRadius: 6, fontWeight: 600,
                        }}>
                          {item.products?.sku}
                          {(item.sold || 0) > 0 && ` · ${item.sold} ${v.visit_type === 'uplift' ? 'uplifted' : 'sold'}`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   STOCK TAB  (skeleton)
   ══════════════════════════════════════════════════════════ */
function StockTab({ primary, onNavigate }) {
  const [items,        setItems]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');

  useEffect(() => {
    if (_stockCache.data && (Date.now() - _stockCache.ts) < STOCK_CACHE_TTL_MS) {
      setItems(_stockCache.data); setLoading(false); return;
    }
    async function load() {
      setLoading(true);
      setError('');
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const tok = session?.access_token;
        if (!tok) { setError('Session expired.'); setLoading(false); return; }
        const res  = await fetch('/api/sales/stock', { headers: { Authorization: `Bearer ${tok}` } });
        const data = await res.json();
        if (!res.ok) { setError(data.error || 'Could not load stock.'); setLoading(false); return; }
        _stockCache.data = data;
        _stockCache.ts   = Date.now();
        setItems(data);
      } catch { setError('Network error loading stock.'); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const totalStock  = items.reduce((s, i) => s + (i.quantity ?? 0), 0);
  const maxQty      = Math.max(...items.map(i => i.quantity ?? 0), 1);
  const hasZero     = items.some(i => (i.quantity ?? 0) === 0);

  return (
    <div>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Stock Balance</h1>
        <p className={styles.pageSubtitle}>Your personal carton balance per SKU.</p>
      </div>

      {error && <div className={styles.alertDanger} style={{ marginBottom: 16 }}>{error}</div>}

      {!loading && !error && hasZero && (
        <div className={styles.alertWarning} style={{ marginBottom: 16 }}>
          ⚠️ One or more SKUs are out of stock. Submit an <strong>Uplift Request</strong> before selling those SKUs.
        </div>
      )}

      {loading ? (
        <div className={styles.card}>
          <div className={styles.cardBody} style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>
            Loading stock balance…
          </div>
        </div>
      ) : !error && items.length === 0 ? (
        <div className={styles.card}>
          <div className={styles.cardBody}>
            <div className={styles.placeholder} style={{ padding: '32px 0' }}>
              <div className={styles.placeholderIcon}>📦</div>
              <p style={{ fontSize: '0.85rem', margin: 0 }}>No stock on record. Your balance will update once an uplift is approved.</p>
            </div>
            <button className={`${styles.btn} ${styles.btnPrimary} ${styles.btnFull}`} onClick={() => onNavigate('uplift')}>
              ⬆️ Request Uplift
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Summary card */}
          <div className={styles.card}>
            <div className={styles.cardBody} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: 2 }}>Total Stock</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: primary }}>{totalStock}</div>
                <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>cartons across {items.length} SKU{items.length !== 1 ? 's' : ''}</div>
              </div>
              <button
                className={`${styles.btn} ${styles.btnOutline}`}
                style={{ fontSize: '0.8rem' }}
                onClick={() => onNavigate('uplift')}
              >⬆️ Request Uplift</button>
            </div>
          </div>

          {/* Per-SKU cards */}
          {items.map(item => {
            const qty = item.quantity ?? 0;
            const pct = Math.round((qty / maxQty) * 100);
            return (
              <div className={styles.card} key={item.product_id}>
                <div className={styles.cardBody}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <span style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.95rem' }}>{item.name}</span>
                      <span style={{
                        marginLeft: 8, fontSize: '0.68rem', fontWeight: 700,
                        background: '#e2e8f0', color: '#475569',
                        padding: '1px 7px', borderRadius: 5,
                      }}>{item.sku}</span>
                    </div>
                    <span style={{
                      fontWeight: 800, fontSize: '1.3rem',
                      color: qty === 0 ? '#ef4444' : primary,
                    }}>
                      {qty}
                      <span style={{ fontSize: '0.72rem', fontWeight: 500, color: '#94a3b8', marginLeft: 4 }}>ctn</span>
                    </span>
                  </div>
                  <div className={styles.progressBar}>
                    <div
                      className={styles.progressFill}
                      style={{ width: `${pct}%`, background: qty === 0 ? '#ef4444' : undefined }}
                    />
                  </div>
                  <div style={{ fontSize: '0.72rem', color: qty === 0 ? '#ef4444' : '#94a3b8', marginTop: 5 }}>
                    {qty === 0 ? '⚠️ Out of stock — request an uplift before selling this SKU.' : `${pct}% of peak balance`}
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   PROFILE TAB  (skeleton)
   ══════════════════════════════════════════════════════════ */
// Module-level cache — avoids re-fetching profile on every tab switch
const _profileCache = { data: null };

function ProfileTab({ currentUser, primary, accent, onLogout }) {
  const [profile,  setProfile]  = useState(_profileCache.data);
  const [loading,  setLoading]  = useState(!_profileCache.data);
  const [error,    setError]    = useState('');

  useEffect(() => {
    // Return immediately if already cached
    if (_profileCache.data) return;
    async function load() {
      setLoading(true); setError('');
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const tok = session?.access_token;
        if (!tok) { setError('Session expired.'); setLoading(false); return; }
        const res  = await fetch('/api/sales/profile', { headers: { Authorization: `Bearer ${tok}` } });
        const data = await res.json();
        if (!res.ok) { setError(data.error || 'Could not load profile.'); setLoading(false); return; }
        _profileCache.data = data;
        setProfile(data);
      } catch { setError('Network error.'); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const name    = profile?.full_name || currentUser?.full_name || '—';
  const initial = (name[0] || 'S').toUpperCase();

  const VEHICLE_LABELS = { motorbike: '🏍️ Motorbike', van: '🚐 Van', bicycle: '🚲 Bicycle' };

  return (
    <div>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>My Profile</h1>
        <p className={styles.pageSubtitle}>Your account details and preferences.</p>
      </div>

      {error && <div className={styles.alertDanger} style={{ marginBottom: 14 }}>{error}</div>}

      {/* Avatar & name hero */}
      <div className={styles.card}>
        <div className={styles.cardBody} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '32px 20px' }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            background: `linear-gradient(135deg, ${primary}, ${accent})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: '2rem', color: '#fff',
            marginBottom: 14, overflow: 'hidden',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          }}>
            {currentUser?.avatar_url
              ? <img src={currentUser.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : initial}
          </div>
          <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#0f172a' }}>{name}</div>
          {currentUser?.position && (
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>{currentUser.position}</div>
          )}
          <span className={`${styles.badge} ${styles.badgeDraft}`} style={{ marginTop: 8 }}>Salesperson</span>
        </div>
      </div>

      {/* Account info */}
      <div className={styles.card}>
        <div className={styles.cardHeader}><span className={styles.cardTitle}>Account Information</span></div>
        <div className={styles.cardBody}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: '0.85rem' }}>Loading…</div>
          ) : (
            <>
              <div className={styles.infoRow}>
                <span className={styles.infoKey}>Full Name</span>
                <span className={styles.infoValue}>{profile?.full_name || '—'}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoKey}>Email</span>
                <span className={styles.infoValue}>{profile?.email || '—'}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoKey}>Role</span>
                <span className={styles.infoValue}>Salesperson</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoKey}>Region</span>
                <span className={styles.infoValue}>{profile?.region_name || '—'}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoKey}>Vehicle</span>
                <span className={styles.infoValue}>{VEHICLE_LABELS[profile?.vehicle] || '—'}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Logout */}
      <button
        className={`${styles.btn} ${styles.btnDanger} ${styles.btnFull}`}
        style={{ marginTop: 4 }}
        onClick={onLogout}
      >
        🚪 Sign Out
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   MAIN PAGE — Shell with auth guard
   ══════════════════════════════════════════════════════════ */
export default function SalesPortal() {
  const router = useRouter();
  const { branding } = useBranding();
  const [role,        setRole]        = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [activeTab,   setActiveTab]   = useState('visit');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerOpen,  setDrawerOpen]  = useState(false);
  const [salesFeatures, setSalesFeatures] = useState(null); // null = loading, {} = loaded

  /* Branding */
  const primary     = branding.theme_color  || '#7c3aed';
  const accent      = branding.accent_color || '#06b6d4';
  const systemName  = branding.system_name  || 'Sales Visit System';
  const companyName = branding.company_name || '';
  const logoSrc     = branding.company_logo || null;
  const logoInitial = (companyName || systemName || 'S')[0].toUpperCase();

  /* Auth check — only Salesperson role allowed */
  useEffect(() => {
    async function check() {
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token;
      if (!tok) { setRole(null); setLoading(false); return; }
      const res  = await fetch('/api/admin/check', { headers: { Authorization: `Bearer ${tok}` } });
      const body = await res.json();
      setRole(body.role || null);
      setCurrentUser({ full_name: body.full_name || null, avatar_url: body.avatar_url || null, position: body.position || null });

      // Load sales feature flags in parallel — determines visible tabs
      try {
        const featRes = await fetch('/api/sales/features-public', { headers: { Authorization: `Bearer ${tok}` } });
        setSalesFeatures(featRes.ok ? await featRes.json() : {});
      } catch {
        setSalesFeatures({}); // safe fallback: show all tabs
      }

      setLoading(false);
    }
    check();
  }, []);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    router.push('/login');
  }, [router]);

  const navigate = useCallback((tab) => {
    setActiveTab(tab);
    setDrawerOpen(false);
  }, []);

  // Derive visible tabs from feature flags.
  // Required tabs always shown. Optional tabs shown when flag is enabled
  // (or while salesFeatures is null / still loading — show all to avoid flicker).
  const visibleTabs = TABS.filter(t => {
    if (REQUIRED_SALES_TAB_IDS.has(t.id)) return true;
    if (!t.featureKey) return true; // no flag = always visible
    if (salesFeatures === null) return true; // loading — show all
    return salesFeatures[t.featureKey] !== false;
  });

  // If the active tab was just hidden, fall back to 'visit'
  const safeActiveTab = visibleTabs.some(t => t.id === activeTab) ? activeTab : 'visit';

  /* ── Guard states ── */
  if (loading) return <div className={styles.splash}>Verifying access…</div>;
  if (!role)   return <div className={styles.splash}>Not authenticated. <a href="/login">Sign in</a></div>;
  if (role !== 'Salesperson') return (
    <div className={styles.splash}>
      <span style={{ fontSize: '2rem' }}>🚫</span>
      Access denied. This portal is for Salesperson accounts only.
      <a href="/login">← Back to Login</a>
    </div>
  );

  /* ── Render active tab content ── */
  const renderContent = () => {
    switch (safeActiveTab) {
      case 'dashboard': return <DashboardTab currentUser={currentUser} primary={primary} accent={accent} onNavigate={navigate} />;
      case 'visit':     return <VisitTab primary={primary} accent={accent} onNavigate={navigate} />;
      case 'uplift':    return <UpliftTab primary={primary} accent={accent} onNavigate={navigate} />;
      case 'performance': return <MyPerformance primary={primary} accent={accent} />;
      case 'history':   return <HistoryTab primary={primary} />;
      case 'stock':     return <StockTab primary={primary} onNavigate={navigate} />;
      case 'profile':   return <ProfileTab currentUser={currentUser} primary={primary} accent={accent} onLogout={handleLogout} />;
      default:          return null;
    }
  };

  /* ── Sidebar nav (shared between sidebar & mobile drawer) ── */
  const SidebarNav = ({ compact }) => (
    <>
      <nav className={styles.nav}>
        {visibleTabs.map(tab => (
          <button
            key={tab.id}
            className={`${styles.navItem} ${safeActiveTab === tab.id ? styles.navItemActive : ''}`}
            onClick={() => navigate(tab.id)}
            title={compact ? tab.label : undefined}
          >
            <span className={styles.navIcon}>{tab.icon}</span>
            {!compact && <span className={styles.navLabel}>{tab.label}</span>}
          </button>
        ))}
      </nav>

      <div className={styles.sidebarFooter}>
        {!compact && (
          <div className={styles.userRow}>
            <div className={styles.userAvatar}>
              {currentUser?.avatar_url
                ? <img src={currentUser.avatar_url} alt="avatar" />
                : (currentUser?.full_name?.[0] || 'S').toUpperCase()
              }
            </div>
            <div className={styles.userInfo}>
              <div className={styles.userName}>{currentUser?.full_name || 'Salesperson'}</div>
              <div className={styles.userRole}>Field Agent</div>
            </div>
          </div>
        )}
        <button className={styles.logoutBtn} onClick={handleLogout} title="Sign out">
          <span className={styles.navIcon}>🚪</span>
          {!compact && <span>Sign Out</span>}
        </button>
      </div>
    </>
  );

  return (
    <div className={styles.layout}>
      {/* ── Desktop Sidebar ── */}
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : styles.sidebarClosed}`}>
        <div className={styles.sidebarHeader}>
          <div className={styles.logoMark}
            style={{ background: logoSrc ? 'transparent' : `linear-gradient(135deg, ${primary}, ${accent})` }}
          >
            {logoSrc
              ? <img src={logoSrc} alt="logo" className={styles.logoImg} />
              : logoInitial
            }
          </div>
          {sidebarOpen && (
            <div className={styles.sidebarTitles}>
              <div className={styles.sidebarTitle}>{systemName}</div>
              {companyName && <div className={styles.sidebarSubtitle}>{companyName}</div>}
            </div>
          )}
          <button className={styles.toggleBtn} onClick={() => setSidebarOpen(o => !o)} title="Toggle sidebar">
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>
        <SidebarNav compact={!sidebarOpen} />
      </aside>

      {/* ── Mobile Drawer Overlay ── */}
      <div
        className={`${styles.mobileDrawerOverlay} ${drawerOpen ? styles.mobileDrawerOpen : ''}`}
        onClick={() => setDrawerOpen(false)}
      />
      <div className={`${drawerOpen ? styles.mobileDrawerOpen : ''}`}>
        <div className={styles.mobileDrawer} style={{ transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)' }}>
          <div className={styles.sidebarHeader}>
            <div className={styles.logoMark}
              style={{ background: logoSrc ? 'transparent' : `linear-gradient(135deg, ${primary}, ${accent})` }}
            >
              {logoSrc ? <img src={logoSrc} alt="logo" className={styles.logoImg} /> : logoInitial}
            </div>
            <div className={styles.sidebarTitles}>
              <div className={styles.sidebarTitle}>{systemName}</div>
              {companyName && <div className={styles.sidebarSubtitle}>{companyName}</div>}
            </div>
          </div>
          <SidebarNav compact={false} />
        </div>
      </div>

      {/* ── Main area ── */}
      <div className={styles.main}>
        {/* Topbar */}
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button className={styles.menuBtnMobile} onClick={() => setDrawerOpen(o => !o)} title="Menu">
              ☰
            </button>
            <span className={styles.topbarTitle}>
              {visibleTabs.find(t => t.id === safeActiveTab)?.icon}{' '}
              {visibleTabs.find(t => t.id === safeActiveTab)?.label}
            </span>
            <span className={styles.topbarBadge}>Salesperson</span>
          </div>
          <div className={styles.topbarRight}>
            <button
              className={styles.topbarAvatarBtn}
              onClick={() => navigate('profile')}
              title="My profile"
              style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}
            >
              {currentUser?.avatar_url
                ? <img src={currentUser.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                : (currentUser?.full_name?.[0] || 'S').toUpperCase()
              }
            </button>
          </div>
        </header>

        {/* Scrollable content */}
        <div className={styles.content}>
          {renderContent()}
        </div>
      </div>

      {/* ── Mobile Bottom Nav ── */}
      <nav className={styles.bottomNav}>
        {visibleTabs.map(tab => (
          <button
            key={tab.id}
            className={`${styles.bottomNavItem} ${safeActiveTab === tab.id ? styles.bottomNavItemActive : ''}`}
            onClick={() => navigate(tab.id)}
          >
            <span className={styles.bottomNavIcon}>{tab.icon}</span>
            <span className={styles.bottomNavLabel}>{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

