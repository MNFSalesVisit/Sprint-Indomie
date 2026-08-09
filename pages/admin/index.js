import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabaseClient';
import { useBranding } from '../../lib/brandingContext';
import styles from '../../styles/admin.module.css';
import CompetitorAnalysisPanel from '../../components/admin/CompetitorAnalysisPanel';
import FuelManagement from './fuel-management';
import ReportPreviewModal from '../../components/ReportPreviewModal';
import MapFullscreenModal from '../../components/MapFullscreenModal';

// ── Module-level caches (persist across tab switches) ────────────────────────
const _perfCache   = { token: null, key: null, data: null, users: null, subregions: null };
const _custCache   = { key: null, data: null, subregions: null, periodCartons: null, periodVisits: null, periodShops: null };
const _skuCache    = { key: null, data: null };
const _stkCache    = { key: null, data: null };
const _rnsCache    = { key: null, data: null };
const _mapMetaCache = { token: null, regions: null, users: null };

async function registerPush() {
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array('BHxoyyh7Pg6A3FfTDQQu2rb4vGtXQpOOAJ3zb1YreckZMP9rCDk5l-LjYcBP-Pe11_BcsTFQuB6LSQTDnZzqLDM')
      });
      await fetch('/api/admin/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub)
      });
    } catch (err) {
      console.error('Push registration failed', err);
    }
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

const REQUIRED_TAB_IDS         = new Set(['dashboard', 'uplifts', 'performance', 'targets']);
const MANAGER_REQUIRED_TAB_IDS = new Set(['performance', 'map']);

const ALL_TABS = [
  { id: 'dashboard',   label: 'Dashboard',           icon: '📊' },
  { id: 'uplifts',     label: 'Uplift Approvals',    icon: '📦' },
  { id: 'performance', label: 'Performance Analysis', icon: '🏆' },
  { id: 'map',         label: 'Map',                 icon: '🗺️' },
  { id: 'customer',    label: 'Customer Analysis',   icon: '🏪' },
  { id: 'competitor',  label: 'Competitor Analysis',  icon: '🔎' },
  { id: 'fuel',        label: 'Fuel Management',      icon: '⛽' },
  { id: 'targets',     label: 'Targets',             icon: '🎯' },
];

/* ── Placeholder ─────────────────────────────────────────────── */
function PlaceholderTab({ icon, title, description }) {
  return (
    <div className={styles.placeholder}>
      <div className={styles.placeholderIcon}>{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      <span className={styles.badge}>Coming soon</span>
    </div>
  );
}

/* ── Status Badge ─────────────────────────────────────────────── */
function StatusBadge({ status }) {
  const map = {
    pending:  { bg: '#fef3c7', color: '#92400e', label: '⏳ Pending' },
    approved: { bg: '#d1fae5', color: '#065f46', label: '✅ Approved' },
    rejected: { bg: '#fee2e2', color: '#991b1b', label: '❌ Rejected' },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{
      fontSize: '0.7rem', fontWeight: 700, padding: '3px 10px',
      borderRadius: 20, background: s.bg, color: s.color, whiteSpace: 'nowrap',
    }}>{s.label}</span>
  );
}

/* ── Uplift Card ──────────────────────────────────────────────── */
function UpliftCard({ uplift, onApprove, onReject, approving, token }) {
  const totalCtns = (uplift.uplift_items || []).reduce((s, i) => s + (i.cartons || 0), 0);
  const date = new Date(uplift.created_at).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  const time = new Date(uplift.created_at).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit',
  });
  const isPending = uplift.status === 'pending';

  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError,   setReceiptError]   = useState('');

  const getSignedUrl = async (forDownload) => {
    setReceiptLoading(true);
    setReceiptError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token || token;
      const qs = forDownload ? '&download=1' : '';
      const r = await fetch(
        `/api/admin/receipt?path=${encodeURIComponent(uplift.receipt_path)}${qs}`,
        { headers: { Authorization: `Bearer ${tok}` } },
      );
      const d = await r.json();
      if (!r.ok) { setReceiptError(d.error || 'Could not load receipt.'); return null; }
      return d;
    } catch { setReceiptError('Network error.'); return null; }
    finally   { setReceiptLoading(false); }
  };

  const handleView = async () => {
    const d = await getSignedUrl(false);
    if (d?.url) window.open(d.url, '_blank', 'noopener,noreferrer');
  };

  const handleDownload = async () => {
    const d = await getSignedUrl(true);
    if (d?.url) {
      const a = document.createElement('a');
      a.href     = d.url;
      a.download = d.filename || 'receipt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  return (
    <div className={styles.upliftCard}>
      <div className={styles.upliftCardHeader}>
        <div>
          <div className={styles.upliftCardShop}>{uplift.shops?.name || 'Unknown shop'}</div>
          {uplift.shops?.location && (
            <div className={styles.upliftCardLocation}>{uplift.shops.location}</div>
          )}
        </div>
        <StatusBadge status={uplift.status} />
      </div>

      <div className={styles.upliftCardMeta}>
        <span className={styles.metaItem}>👤 <strong>{uplift.app_users?.full_name || 'Unknown'}</strong></span>
        <span className={styles.metaItem}>📅 {date} {time}</span>
        <span className={styles.metaItem}>📦 <strong>{totalCtns} ctn</strong> total</span>
      </div>

      <div className={styles.skuRow}>
        {(uplift.uplift_items || []).filter(item => (item.cartons || 0) > 0).map((item, i) => (
          <span key={i} className={styles.skuChip}>
            {item.products?.sku} · {item.cartons} ctn
          </span>
        ))}
      </div>

      {uplift.is_reuploaded && (
        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: '#fff7ed', border: '1.5px solid #fed7aa',
            borderRadius: 20, padding: '3px 11px',
            fontSize: '0.72rem', fontWeight: 700, color: '#c2410c',
          }}>
            🔄 Reuploaded Receipt{uplift.reupload_count > 1 ? ` · Attempt ${uplift.reupload_count}` : ''}
          </span>
          {uplift.reupload_note && (
            <span style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic' }}>
              Note: &ldquo;{uplift.reupload_note}&rdquo;
            </span>
          )}
        </div>
      )}

      <div className={styles.receiptRow}>
        {uplift.receipt_path ? (
          <>
            <button
              className={styles.receiptBtn}
              onClick={handleView}
              disabled={receiptLoading}
              title="Open receipt in a new tab"
            >📎 View Receipt</button>
            <button
              className={`${styles.receiptBtn} ${styles.receiptBtnDl}`}
              onClick={handleDownload}
              disabled={receiptLoading}
              title="Download receipt file"
            >{receiptLoading ? '…' : '⬇ Download'}</button>
            {receiptError && (
              <span style={{ fontSize: '0.72rem', color: '#dc2626', marginLeft: 6 }}>{receiptError}</span>
            )}
          </>
        ) : (
          <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic' }}>
            📎 No receipt uploaded
          </span>
        )}
      </div>

      {uplift.status === 'rejected' && uplift.rejected_reason && (
        <div className={styles.rejectedReason}>
          <strong>Reason:</strong> {uplift.rejected_reason}
        </div>
      )}

      {isPending && (
        <div className={styles.upliftActions}>
          <button
            className={styles.btnApprove}
            onClick={() => onApprove(uplift.id)}
            disabled={approving === uplift.id}
          >
            {approving === uplift.id ? 'Processing…' : '✓ Approve'}
          </button>
          <button
            className={styles.btnReject}
            onClick={() => onReject(uplift)}
          >✗ Reject</button>
        </div>
      )}
    </div>
  );
}

/* ── Reject Modal ─────────────────────────────────────────────── */
function RejectModal({ uplift, onConfirm, onCancel, loading }) {
  const [reason, setReason] = useState('');

  useEffect(() => { setReason(''); }, [uplift?.id]);

  if (!uplift) return null;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <h3 className={styles.modalTitle}>Reject Uplift</h3>
        <p className={styles.modalSubtitle}>
          {uplift.shops?.name} · {uplift.app_users?.full_name}
        </p>
        <label className={styles.modalLabel}>Reason for rejection</label>
        <textarea
          className={styles.modalTextarea}
          rows={4}
          placeholder="Enter a clear reason visible to the salesperson…"
          value={reason}
          onChange={e => setReason(e.target.value)}
        />
        <div className={styles.modalActions}>
          <button className={styles.btnCancel} onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button
            className={styles.btnConfirmReject}
            onClick={() => onConfirm(uplift.id, reason)}
            disabled={loading || !reason.trim()}
          >
            {loading ? 'Rejecting…' : '✗ Confirm Rejection'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Uplifts Tab ──────────────────────────────────────────────── */
function UpliftsTab({ token }) {
  const { branding } = useBranding();
  const primary      = branding?.theme_color || '#2563eb';
  const [filter,       setFilter]       = useState('pending');
  const [uplifts,      setUplifts]      = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [approving,    setApproving]    = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejecting,    setRejecting]    = useState(false);
  const [msg,          setMsg]          = useState({ text: '', isError: false });
  const [upliftSearch,   setUpliftSearch]   = useState('');
  const [upliftDateFrom, setUpliftDateFrom] = useState('');
  const [upliftDateTo,   setUpliftDateTo]   = useState('');

  const loadUplifts = useCallback(async (status) => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`/api/admin/uplifts?status=${status}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Failed to load'); return; }
      setUplifts(d);
    } catch { setError('Network error. Please try again.'); }
    finally   { setLoading(false); }
  }, [token]);

  useEffect(() => { loadUplifts(filter); }, [filter, loadUplifts]);

  const handleApprove = async (id) => {
    setApproving(id);
    setMsg({ text: '', isError: false });
    try {
      const r = await fetch('/api/admin/uplifts', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'approve' }),
      });
      const d = await r.json();
      if (!r.ok) { setMsg({ text: d.error || 'Approval failed.', isError: true }); return; }
      setMsg({ text: '✅ Uplift approved and stock balance updated.', isError: false });
      loadUplifts(filter);
    } catch { setMsg({ text: 'Network error.', isError: true }); }
    finally  { setApproving(null); }
  };

  const handleRejectConfirm = async (id, reason) => {
    setRejecting(true);
    try {
      const r = await fetch('/api/admin/uplifts', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'reject', rejected_reason: reason }),
      });
      const d = await r.json();
      if (!r.ok) { setMsg({ text: d.error || 'Rejection failed.', isError: true }); }
      else {
        setMsg({ text: 'Uplift rejected and salesperson notified.', isError: false });
        setRejectTarget(null);
        loadUplifts(filter);
      }
    } catch { setMsg({ text: 'Network error.', isError: true }); }
    finally  { setRejecting(false); }
  };

  const filteredUplifts = uplifts.filter(u => {
    const q = upliftSearch.trim().toLowerCase();
    const matchShop = !q || (u.shops?.name || '').toLowerCase().includes(q) || (u.app_users?.full_name || '').toLowerCase().includes(q);
    const matchFrom = !upliftDateFrom || new Date(u.created_at) >= new Date(upliftDateFrom + 'T00:00:00');
    const matchTo   = !upliftDateTo   || new Date(u.created_at) <= new Date(upliftDateTo   + 'T23:59:59');
    return matchShop && matchFrom && matchTo;
  });

  const FILTERS = [
    { key: 'pending',  label: '⏳ Pending'  },
    { key: 'approved', label: '✅ Approved' },
    { key: 'rejected', label: '❌ Rejected' },
  ];

  return (
    <div>
      <h2 className={styles.tabHeading}>Uplift Approvals</h2>

      <div className={styles.filterBar}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            className={`${styles.filterBtn} ${filter === f.key ? styles.filterBtnActive : ''}`}
            onClick={() => { setFilter(f.key); setMsg({ text: '', isError: false }); }}
          >{f.label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <input
          type="text"
          placeholder="🔍 Search by shop or salesperson…"
          value={upliftSearch}
          onChange={e => setUpliftSearch(e.target.value)}
          style={{ flex: 1, minWidth: 180, padding: '7px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: '0.82rem', outline: 'none' }}
        />
        <input type="date" value={upliftDateFrom} onChange={e => setUpliftDateFrom(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: '0.82rem' }} title="From date" />
        <input type="date" value={upliftDateTo} onChange={e => setUpliftDateTo(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: '0.82rem' }} title="To date" />
        <button
          style={{ padding: '7px 16px', borderRadius: 8, background: primary, color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
          onClick={() => { /* filter is live — button gives visual confirmation */ setUpliftSearch(prev => prev); }}
        >🔍 Search</button>
        {(upliftSearch || upliftDateFrom || upliftDateTo) && (
          <button onClick={() => { setUpliftSearch(''); setUpliftDateFrom(''); setUpliftDateTo(''); }}
            style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#f1f5f9', cursor: 'pointer', fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
            ✕ Clear
          </button>
        )}
      </div>

      {msg.text && (
        <div className={`${styles.actionMsg} ${msg.isError ? styles.actionMsgError : ''}`}>
          {msg.text}
        </div>
      )}

      {loading && <div className={styles.loadingState}>Loading uplifts…</div>}
      {!loading && error && <div className={styles.errorState}>{error}</div>}
      {!loading && !error && filteredUplifts.length === 0 && (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📭</div>
          <p>{upliftSearch || upliftDateFrom || upliftDateTo ? 'No uplifts match your search.' : `No ${filter} uplifts found.`}</p>
        </div>
      )}

      {!loading && filteredUplifts.map(u => (
        <UpliftCard
          key={u.id}
          uplift={u}
          onApprove={handleApprove}
          onReject={setRejectTarget}
          approving={approving}
          token={token}
        />
      ))}

      <RejectModal
        uplift={rejectTarget}
        onConfirm={handleRejectConfirm}
        onCancel={() => setRejectTarget(null)}
        loading={rejecting}
      />
    </div>
  );
}

/* ── Dashboard Tab ────────────────────────────────────────────── */
function DashboardTab({ currentUser, branding, token, onNavigate, isManager, regionFilter }) {
  const [stats,    setStats]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [recent,   setRecent]   = useState([]);
  const [mgrStats, setMgrStats] = useState(null);

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name     = currentUser?.full_name?.split(' ')[0] || 'Admin';
  const primary  = branding.theme_color  || '#2563eb';
  const accent   = branding.accent_color || '#10b981';

  useEffect(() => {
    async function load() {
      try {
          const tok = token;

        if (isManager) {
          const now = new Date();
          const year  = String(now.getFullYear());
          const month = String(now.getMonth() + 1);
          const params = new URLSearchParams({ year, month });
          if (regionFilter) params.set('region_id', regionFilter);
          const r = await fetch(`/api/admin/performance?${params}`, {
            headers: { Authorization: `Bearer ${tok}` },
          });
          const d = await r.json();
          if (r.ok && Array.isArray(d)) {
            const agg = d.reduce((acc, row) => ({
              total_visits:   acc.total_visits   + (row.visits_total     || 0) + (row.uplift_count || 0),
              total_cartons:  acc.total_cartons  + (row.cartons_sold_mtd || 0),
              total_target:   acc.total_target   + (row.cartons_target   || 0),
              shops_sold:     acc.shops_sold     + (row.shops_sold       || 0),
              shops_not_sold: acc.shops_not_sold + (row.shops_not_sold   || 0),
            }), { total_visits: 0, total_cartons: 0, total_target: 0, shops_sold: 0, shops_not_sold: 0 });
            const total_shops = agg.shops_sold + agg.shops_not_sold;
            const efficiency  = total_shops > 0 ? Math.round((agg.shops_sold / total_shops) * 100) : 0;
            setMgrStats({ ...agg, efficiency, performers: d });
          }
        } else {
          const [statsRes, recentRes] = await Promise.all([
            fetch('/api/admin/dashboard',              { headers: { Authorization: `Bearer ${tok}` } }),
            fetch('/api/admin/uplifts?status=pending', { headers: { Authorization: `Bearer ${tok}` } }),
          ]);
          const [statsData, recentData] = await Promise.all([statsRes.json(), recentRes.json()]);
          if (statsRes.ok) setStats(statsData);
          setRecent(Array.isArray(recentData) ? recentData.slice(0, 4) : []);
        }
      } catch { /* silent */ }
      finally { setLoading(false); }
    }
    load();
  }, [token, isManager, regionFilter]);

  const total   = stats?.total    ?? 0;
  const pending  = stats?.pending  ?? 0;
  const approved = stats?.approved ?? 0;
  const rejected = stats?.rejected ?? 0;

  const summaryItems = [
    { label: 'Pending',  value: pending,  color: '#d97706', bg: '#fef3c7', icon: '⏳' },
    { label: 'Approved', value: approved, color: '#059669', bg: '#d1fae5', icon: '✅' },
    { label: 'Rejected', value: rejected, color: '#dc2626', bg: '#fee2e2', icon: '❌' },
  ];

  if (isManager) {
    const now = new Date();
    const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const effColor = !mgrStats ? primary
      : mgrStats.efficiency >= 70 ? '#059669'
      : mgrStats.efficiency >= 50 ? '#d97706'
      : '#dc2626';

    const kpiCards = [
      {
        label: 'Total Visits MTD',
        value: loading ? '…' : (mgrStats?.total_visits?.toLocaleString() ?? '—'),
        icon: '🚗',
        iconBg: `linear-gradient(135deg, ${primary}28, ${primary}14)`,
        color: primary,
      },
      {
        label: 'Shops Sold MTD',
        value: loading ? '…' : (mgrStats?.shops_sold?.toLocaleString() ?? '—'),
        icon: '🏪',
        iconBg: 'linear-gradient(135deg, #d1fae5, #a7f3d0)',
        color: '#059669',
      },
      {
        label: 'Efficiency',
        value: loading ? '…' : (mgrStats ? `${mgrStats.efficiency}%` : '—'),
        icon: '⚡',
        iconBg: 'linear-gradient(135deg, #fef3c7, #fde68a)',
        color: effColor,
      },
      {
        label: 'Cartons Sold MTD',
        value: loading ? '…' : (mgrStats?.total_cartons?.toLocaleString() ?? '—'),
        icon: '📦',
        iconBg: 'linear-gradient(135deg, #ede9fe, #ddd6fe)',
        color: '#7c3aed',
      },
    ];

    const performers = (mgrStats?.performers || [])
      .slice()
      .sort((a, b) => (b.cartons_sold_mtd || 0) - (a.cartons_sold_mtd || 0))
      .slice(0, 8);

    const rankColors = ['#f59e0b', '#6b7280', '#cd7f32'];

    const salesSummaryItems = [
      { label: 'Total Visits',     value: mgrStats?.total_visits   ?? 0, color: primary,   icon: '🚗' },
      { label: 'Shops Sold',       value: mgrStats?.shops_sold     ?? 0, color: '#059669', icon: '🏪' },
      { label: 'Shops Not Sold',   value: mgrStats?.shops_not_sold ?? 0, color: '#dc2626', icon: '🔴' },
      { label: 'Total Cartons',    value: mgrStats?.total_cartons  ?? 0, color: '#7c3aed', icon: '📦' },
    ];
    const totalShops = (mgrStats?.shops_sold ?? 0) + (mgrStats?.shops_not_sold ?? 0);

    return (
      <div>
        <div
          className={styles.dashHero}
          style={{ background: `linear-gradient(120deg, ${primary} 0%, ${accent} 100%)` }}
        >
          <div className={styles.dashHeroLeft}>
            <div className={styles.dashHeroGreeting}>{greeting}, {name}! 👋</div>
            <div className={styles.dashHeroSub}>Here&apos;s your sales overview — {monthLabel}</div>
          </div>
          <div className={styles.dashHeroDate}>
            <div className={styles.dashHeroDay}>
              {new Date().toLocaleDateString('en-GB', { weekday: 'long' })}
            </div>
            <div className={styles.dashHeroDayNum}>
              {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          </div>
        </div>

        <div className={styles.mgrKpiGrid}>
          {kpiCards.map(c => (
            <div key={c.label} className={styles.mgrKpiCard}>
              <div className={styles.mgrKpiIcon} style={{ background: c.iconBg }}>
                <span>{c.icon}</span>
              </div>
              <div className={styles.mgrKpiValue} style={{ color: c.color }}>{c.value}</div>
              <div className={styles.mgrKpiLabel}>{c.label}</div>
            </div>
          ))}
        </div>

        <div className={styles.card} style={{ margin: 0 }}>
            <div className={styles.cardTitleRow} style={{ justifyContent: 'center' }}>
              <h3 className={styles.cardTitle} style={{ textAlign: 'center', fontSize: '1.05rem', letterSpacing: '-0.01em', paddingBottom: 4 }}>🏆 Top Performers — {monthLabel}</h3>
            </div>

            {loading ? (
              <div className={styles.emptyState}><p>⏳ Loading…</p></div>
            ) : performers.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>📊</div>
                <p>No performance data yet this month.</p>
              </div>
            ) : (
              performers.map((row, idx) => {
                const pct = row.cartons_target > 0
                  ? Math.min(Math.round((row.cartons_sold_mtd / row.cartons_target) * 100), 100)
                  : 0;
                const rankColor = rankColors[idx] || '#94a3b8';
                const rankBg    = rankColor + '22';
                const barColor  = pct >= 100 ? '#059669' : pct >= 70 ? primary : pct >= 50 ? '#d97706' : '#dc2626';
                return (
                  <div key={row.user_id} className={styles.mgrPerfRow}>
                    <div className={styles.mgrPerfRank} style={{ background: rankBg, color: rankColor }}>
                      {idx + 1}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {row.full_name}
                      </div>
                      <div className={styles.mgrPerfBar}>
                        <div className={styles.mgrPerfBarFill} style={{ width: `${pct}%`, background: barColor }} />
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1e293b' }}>
                        {(row.cartons_sold_mtd || 0).toLocaleString()} ctn
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 2 }}>
                        {row.cartons_target ? `${pct}% of target` : 'No target set'}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
      </div>
    );
  }

  const statCards = [
    { label: 'Total Requests (MTD)', value: stats?.total,    color: primary,   icon: '📋' },
    { label: 'Pending',              value: stats?.pending,  color: '#d97706', icon: '⏳' },
    { label: 'Approved (MTD)',        value: stats?.approved, color: accent,    icon: '✅' },
    { label: 'Rejected (MTD)',        value: stats?.rejected, color: '#dc2626', icon: '❌' },
  ];

  return (
    <div>
      <div
        className={styles.dashHero}
        style={{ background: `linear-gradient(120deg, ${primary} 0%, ${accent} 100%)` }}
      >
        <div className={styles.dashHeroLeft}>
          <div className={styles.dashHeroGreeting}>{greeting}, {name}! 👋</div>
          <div className={styles.dashHeroSub}>Here&apos;s a snapshot of uplifts this month.</div>
        </div>
        <div className={styles.dashHeroDate}>
          <div className={styles.dashHeroDay}>
            {new Date().toLocaleDateString('en-GB', { weekday: 'long' })}
          </div>
          <div className={styles.dashHeroDayNum}>
            {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        </div>
      </div>

      <div className={styles.statsGrid}>
        {statCards.map(c => (
          <div key={c.label} className={styles.statCard} style={{ borderTopColor: c.color }}>
            <div className={styles.statLabel}>{c.icon} {c.label}</div>
            <div className={styles.statValue} style={{ color: c.color }}>
              {loading ? '…' : (c.value ?? '—')}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.dashGrid}>
        <div className={styles.card} style={{ margin: 0 }}>
          <div className={styles.cardTitleRow}>
            <h3 className={styles.cardTitle}>⏳ Recent Pending Uplifts</h3>
            {!loading && pending > 0 && (
              <button
                className={styles.btnPrimary}
                style={{ '--btn-color': primary }}
                onClick={() => onNavigate('uplifts')}
              >View all ({pending})</button>
            )}
          </div>

          {recent.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>🎉</div>
              <p>No pending uplifts — you&apos;re all caught up!</p>
            </div>
          ) : (
            recent.map(u => {
              const totalCtns = (u.uplift_items || []).reduce((s, i) => s + (i.cartons || 0), 0);
              const date = new Date(u.created_at).toLocaleDateString('en-GB', {
                day: '2-digit', month: 'short', year: 'numeric',
              });
              return (
                <div key={u.id} className={styles.recentUpliftRow}>
                  <div className={styles.recentUpliftInfo}>
                    <div className={styles.recentUpliftShop}>{u.shops?.name || 'Unknown shop'}</div>
                    <div className={styles.recentUpliftMeta}>
                      👤 {u.app_users?.full_name || '—'} &nbsp;·&nbsp; 📦 {totalCtns} ctn &nbsp;·&nbsp; {date}
                    </div>
                  </div>
                  <button
                    className={styles.btnPrimary}
                    style={{ '--btn-color': primary, fontSize: '0.75rem', padding: '5px 12px' }}
                    onClick={() => onNavigate('uplifts')}
                  >Review →</button>
                </div>
              );
            })
          )}
        </div>

        <div className={styles.dashSideStack}>
          <div className={styles.card} style={{ margin: 0 }}>
            <h3 className={styles.cardTitle} style={{ marginBottom: 16 }}>📊 MTD Summary</h3>
            <div className={styles.summaryTotal}>
              <span className={styles.summaryTotalNum} style={{ color: primary }}>
                {loading ? '…' : total}
              </span>
              <span className={styles.summaryTotalLabel}>Total Requests</span>
            </div>
            <div className={styles.summaryList}>
              {summaryItems.map(s => {
                const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
                return (
                  <div key={s.label} className={styles.summaryRow}>
                    <div className={styles.summaryRowTop}>
                      <span className={styles.summaryRowLabel}>
                        <span className={styles.summaryDot} style={{ background: s.color }} />
                        {s.icon} {s.label}
                      </span>
                      <span className={styles.summaryRowNum} style={{ color: s.color }}>
                        {loading ? '…' : s.value}
                      </span>
                    </div>
                    <div className={styles.summaryBar}>
                      <div className={styles.summaryBarFill} style={{ width: loading ? '0%' : `${pct}%`, background: s.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Targets Tab ─────────────────────────────────────────────── */
function TargetsTab({ token, primary, branding, readOnly, regionFilter }) {
  const now   = new Date();
  const MONTHS = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  const YEARS = Array.from({ length: 5 }, (_, i) => String(now.getFullYear() - i));

  const [year,    setYear]    = useState(String(now.getFullYear()));
  const [month,   setMonth]   = useState(String(now.getMonth() + 1));
  const [regionId, setRegionId] = useState(regionFilter || '');
  const [regions,  setRegions]  = useState([]);
  const [userId,   setUserId]   = useState('');
  const [rows,    setRows]    = useState([]);
  const [edits,   setEdits]   = useState({});
  const [saving,  setSaving]  = useState({});
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [saved,      setSaved]      = useState({});
  const [xlLoading,   setXlLoading]   = useState(false);
  const [limited,      setLimited]      = useState(false);
  const [targetsPreviewOpen, setTargetsPreviewOpen] = useState(false);
  const targetsDebounceRef = useRef(null);

  useEffect(() => { setRegionId(regionFilter || ''); }, [regionFilter]);

  useEffect(() => {
    if (!token) return;
    fetch('/api/admin/map-regions', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setRegions(d); })
      .catch(() => {});
  }, [token]);

  const daysInMonth = new Date(parseInt(year), parseInt(month), 0).getDate();

  const getKenyanHolidays = (y) => {
    const f = Math.floor;
    const G = y % 19, C = f(y / 100), H = (C - f(C / 4) - f((8 * C + 13) / 25) + 19 * G + 15) % 30;
    const I = H - f(H / 28) * (1 - f(29 / (H + 1)) * f((21 - G) / 11));
    const J = (y + f(y / 4) + I + 2 - C + f(C / 4)) % 7;
    const L = I - J;
    const easterMonth = 3 + f((L + 40) / 44);
    const easterDay   = L + 28 - 31 * f(easterMonth / 4);
    const easterSun   = new Date(y, easterMonth - 1, easterDay);
    const goodFriday  = new Date(easterSun); goodFriday.setDate(easterSun.getDate() - 2);
    const easterMon   = new Date(easterSun); easterMon.setDate(easterSun.getDate() + 1);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    const eidFitr = {
      2020: '2020-05-24', 2021: '2021-05-13', 2022: '2022-05-02',
      2023: '2023-04-21', 2024: '2024-04-10', 2025: '2025-03-31',
      2026: '2026-03-20', 2027: '2027-03-09', 2028: '2028-02-26',
      2029: '2029-02-14', 2030: '2030-02-03',
    };
    const eidAdha = {
      2020: '2020-07-31', 2021: '2021-07-20', 2022: '2022-07-09',
      2023: '2023-06-28', 2024: '2024-06-16', 2025: '2025-06-06',
      2026: '2026-05-26', 2027: '2027-05-16', 2028: '2028-05-04',
      2029: '2029-04-23', 2030: '2030-04-12',
    };

    const fixed = [
      `${y}-01-01`,
      fmt(goodFriday),
      fmt(easterMon),
      `${y}-05-01`,
      `${y}-06-01`,
      `${y}-10-10`,
      `${y}-10-20`,
      `${y}-12-12`,
      `${y}-12-25`,
      `${y}-12-26`,
    ];
    if (eidFitr[y])  fixed.push(eidFitr[y]);
    if (eidAdha[y])  fixed.push(eidAdha[y]);
    return new Set(fixed);
  };

  const workingDays = (() => {
    const y = parseInt(year); const m = parseInt(month);
    const holidays = getKenyanHolidays(y);
    const days = new Date(y, m, 0).getDate();
    let count = 0;
    for (let d = 1; d <= days; d++) {
      const date = new Date(y, m - 1, d);
      const dow  = date.getDay();
      const key  = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      if (dow !== 0 && !holidays.has(key)) count++;
    }
    return count;
  })();

  const daily  = (monthly) => monthly > 0 ? Math.round(monthly / workingDays) : '—';
  const weekly = (monthly) => monthly > 0 ? Math.round((monthly / workingDays) * 6) : '—';

  const loadTargets = async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`/api/admin/targets?year=${year}&month=${month}${regionId ? `&region_id=${regionId}` : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const lim = r.headers.get('X-Data-Limited') === 'true';
      const rawCartons = r.headers.get('X-Total-Cartons');
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Failed to load'); return; }
      setLimited(lim);
      setRows(d);
      const e = {};
      d.forEach(row => { e[row.user_id] = row.cartons_target != null ? String(row.cartons_target) : ''; });
      setEdits(e);
      setSaved({});
    } catch { setError('Network error.'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!token) return;
    clearTimeout(targetsDebounceRef.current);
    targetsDebounceRef.current = setTimeout(() => { loadTargets(); }, 400);
    return () => clearTimeout(targetsDebounceRef.current);
  }, [token, year, month, regionId]);

  const handleSave = async (userId) => {
    const val = edits[userId];
    if (val === '' || val == null) return;
    const num = parseInt(val);
    if (isNaN(num) || num < 0) return;
    setSaving(s => ({ ...s, [userId]: true }));
    try {
      const r = await fetch('/api/admin/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: userId, year: parseInt(year), month: parseInt(month), cartons_target: num }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Save failed'); return; }
      setRows(prev => prev.map(row => row.user_id === userId ? { ...row, cartons_target: num } : row));
      setSaved(s => ({ ...s, [userId]: true }));
      setTimeout(() => setSaved(s => ({ ...s, [userId]: false })), 2000);
    } catch { setError('Network error.'); }
    finally { setSaving(s => ({ ...s, [userId]: false })); }
  };

  const isDirty = (userId) => {
    const current = rows.find(r => r.user_id === userId);
    const editVal = edits[userId];
    if (editVal === '' || editVal == null) return false;
    return parseInt(editVal) !== (current?.cartons_target ?? -1);
  };

  const totalTarget = rows.reduce((s, r) => s + (r.cartons_target || 0), 0);
  const displayedRows = userId ? rows.filter(r => r.user_id === userId) : rows;

  const handleExcelExport = async () => {
    if (xlLoading) return;
    setXlLoading(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Sprint App';
      wb.created = new Date();
      const ws = wb.addWorksheet('Targets', { views: [{ showGridLines: false }] });

      const companyName = branding?.company_name || 'Sprint App';
      const themeHex    = (primary || '#2563eb').replace('#', '');
      const monthLabel  = `${MONTHS[parseInt(month) - 1]} ${year}`;

      const startRow = 1;

      ws.mergeCells(startRow, 1, startRow, 5);
      const titleCell = ws.getCell(startRow, 1);
      titleCell.value = companyName;
      titleCell.font  = { bold: true, size: 16, color: { argb: `FF${themeHex}` } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(startRow).height = 28;

      ws.mergeCells(startRow + 1, 1, startRow + 1, 5);
      const repCell = ws.getCell(startRow + 1, 1);
      repCell.value = `Targets — ${monthLabel} (${workingDays} working days)`;
      repCell.font  = { bold: false, size: 12, color: { argb: 'FF64748b' } };
      repCell.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(startRow + 1).height = 20;

      ws.getRow(startRow + 2).height = 8;

      const hdrRow = startRow + 3;
      const headers   = ['#', 'Salesperson', 'Daily Target', 'Weekly Target', 'Monthly Target'];
      const colWidths = [5, 32, 16, 16, 18];
      headers.forEach((h, i) => {
        ws.getColumn(i + 1).width = colWidths[i];
        const cell = ws.getCell(hdrRow, i + 1);
        cell.value = h;
        cell.font  = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${themeHex}` } };
        cell.alignment = { horizontal: i >= 2 ? 'center' : 'left', vertical: 'middle' };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFe2e8f0' } } };
      });
      ws.getRow(hdrRow).height = 22;

      rows.forEach((row, idx) => {
        const r       = hdrRow + 1 + idx;
        const isEven  = idx % 2 === 0;
        const bg      = isEven ? 'FFF8FAFC' : 'FFFFFFFF';
        const monthly = row.cartons_target || 0;
        const isSet   = monthly > 0;

        const cells = [
          idx + 1,
          row.full_name,
          isSet ? `${daily(monthly)} ctn` : '—',
          isSet ? `${weekly(monthly)} ctn` : '—',
          isSet ? monthly : 'Not set',
        ];

        cells.forEach((val, ci) => {
          const cell = ws.getCell(r, ci + 1);
          cell.value = val;
          cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
          cell.font  = ci === 4 && isSet
            ? { bold: true, size: 11, color: { argb: `FF${themeHex}` } }
            : ci === 4
            ? { size: 11, color: { argb: 'FF94a3b8' } }
            : { size: 11, color: { argb: 'FF334155' } };
          cell.alignment = { horizontal: ci >= 2 ? 'center' : 'left', vertical: 'middle' };
          cell.border = { bottom: { style: 'hair', color: { argb: 'FFe2e8f0' } } };
        });
        ws.getRow(r).height = 20;
      });

      const footerRow = hdrRow + 1 + rows.length + 1;
      ws.mergeCells(footerRow, 1, footerRow, 5);
      const footerCell = ws.getCell(footerRow, 1);
      footerCell.value = '';
      footerCell.font  = { italic: true, size: 9, color: { argb: 'FF94a3b8' } };
      footerCell.alignment = { horizontal: 'center' };
      ws.getRow(footerRow).height = 18;

      const buf  = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `targets-${year}-${String(month).padStart(2, '0')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Excel export failed', err);
    } finally {
      setXlLoading(false);
    }
  };

  return (
    <div className={styles.targetsWrap}>
      <div className={styles.targetsHeader}>
        <div>
          <h2 className={styles.targetsTitle}>🎯 Targets</h2>
          <p className={styles.targetsSubtitle}>Set monthly carton targets per salesperson</p>
        </div>

        <div className={styles.targetsFilters}>
          <select className={styles.targetsSelect} value={year} onChange={e => setYear(e.target.value)}>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className={styles.targetsSelect} value={month} onChange={e => setMonth(e.target.value)}>
            {MONTHS.map((name, i) => (
              <option key={i+1} value={String(i+1)}>{name}</option>
            ))}
          </select>
          <select className={styles.targetsSelect} value={regionId} onChange={e => setRegionId(e.target.value)}>
            <option value="">All Regions</option>
            {regions.map(r => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
          </select>
          <select className={styles.targetsSelect} value={userId} onChange={e => setUserId(e.target.value)}>
            <option value="">All Salespersons</option>
            {rows.map(r => <option key={r.user_id} value={r.user_id}>{r.full_name}</option>)}
          </select>
          <button
            className={styles.targetsApplyBtn}
            style={{ background: primary }}
            onClick={loadTargets}
            disabled={loading}
          >
            {loading ? '⏳' : '🔄'} Refresh
          </button>
          <button
            className={styles.perfExcelBtn}
            onClick={() => setTargetsPreviewOpen(true)}
            disabled={rows.length === 0}
          >
            👁 Preview Report
          </button>
        </div>
      </div>

      {error && <div className={styles.alertDanger} style={{ margin: '0 0 16px' }}>{error}</div>}

      {rows.length > 0 && (
        <div className={styles.targetsSummary}>
          <div className={styles.targetsSummaryItem}>
            <span className={styles.targetsSummaryVal}>{rows.length}</span>
            <span className={styles.targetsSummaryLabel}>Salespersons</span>
          </div>
          <div className={styles.targetsSummaryDivider} />
          <div className={styles.targetsSummaryItem}>
            <span className={styles.targetsSummaryVal}>{displayedRows.filter(r => r.cartons_target > 0).length}</span>
            <span className={styles.targetsSummaryLabel}>Targets set</span>
          </div>
          <div className={styles.targetsSummaryDivider} />
          <div className={styles.targetsSummaryItem}>
            <span className={styles.targetsSummaryVal}>{totalTarget.toLocaleString()}</span>
            <span className={styles.targetsSummaryLabel}>Total cartons ({MONTHS[parseInt(month)-1]})</span>
          </div>
          <div className={styles.targetsSummaryDivider} />
          <div className={styles.targetsSummaryItem}>
            <span className={styles.targetsSummaryVal}>{daysInMonth}d / {workingDays}wd</span>
            <span className={styles.targetsSummaryLabel}>Days / Working days</span>
          </div>
        </div>
      )}

      {loading ? (
        <div className={styles.targetsLoading}>⏳ Loading salespersons…</div>
      ) : displayedRows.length === 0 ? (
        <div className={styles.targetsEmpty}>{rows.length === 0 ? 'No salespersons found.' : 'No salesperson matches the filter.'}</div>
      ) : (
        <div className={styles.targetsTableWrap}>
          <table className={styles.targetsTable}>
            <thead>
              <tr>
                <th className={styles.targetsThName}>#</th>
                <th>Salesperson</th>
                <th className={styles.targetsThNum}>Daily Target</th>
                <th className={styles.targetsThNum}>Weekly Target</th>
                <th className={styles.targetsThNum}>Monthly Target</th>
                <th className={styles.targetsThAction}>Action</th>
              </tr>
            </thead>
            <tbody>
              {displayedRows.map((row, idx) => {
                const monthly = row.cartons_target || 0;
                const editVal  = edits[row.user_id] ?? '';
                const editNum  = parseInt(editVal) || 0;
                const dirty    = isDirty(row.user_id);
                const isSaving = saving[row.user_id];
                const wasSaved = saved[row.user_id];
                const isSet    = monthly > 0;

                return (
                  <tr key={row.user_id} className={dirty ? styles.targetsRowDirty : ''}>
                    <td className={styles.targetsIdx}>{idx + 1}</td>
                    <td>
                      <div className={styles.targetsPersonCell}>
                        <div className={styles.targetsAvatar} style={{ background: primary }}>
                          {(row.full_name || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className={styles.targetsPersonName}>{row.full_name}</div>
                        </div>
                      </div>
                    </td>
                    <td className={styles.targetsNumCell}>
                      <span className={`${styles.targetsBadge} ${isSet ? styles.targetsBadgeBlue : styles.targetsBadgeGray}`}>
                        {isSet ? `${daily(monthly)} ctn` : '—'}
                      </span>
                    </td>
                    <td className={styles.targetsNumCell}>
                      <span className={`${styles.targetsBadge} ${isSet ? styles.targetsBadgeGreen : styles.targetsBadgeGray}`}>
                        {isSet ? `${weekly(monthly)} ctn` : '—'}
                      </span>
                    </td>
                    <td className={styles.targetsNumCell}>
                      <div className={styles.targetsInputWrap}>
                        <input
                          className={`${styles.targetsInput} ${dirty ? styles.targetsInputDirty : ''}`}
                          type="number"
                          min="0"
                          placeholder="Set target…"
                          value={editVal}
                          onChange={e => setEdits(prev => ({ ...prev, [row.user_id]: e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && dirty && handleSave(row.user_id)}
                          disabled={readOnly}
                        />
                        <span className={styles.targetsInputUnit}>ctn</span>
                      </div>
                    </td>
                    <td className={styles.targetsActionCell}>
                      {readOnly ? (
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>View Only</span>
                      ) : wasSaved ? (
                        <span className={styles.targetsSavedFlash}>✓ Saved</span>
                      ) : (
                        <button
                          className={styles.targetsSaveBtn}
                          onClick={() => handleSave(row.user_id)}
                          disabled={!dirty || isSaving}
                          style={{ background: dirty ? primary : undefined }}
                        >
                          {isSaving ? '…' : 'Save'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ReportPreviewModal
        open={targetsPreviewOpen}
        onClose={() => setTargetsPreviewOpen(false)}
        title="Targets Report"
        subtitle={`${MONTHS[parseInt(month)-1]} ${year}`}
        headers={['Salesperson', 'Monthly Target (ctns)', 'Daily Target', 'Weekly Target']}
        rows={rows.map(r => [
          r.full_name,
          r.cartons_target || '—',
          r.cartons_target > 0 ? daily(r.cartons_target) : '—',
          r.cartons_target > 0 ? weekly(r.cartons_target) : '—',
        ])}
        onExport={handleExcelExport}
      />
    </div>
  );
}

/* ── Performance Tab ────────────────────────────────────────── */
function PerformanceTab({ token, primary, branding, regionFilter, isManager }) {
  const now  = new Date();
  const MONTHS = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  const YEARS = Array.from({ length: 5 }, (_, i) => String(now.getFullYear() - i));

  const [year,        setYear]        = useState(String(now.getFullYear()));
  const [month,       setMonth]       = useState(String(now.getMonth() + 1));
  const [dateFrom,    setDateFrom]    = useState('');
  const [dateTo,      setDateTo]      = useState('');
  const [userId,      setUserId]      = useState('');
  const [subregionId, setSubregionId] = useState('');
  const [users,       setUsers]       = useState([]);
  const [rows,        setRows]        = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [visitDl,     setVisitDl]     = useState({});
  const [limited,      setLimited]      = useState(false);
  const [skuLimited,   setSkuLimited]   = useState(false);
  const [perfPreviewOpen,  setPerfPreviewOpen]  = useState(false);
  const [skuPreviewOpen,   setSkuPreviewOpen]   = useState(false);
  const [visitPreviewOpen, setVisitPreviewOpen] = useState(false);
  const [visitPreviewData, setVisitPreviewData] = useState(null);
  const perfDebounceRef = useRef(null);
  const skuDebounceRef  = useRef(null);

  const [skuYear,     setSkuYear]     = useState(String(now.getFullYear()));
  const [skuMonth,    setSkuMonth]    = useState(String(now.getMonth() + 1));
  const [skuDateFrom, setSkuDateFrom] = useState('');
  const [skuDateTo,   setSkuDateTo]   = useState('');
  const [skuUserId,      setSkuUserId]      = useState('');
  const [skuSubregionId, setSkuSubregionId] = useState('');
  const [subregions,     setSubregions]     = useState([]);
  const [skuRows,     setSkuRows]     = useState([]);
  const [skuLoading,  setSkuLoading]  = useState(false);
  const [skuError,    setSkuError]    = useState('');
  const [skuView,     setSkuView]     = useState('sku');
  const [regionId,    setRegionId]    = useState(regionFilter || '');
  const [skuRegionId, setSkuRegionId] = useState(regionFilter || '');
  const [regions,     setRegions]     = useState([]);

  const [stkRegionId,    setStkRegionId]    = useState(regionFilter || '');
  const [stkSubregionId, setStkSubregionId] = useState('');
  const [stkRows,        setStkRows]        = useState([]);
  const [stkLoading,     setStkLoading]     = useState(false);
  const [stkError,       setStkError]       = useState('');
  const [stkLimited,     setStkLimited]     = useState(false);
  const [stkExpanded,    setStkExpanded]    = useState({});
  const [stkVisibleCount, setStkVisibleCount] = useState(10);
  const stkDebounceRef = useRef(null);

  const [rnsRegionId,    setRnsRegionId]    = useState(regionFilter || '');
  const [rnsSubregionId, setRnsSubregionId] = useState('');
  const [rnsUserId,      setRnsUserId]      = useState('');
  const [rnsYear,        setRnsYear]        = useState(String(now.getFullYear()));
  const [rnsMonth,       setRnsMonth]       = useState(String(now.getMonth() + 1));
  const [rnsDateFrom,    setRnsDateFrom]    = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`);
  const [rnsDateTo,      setRnsDateTo]      = useState((() => { const d = new Date(now.getFullYear(), now.getMonth()+1, 0); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })());
  const [rnsRows,        setRnsRows]        = useState([]);
  const [rnsSummaryRows, setRnsSummaryRows] = useState([]);
  const [rnsDetailRows,  setRnsDetailRows]  = useState([]);
  const [rnsDetailReason, setRnsDetailReason] = useState('');
  const [rnsFilterMode,  setRnsFilterMode]  = useState('month');
  const [rnsLoading,     setRnsLoading]     = useState(false);
  const [rnsError,       setRnsError]       = useState('');
  const [rnsLimited,     setRnsLimited]     = useState(false);
  const [rnsMeta,        setRnsMeta]        = useState({ total: 0, topReason: '', topRegion: '', totalPages: 1, page: 1 });
  const [rnsView,        setRnsView]        = useState('list');
  const [rnsMapOpen,     setRnsMapOpen]     = useState(false);
  const [rnsPreviewOpen, setRnsPreviewOpen] = useState(false);
  const [rnsPage,        setRnsPage]        = useState(1);
  const RNS_PAGE_SIZE = 10;
  const rnsDebounceRef = useRef(null);

  useEffect(() => { setRegionId(regionFilter || ''); setSkuRegionId(regionFilter || ''); setStkRegionId(regionFilter || ''); setRnsRegionId(regionFilter || ''); }, [regionFilter]);
  useEffect(() => { setUserId(''); setSubregionId(''); }, [regionId]);
  useEffect(() => { setSkuUserId(''); setSkuSubregionId(''); }, [skuRegionId]);

  useEffect(() => {
    if (!token) return;
    if (_perfCache.token === token && _perfCache.users && _perfCache.subregions) {
      setUsers(_perfCache.users);
      setSubregions(_perfCache.subregions);
      if (_perfCache.regions) setRegions(_perfCache.regions);
      return;
    }
    Promise.all([
      fetch('/api/admin/map-users', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json()),
      fetch('/api/admin/map-regions', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json()),
    ]).then(async ([userList, regList]) => {
      const regionsList = Array.isArray(regList) ? regList : [];
      const subregionList = regionsList.length
        ? (await Promise.all(
            regionsList.map(reg =>
              fetch(`/api/admin/map-regions?region_id=${reg.id}`, { headers: { Authorization: `Bearer ${token}` } })
                .then(r => r.json())
            )
          )).flat()
        : [];
      if (Array.isArray(userList)) { _perfCache.token = token; _perfCache.users = userList; setUsers(userList); }
      _perfCache.regions = regionsList; setRegions(regionsList);
      _perfCache.subregions = subregionList; setSubregions(subregions);
    });
  }, [token]);

  const isMTD = parseInt(year) === now.getFullYear() && parseInt(month) === now.getMonth() + 1;
  const isSkuMTD = parseInt(skuYear) === now.getFullYear() && parseInt(skuMonth) === now.getMonth() + 1;
  const monthLabel = `${MONTHS[parseInt(month) - 1]} ${year}`;
  const filteredUsers = regionId ? users.filter(u => (u.user_regions || []).some(r => String(r.region_id) === String(regionId))) : users;
  const filteredSubregions = regionId ? subregions.filter(s => String(s.region_id) === String(regionId)) : subregions;
  const skuFilteredUsers = skuRegionId ? users.filter(u => (u.user_regions || []).some(r => String(r.region_id) === String(skuRegionId))) : users;
  const skuFilteredSubregions = skuRegionId ? subregions.filter(s => String(s.region_id) === String(skuRegionId)) : subregions;
  const rnsFilteredUsers = rnsRegionId ? users.filter(u => (u.user_regions || []).some(r => String(r.region_id) === String(rnsRegionId))) : users;
  const rnsFilteredSubregions = rnsRegionId ? subregions.filter(s => String(s.region_id) === String(rnsRegionId)) : subregions;

  const openVisitPreview = async (row) => {
    if (visitDl[row.user_id]) return;
    setVisitDl(p => ({ ...p, [row.user_id]: true }));
    try {
      const params = new URLSearchParams({ user_id: row.user_id, year, month });
      if (dateFrom)    params.set('dateFrom',     dateFrom);
      if (dateTo)      params.set('dateTo',        dateTo);
      if (subregionId) params.set('subregion_id', subregionId);
      if (regionId)    params.set('region_id',    regionId);
      const r  = await fetch(`/api/admin/visit-detail?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const d  = await r.json();
      if (!r.ok || !Array.isArray(d) || d.length === 0) {
        alert(d?.error || 'No visit data found for this period.');
        return;
      }
      setVisitPreviewData({ row, d });
      setVisitPreviewOpen(true);
    } catch (err) {
      alert('Failed to load visit data: ' + err.message);
    } finally {
      setVisitDl(p => ({ ...p, [row.user_id]: false }));
    }
  };

  const exportVisitDetailExcel = async () => {
    if (!visitPreviewData) return;
    const { row, d } = visitPreviewData;
    try {
      const ExcelJS     = (await import('exceljs')).default;
      const wb          = new ExcelJS.Workbook();
      wb.creator        = 'Sprint App';
      wb.created        = new Date();
      const companyName = branding?.company_name || 'Sprint App';
      const themeHex    = (primary || '#2563eb').replace('#', '');
      const sheetName   = (row.full_name || 'Visits').replace(/[\\\/?*\[\]]/g, '').slice(0, 31);
      const ws          = wb.addWorksheet(sheetName, { views: [{ showGridLines: false }] });

      const SR      = 1;
      const NCOLS   = 8;

      ws.mergeCells(SR, 1, SR, NCOLS);
      const tc = ws.getCell(SR, 1);
      tc.value = companyName;
      tc.font  = { bold: true, size: 16, color: { argb: `FF${themeHex}` } };
      tc.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(SR).height = 28;

      ws.mergeCells(SR+1, 1, SR+1, NCOLS);
      const sc = ws.getCell(SR+1, 1);
      sc.value = `Visit Detail — ${row.full_name} — ${monthLabel}${dateFrom ? ` from ${dateFrom}` : ''}${dateTo ? ` to ${dateTo}` : ''}`;
      sc.font  = { size: 12, color: { argb: 'FF64748b' } };
      sc.alignment = { horizontal: 'center' };
      ws.getRow(SR+1).height = 20;
      ws.getRow(SR+2).height = 8;

      const HDR = SR + 3;
      const cols = ['#', 'Date', 'Time', 'Shop', 'Status', 'SKU', 'Product Name', 'Qty Sold / Reason Not Sold'];
      const widths = [5, 13, 10, 30, 12, 10, 30, 38];
      cols.forEach((h, i) => {
        ws.getColumn(i + 1).width = widths[i];
        const cell = ws.getCell(HDR, i + 1);
        cell.value = h;
        cell.font  = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${themeHex}` } };
        cell.alignment = { horizontal: i === 4 || i === 7 ? 'center' : i >= 5 ? 'left' : 'left', vertical: 'middle' };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFe2e8f0' } } };
      });
      ws.getRow(HDR).height = 22;

      let rowCursor = HDR + 1;
      let visitNum = 0;
      const SOLD_GREEN  = 'FFdcfce7';
      const UNSOLD_RED  = 'FFfee2e2';
      const EVEN_BG     = 'FFF8FAFC';
      const ODD_BG      = 'FFFFFFFF';

      d.forEach((visit) => {
        visitNum++;
        const dt      = new Date(visit.created_at);
        const dateStr = dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        const timeStr = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const statusLabel = visit.visit_sold ? 'Sold ✓' : 'Not Sold';
        const statusColor = visit.visit_sold ? 'FF16a34a' : 'FFdc2626';
        const rowBg       = visitNum % 2 === 0 ? EVEN_BG : ODD_BG;
        const _rawNsr = visit.items.find(i => i.not_sold_reason)?.not_sold_reason || '—';
        const notSoldReason = _rawNsr.toLowerCase() === 'other' ? 'Other (no details provided)' : _rawNsr;
        const items       = !visit.visit_sold
          ? [{ sku: 'N/A', product_name: 'N/A', sold: 0, not_sold_reason: notSoldReason }]
          : visit.items.length > 0 ? visit.items : [{ sku: '—', product_name: 'No activity recorded', sold: 0, not_sold_reason: '' }];

        items.forEach((item, iIdx) => {
          const isFirst = iIdx === 0;
          const skuBg   = item.sold > 0 ? SOLD_GREEN : (item.not_sold_reason ? UNSOLD_RED : rowBg);

          const vals = [
            isFirst ? visitNum : '',
            isFirst ? dateStr  : '',
            isFirst ? timeStr  : '',
            isFirst ? `${visit.shop_name}${visit.shop_location ? ' — ' + visit.shop_location : ''}` : '',
            isFirst ? statusLabel : '',
            item.sku,
            item.product_name,
            item.sold > 0 ? `${item.sold} ctn` : (item.not_sold_reason || '—'),
          ];

          vals.forEach((v, ci) => {
            const cell = ws.getCell(rowCursor, ci + 1);
            cell.value = v;
            cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: ci >= 5 ? skuBg : rowBg } };
            cell.font = ci === 4 && isFirst
              ? { bold: true, size: 10, color: { argb: statusColor } }
              : ci === 7
              ? { size: 10, color: { argb: item.sold > 0 ? 'FF16a34a' : (item.not_sold_reason ? 'FFdc2626' : 'FF94a3b8') } }
              : { size: 10, color: { argb: 'FF334155' } };
            cell.alignment = { horizontal: ci === 4 ? 'center' : 'left', vertical: 'middle', wrapText: ci === 7 };
            cell.border = {
              bottom: { style: 'hair', color: { argb: 'FFe2e8f0' } },
              ...(ci === 0 ? { left: { style: 'thin', color: { argb: 'FFe2e8f0' } } } : {}),
            };
          });
          ws.getRow(rowCursor).height = 18;
          rowCursor++;
        });

        const sepCell = ws.getCell(rowCursor, 1);
        ws.mergeCells(rowCursor, 1, rowCursor, NCOLS);
        sepCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf1f5f9' } };
        ws.getRow(rowCursor).height = 4;
        rowCursor++;
      });

      const totalVisits  = d.length;
      const soldVisits   = d.filter(v => v.visit_sold).length;
      const totalCartons = d.reduce((a, b) => a + b.total_sold_cartons, 0);

      ws.mergeCells(rowCursor, 1, rowCursor, NCOLS);
      const sumCell = ws.getCell(rowCursor, 1);
      sumCell.value = `Total: ${totalVisits} visits • ${soldVisits} sold • ${totalCartons.toLocaleString()} cartons`;
      sumCell.font  = { bold: true, size: 10, color: { argb: `FF${themeHex}` } };
      sumCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf8fafc' } };
      sumCell.alignment = { horizontal: 'center' };
      ws.getRow(rowCursor).height = 22;
      rowCursor++;

      ws.mergeCells(rowCursor, 1, rowCursor, NCOLS);
      const ftCell = ws.getCell(rowCursor, 1);
      ftCell.value = '';
      ftCell.font  = { italic: true, size: 9, color: { argb: 'FF94a3b8' } };
      ftCell.alignment = { horizontal: 'center' };

      const buf  = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `visits-${(row.full_name || 'salesperson').replace(/\s+/g,'-').toLowerCase()}-${year}-${String(month).padStart(2,'0')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Failed to generate Excel: ' + err.message);
    } finally {
      setVisitDl(p => ({ ...p, [row.user_id]: false }));
    }
  };

  const handleExcelExport = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sprint App';
    wb.created = new Date();
    const ws = wb.addWorksheet('Performance', { views: [{ showGridLines: false }] });

    const companyName = branding?.company_name || 'Sprint App';
    const themeHex    = (primary || '#2563eb').replace('#', '');

    const startRow = 1;

    ws.mergeCells(startRow, 1, startRow, 8);
    const titleCell = ws.getCell(startRow, 1);
    titleCell.value = companyName;
    titleCell.font  = { bold: true, size: 16, color: { argb: `FF${themeHex}` } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(startRow).height = 28;

    ws.mergeCells(startRow + 1, 1, startRow + 1, 8);
    const repCell = ws.getCell(startRow + 1, 1);
    repCell.value = `Performance Report — ${monthLabel}${dateFrom || dateTo ? ` (${dateFrom || ''}${dateFrom && dateTo ? ' → ' : ''}${dateTo || ''})` : ''}${subregionId ? ` • Subregion filtered` : ''}`;
    repCell.font  = { bold: false, size: 12, color: { argb: 'FF64748b' } };
    repCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(startRow + 1).height = 20;

    ws.getRow(startRow + 2).height = 8;

    const hdrRow = startRow + 3;
    const headers = ['#', 'Salesperson', 'Visits', 'Shops Sold', 'Shops Not Sold', 'Cartons Sold', 'Target (ctn)', 'Performance %'];
    const colWidths = [5, 28, 10, 13, 16, 14, 14, 15];
    headers.forEach((h, i) => {
      ws.getColumn(i + 1).width = colWidths[i];
      const cell = ws.getCell(hdrRow, i + 1);
      cell.value = h;
      cell.font  = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${themeHex}` } };
      cell.alignment = { horizontal: i >= 2 ? 'center' : 'left', vertical: 'middle' };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFe2e8f0' } } };
    });
    ws.getRow(hdrRow).height = 22;

    rows.forEach((row, idx) => {
      const r = hdrRow + 1 + idx;
      const isEven = idx % 2 === 0;
      const bg  = isEven ? 'FFF8FAFC' : 'FFFFFFFF';
      const pctVal = row.performance_pct;
      const pctColor = pctVal === null ? 'FF94a3b8'
        : pctVal >= 100 ? 'FF16a34a'
        : pctVal >= 75  ? 'FFf59e0b'
        : pctVal >= 50  ? 'FFf97316'
        : 'FFdc2626';

      const cells = [
        idx + 1,
        row.full_name,
        row.visits_total,
        row.shops_sold,
        row.shops_not_sold,
        row.cartons_sold_mtd,
        row.cartons_target ?? 'Not set',
        pctVal !== null ? `${pctVal}%` : '—',
      ];

      cells.forEach((val, ci) => {
        const cell = ws.getCell(r, ci + 1);
        cell.value = val;
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.font  = ci === 7
          ? { bold: true, size: 11, color: { argb: pctColor } }
          : { size: 11, color: { argb: 'FF334155' } };
        cell.alignment = { horizontal: ci >= 2 ? 'center' : 'left', vertical: 'middle' };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFe2e8f0' } } };
      });
      ws.getRow(r).height = 20;
    });

    const footerRow = hdrRow + 1 + rows.length + 1;
    ws.mergeCells(footerRow, 1, footerRow, 8);
    const footerCell = ws.getCell(footerRow, 1);
    footerCell.value = '';
    footerCell.font  = { italic: true, size: 9, color: { argb: 'FF94a3b8' } };
    footerCell.alignment = { horizontal: 'center' };
    ws.getRow(footerRow).height = 18;

    const buf  = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `performance-${year}-${String(month).padStart(2,'0')}${dateFrom ? `-from${dateFrom}` : ''}${dateTo ? `-to${dateTo}` : ''}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadData = async () => {
    const cacheKey = `${token}:${year}:${month}:${userId}:${subregionId}:${regionId}:${dateFrom}:${dateTo}`;
    if (_perfCache.key === cacheKey && _perfCache.data) {
      setRows(_perfCache.data);
      setLimited(_perfCache.limited || false);
      return;
    }
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ year, month });
      if (userId)      params.set('user_id',      userId);
      if (subregionId) params.set('subregion_id', subregionId);
      if (regionId)    params.set('region_id',    regionId);
      if (dateFrom)    params.set('dateFrom',      dateFrom);
      if (dateTo)      params.set('dateTo',        dateTo);
      const r = await fetch(`/api/admin/performance?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const lim = r.headers.get('X-Data-Limited') === 'true';
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Failed to load'); return; }
      _perfCache.key = cacheKey;
      _perfCache.data = d;
      _perfCache.limited = lim;
      setLimited(lim);
      setRows(d);
    } catch { setError('Network error.'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!token) return;
    clearTimeout(perfDebounceRef.current);
    perfDebounceRef.current = setTimeout(() => { loadData(); }, 400);
    return () => clearTimeout(perfDebounceRef.current);
  }, [token, year, month, userId, subregionId, regionId, dateFrom, dateTo]);

  const loadSkuData = async () => {
    const skuKey = `${token}:${skuYear}:${skuMonth}:${skuDateFrom}:${skuDateTo}:${skuUserId}:${skuSubregionId}:${skuRegionId}`;
    if (_skuCache.key === skuKey && _skuCache.data) {
      setSkuRows(_skuCache.data);
      setSkuLimited(_skuCache.limited || false);
      return;
    }
    setSkuLoading(true); setSkuError('');
    try {
      const params = new URLSearchParams({ year: skuYear, month: skuMonth });
      if (skuDateFrom)     params.set('dateFrom',     skuDateFrom);
      if (skuDateTo)        params.set('dateTo',       skuDateTo);
      if (skuUserId)        params.set('user_id',      skuUserId);
      if (skuSubregionId)   params.set('subregion_id', skuSubregionId);
      if (skuRegionId)      params.set('region_id',    skuRegionId);
      const r = await fetch(`/api/admin/sku-analysis?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const lim = r.headers.get('X-Data-Limited') === 'true';
      const d = await r.json();
      if (!r.ok) { setSkuError(d.error || 'Failed to load'); return; }
      _skuCache.key = skuKey; _skuCache.data = d; _skuCache.limited = lim;
      setSkuLimited(lim);
      setSkuRows(d);
    } catch { setSkuError('Network error.'); }
    finally { setSkuLoading(false); }
  };

  useEffect(() => {
    if (!token) return;
    clearTimeout(skuDebounceRef.current);
    skuDebounceRef.current = setTimeout(() => { loadSkuData(); }, 400);
    return () => clearTimeout(skuDebounceRef.current);
  }, [token, skuYear, skuMonth, skuDateFrom, skuDateTo, skuUserId, skuSubregionId, skuRegionId]);

  const loadStkData = async () => {
    const stkKey = `${token}:${stkRegionId}:${stkSubregionId}`;
    if (_stkCache.key === stkKey && _stkCache.data) {
      setStkRows(_stkCache.data);
      setStkLimited(_stkCache.limited || false);
      return;
    }
    setStkLoading(true); setStkError('');
    try {
      const params = new URLSearchParams();
      if (stkRegionId)    params.set('region_id',    stkRegionId);
      if (stkSubregionId) params.set('subregion_id', stkSubregionId);
      const r = await fetch(`/api/admin/stock-position?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const lim = r.headers.get('X-Data-Limited') === 'true';
      const d = await r.json();
      if (!r.ok) { setStkError(d.error || 'Failed to load'); return; }
      _stkCache.key = stkKey; _stkCache.data = d; _stkCache.limited = lim;
      setStkLimited(lim);
      setStkRows(d);
      setStkVisibleCount(10);
    } catch { setStkError('Network error.'); }
    finally { setStkLoading(false); }
  };

  useEffect(() => {
    if (!token) return;
    clearTimeout(stkDebounceRef.current);
    stkDebounceRef.current = setTimeout(() => { loadStkData(); }, 400);
    return () => clearTimeout(stkDebounceRef.current);
  }, [token, stkRegionId, stkSubregionId]);

  const normalizeRnsPayload = (d) => {
    if (!d || typeof d !== 'object') return { summaryRows: [], detailRows: [] };
    if (Array.isArray(d)) {
      const summaryRows = d.length > 0 && d.every(item => item && typeof item === 'object' && typeof item.count === 'number' && typeof item.reason === 'string')
        ? d
        : [];
      const detailRows = summaryRows.length > 0
        ? summaryRows.flatMap(item => item.rows || [])
        : d.filter(item => item && typeof item === 'object' && item.visit_id);
      return { summaryRows, detailRows };
    }

    const summaryRows = Array.isArray(d.summary_rows) ? d.summary_rows : [];
    const detailRows = Array.isArray(d.detail_rows)
      ? d.detail_rows
      : summaryRows.flatMap(item => item.rows || []);
    return { summaryRows, detailRows };
  };

  const loadRnsData = async (page = 1) => {
    const rnsKey = `${token}:${rnsRegionId}:${rnsSubregionId}:${rnsUserId}:${rnsFilterMode}:${rnsYear}:${rnsMonth}:${rnsDateFrom}:${rnsDateTo}:${page}:${RNS_PAGE_SIZE}`;
    if (_rnsCache.key === rnsKey && _rnsCache.data) {
      const payload = normalizeRnsPayload(_rnsCache.data);
      setRnsSummaryRows(payload.summaryRows);
      setRnsRows(payload.detailRows);
      setRnsLimited(_rnsCache.limited || false);
      setRnsMeta(_rnsCache.meta || { total: 0, topReason: '', topRegion: '', totalPages: 1, page: 1 });
      setRnsPage(page);
      return;
    }
    setRnsLoading(true); setRnsError('');
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('per_page', String(RNS_PAGE_SIZE));
      if (rnsRegionId)    params.set('region_id',    rnsRegionId);
      if (rnsSubregionId) params.set('subregion_id', rnsSubregionId);
      if (rnsUserId)      params.set('user_id',      rnsUserId);
      if (rnsFilterMode === 'range') {
        params.set('filter_mode', 'range');
        if (rnsDateFrom) params.set('date_from', rnsDateFrom);
        if (rnsDateTo)   params.set('date_to',   rnsDateTo);
      } else {
        params.set('filter_mode', 'month');
        const isDefaultMonth = String(rnsYear) === String(now.getFullYear()) && String(rnsMonth) === String(now.getMonth() + 1);
        if (!isDefaultMonth) {
          params.set('year', rnsYear);
          params.set('month', rnsMonth);
        }
      }
      const r = await fetch(`/api/admin/reasons-not-sold?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const limited    = r.headers.get('X-Data-Limited') === 'true';
      const total      = parseInt(r.headers.get('X-Total-Count') || '0', 10);
      const totalPages = parseInt(r.headers.get('X-Total-Pages') || '1', 10);
      const topReason  = r.headers.get('X-Top-Reason') || '';
      const topRegion  = r.headers.get('X-Top-Region') || '';
      const d = await r.json();
      if (!r.ok) { setRnsError(d.error || 'Failed to load'); return; }
      const meta = { total, topReason, topRegion, totalPages, page };
      const payload = normalizeRnsPayload(d);
      _rnsCache.key = rnsKey; _rnsCache.data = d; _rnsCache.limited = limited; _rnsCache.meta = meta;
      setRnsSummaryRows(payload.summaryRows);
      setRnsRows(payload.detailRows);
      setRnsLimited(limited); setRnsMeta(meta); setRnsPage(page);
    } catch { setRnsError('Network error.'); }
    finally { setRnsLoading(false); }
  };

  useEffect(() => {
    if (!token) return;
    clearTimeout(rnsDebounceRef.current);
    rnsDebounceRef.current = setTimeout(() => { loadRnsData(1); }, 400);
    return () => clearTimeout(rnsDebounceRef.current);
  }, [token, rnsRegionId, rnsSubregionId, rnsUserId, rnsYear, rnsMonth, rnsDateFrom, rnsDateTo, rnsFilterMode]);

  const exportRnsExcel = async (rowsToExport = rnsDetailRows, reasonLabel = rnsDetailReason) => {
    const exportRows = Array.isArray(rowsToExport) ? rowsToExport : [];
    if (!exportRows.length) return;
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sprint App';
    wb.created = new Date();
    const ws = wb.addWorksheet('Reasons Not Sold', { views: [{ showGridLines: false }] });

    const companyName = branding?.company_name || 'Sprint App';
    const themeHex    = (primary || '#2563eb').replace('#', '');
    const periodLabel = rnsDateFrom || rnsDateTo
      ? `${rnsDateFrom || ''} → ${rnsDateTo || ''}`
      : `${MONTHS[parseInt(rnsMonth) - 1]}-${rnsYear}`;
    const filterLabel = [
      regions.find(r => String(r.id) === rnsRegionId)?.name,
      rnsFilteredSubregions.find(s => String(s.id) === rnsSubregionId)?.name,
      rnsFilteredUsers.find(u => u.id === rnsUserId)?.full_name,
    ].filter(Boolean).join(' · ') || 'All';

    ws.mergeCells('A1:F1');
    const titleCell = ws.getCell('A1');
    titleCell.value = reasonLabel ? `${companyName} — ${reasonLabel}` : `${companyName} — Reasons Not Sold`;
    titleCell.font  = { bold: true, size: 15, color: { argb: `FF${themeHex}` } };
    titleCell.alignment = { horizontal: 'center' };
    ws.getRow(1).height = 28;

    ws.mergeCells('A2:F2');
    const subCell = ws.getCell('A2');
    subCell.value = `Period: ${periodLabel}  |  Filter: ${filterLabel}`;
    subCell.font  = { size: 10, color: { argb: 'FF64748B' } };
    subCell.alignment = { horizontal: 'center' };
    ws.getRow(2).height = 18;

    ws.addRow([]);

    const headers = ['#', 'Shop Name', 'Subregion', 'Salesperson', 'Visit Date', 'Reason Not Sold'];
    const headerRow = ws.addRow(headers);
    headerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${themeHex}` } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
    });
    headerRow.height = 22;

    exportRows.forEach((row, i) => {
      const dr = ws.addRow([
        i + 1,
        row.shop_name + (row.shop_location ? ` (${row.shop_location})` : ''),
        row.subregion_name || '—',
        row.salesperson_name,
        new Date(row.visited_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        row.reason,
      ]);
      const bg = i % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
      dr.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.font = { size: 10 };
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
      });
      dr.height = 18;
    });

    ws.columns = [
      { width: 5 }, { width: 28 }, { width: 18 }, { width: 22 }, { width: 22 }, { width: 36 },
    ];

    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a   = document.createElement('a');
    a.href = url; a.download = `reasons-not-sold-${(reasonLabel || 'all').replace(/\s+/g, '-').toLowerCase()}.xlsx`;
    a.click(); URL.revokeObjectURL(url);
  };

  const handleSkuExcelExport = async () => {
    if (!skuRows.length) return;
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sprint App';
    wb.created = new Date();
    const ws = wb.addWorksheet('SKU Analysis', { views: [{ showGridLines: false }] });

    const companyName = branding?.company_name || 'Sprint App';
    const themeHex    = (primary || '#2563eb').replace('#', '');
    const periodLabel = `${MONTHS[parseInt(skuMonth) - 1]} ${skuYear}`;

    const startRow = 1;
    const totalCols = 5;

    ws.mergeCells(startRow, 1, startRow, totalCols);
    const titleCell = ws.getCell(startRow, 1);
    titleCell.value = companyName;
    titleCell.font  = { bold: true, size: 16, color: { argb: `FF${themeHex}` } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(startRow).height = 28;

    ws.mergeCells(startRow + 1, 1, startRow + 1, totalCols);
    const repCell = ws.getCell(startRow + 1, 1);
    repCell.value = `SKU Analysis — ${periodLabel}`;
    repCell.font  = { bold: false, size: 12, color: { argb: 'FF64748b' } };
    repCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(startRow + 1).height = 20;

    ws.getRow(startRow + 2).height = 8;

    const hdrRow = startRow + 3;
    const totalSold = skuRows.reduce((a, b) => a + b.total_sold, 0);
    const colWidths = [5, 14, 36, 16, 12];
    const headers   = ['#', 'SKU', 'Product Name', 'Cartons Sold', 'Visits'];
    headers.forEach((h, i) => {
      ws.getColumn(i + 1).width = colWidths[i];
      const cell = ws.getCell(hdrRow, i + 1);
      cell.value = h;
      cell.font  = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${themeHex}` } };
      cell.alignment = { horizontal: i >= 3 ? 'center' : 'left', vertical: 'middle' };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFe2e8f0' } } };
    });
    ws.getRow(hdrRow).height = 22;

    skuRows.forEach((s, idx) => {
      const r = hdrRow + 1 + idx;
      const pct = totalSold > 0 ? Math.round(s.total_sold / totalSold * 100) : 0;
      const bg  = idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF';
      const cells = [idx + 1, s.sku, s.name, s.total_sold, s.visits_count];
      cells.forEach((val, ci) => {
        const cell = ws.getCell(r, ci + 1);
        cell.value = val;
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.font  = ci === 3
          ? { bold: true, size: 11, color: { argb: `FF${themeHex}` } }
          : { size: 11, color: { argb: 'FF334155' } };
        cell.alignment = { horizontal: ci >= 3 ? 'center' : 'left', vertical: 'middle' };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFe2e8f0' } } };
      });
      ws.getRow(r).height = 20;
    });

    const totRow = hdrRow + 1 + skuRows.length;
    ['TOTAL', '', '', totalSold, skuRows.reduce((a, b) => a + b.visits_count, 0)].forEach((val, ci) => {
      const cell = ws.getCell(totRow, ci + 1);
      cell.value = val;
      cell.font  = { bold: true, size: 11, color: { argb: 'FF0f172a' } };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf1f5f9' } };
      cell.alignment = { horizontal: ci >= 3 ? 'center' : 'left', vertical: 'middle' };
      cell.border = { top: { style: 'thin', color: { argb: `FF${themeHex}` } } };
    });
    ws.getRow(totRow).height = 22;

    const skuCount = skuRows.length;
    if (skuCount > 0) {
      const ws2 = wb.addWorksheet('By Salesperson', { views: [{ showGridLines: false }] });
      const personMap = {};
      skuRows.forEach(s => {
        s.by_salesperson.forEach(p => {
          if (!personMap[p.user_id]) personMap[p.user_id] = { user_id: p.user_id, full_name: p.full_name };
        });
      });
      const persons = Object.values(personMap);
      const pivotHdrRow = 1;
      const pivotHeaders = ['#', 'Salesperson', ...skuRows.map(s => s.sku), 'Total'];
      pivotHeaders.forEach((h, i) => {
        ws2.getColumn(i + 1).width = i === 0 ? 5 : i === 1 ? 28 : 12;
        const cell = ws2.getCell(pivotHdrRow, i + 1);
        cell.value = h;
        cell.font  = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${themeHex}` } };
        cell.alignment = { horizontal: i >= 2 ? 'center' : 'left', vertical: 'middle' };
      });
      ws2.getRow(pivotHdrRow).height = 22;

      persons.sort((a, b) => {
        const ta = skuRows.reduce((s, r) => s + (r.by_salesperson.find(p => p.user_id === a.user_id)?.sold || 0), 0);
        const tb = skuRows.reduce((s, r) => s + (r.by_salesperson.find(p => p.user_id === b.user_id)?.sold || 0), 0);
        return tb - ta;
      });

      persons.forEach((person, idx) => {
        const r = pivotHdrRow + 1 + idx;
        const bg = idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF';
        let rowTotal = 0;
        const cells = [
          idx + 1,
          person.full_name,
          ...skuRows.map(s => {
            const found = s.by_salesperson.find(p => p.user_id === person.user_id);
            rowTotal += found?.sold || 0;
            return found?.sold || 0;
          }),
        ];
        cells.push(rowTotal);
        cells.forEach((val, ci) => {
          const cell = ws2.getCell(r, ci + 1);
          cell.value = val === 0 && ci >= 2 ? null : val;
          cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
          cell.font  = ci === cells.length - 1
            ? { bold: true, size: 11, color: { argb: `FF${themeHex}` } }
            : { size: 11, color: { argb: val === 0 && ci >= 2 ? 'FFcbd5e1' : 'FF334155' } };
          cell.alignment = { horizontal: ci >= 2 ? 'center' : 'left', vertical: 'middle' };
          cell.border = { bottom: { style: 'hair', color: { argb: 'FFe2e8f0' } } };
        });
        ws2.getRow(r).height = 20;
      });
    }

    if (skuRows.length > 0) {
      const ws3 = wb.addWorksheet('By Subregion', { views: [{ showGridLines: false }] });
      const subMap = {};
      skuRows.forEach(s => {
        s.by_subregion.forEach(sr => {
          if (!subMap[sr.subregion_id]) subMap[sr.subregion_id] = { subregion_id: sr.subregion_id, subregion_name: sr.subregion_name };
        });
      });
      const subs = Object.values(subMap);
      subs.sort((a, b) => {
        const ta = skuRows.reduce((s, r) => s + (r.by_subregion.find(sr => sr.subregion_id === a.subregion_id)?.sold || 0), 0);
        const tb = skuRows.reduce((s, r) => s + (r.by_subregion.find(sr => sr.subregion_id === b.subregion_id)?.sold || 0), 0);
        return tb - ta;
      });

      const pivotHdrRow3 = 1;
      const pivotHeaders3 = ['#', 'Subregion', ...skuRows.map(s => s.sku), 'Total'];
      pivotHeaders3.forEach((h, i) => {
        ws3.getColumn(i + 1).width = i === 0 ? 5 : i === 1 ? 28 : 12;
        const cell = ws3.getCell(pivotHdrRow3, i + 1);
        cell.value = h;
        cell.font  = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${themeHex}` } };
        cell.alignment = { horizontal: i >= 2 ? 'center' : 'left', vertical: 'middle' };
      });
      ws3.getRow(pivotHdrRow3).height = 22;

      subs.forEach((sub, idx) => {
        const r = pivotHdrRow3 + 1 + idx;
        const bg = idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF';
        let rowTotal = 0;
        const cells = [
          idx + 1,
          sub.subregion_name,
          ...skuRows.map(s => {
            const found = s.by_subregion.find(sr => sr.subregion_id === sub.subregion_id);
            rowTotal += found?.sold || 0;
            return found?.sold || 0;
          }),
        ];
        cells.push(rowTotal);
        cells.forEach((val, ci) => {
          const cell = ws3.getCell(r, ci + 1);
          cell.value = val === 0 && ci >= 2 ? null : val;
          cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
          cell.font  = ci === cells.length - 1
            ? { bold: true, size: 11, color: { argb: `FF${themeHex}` } }
            : { size: 11, color: { argb: val === 0 && ci >= 2 ? 'FFcbd5e1' : 'FF334155' } };
          cell.alignment = { horizontal: ci >= 2 ? 'center' : 'left', vertical: 'middle' };
          cell.border = { bottom: { style: 'hair', color: { argb: 'FFe2e8f0' } } };
        });
        ws3.getRow(r).height = 20;
      });

      const totRow3 = pivotHdrRow3 + 1 + subs.length;
      ['TOTAL', '', ...skuRows.map(s => s.total_sold), skuRows.reduce((a, b) => a + b.total_sold, 0)].forEach((val, ci) => {
        const cell = ws3.getCell(totRow3, ci + 1);
        cell.value = val;
        cell.font  = { bold: true, size: 11, color: { argb: 'FF0f172a' } };
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf1f5f9' } };
        cell.alignment = { horizontal: ci >= 2 ? 'center' : 'left', vertical: 'middle' };
        cell.border = { top: { style: 'thin', color: { argb: `FF${themeHex}` } } };
      });
      ws3.getRow(totRow3).height = 22;
    }

    const footerRow = hdrRow + 1 + skuRows.length + 2;
    ws.mergeCells(footerRow, 1, footerRow, totalCols);
    const footerCell = ws.getCell(footerRow, 1);
    footerCell.value = '';
    footerCell.font  = { italic: true, size: 9, color: { argb: 'FF94a3b8' } };
    footerCell.alignment = { horizontal: 'center' };
    ws.getRow(footerRow).height = 18;

    const buf  = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `sku-analysis-${skuYear}-${String(skuMonth).padStart(2, '0')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalSold   = rows.reduce((s, r) => s + r.cartons_sold_mtd, 0);
  const totalTarget = rows.reduce((s, r) => s + (r.cartons_target || 0), 0);
  const overallPct  = totalTarget > 0 ? Math.round((totalSold / totalTarget) * 100) : null;
  const withTarget  = rows.filter(r => r.cartons_target > 0).length;
  const onTrack     = rows.filter(r => r.performance_pct >= 100).length;

  const pctColor = (pct) => {
    if (pct === null) return { bar: '#e2e8f0', text: '#94a3b8' };
    if (pct >= 100)  return { bar: '#16a34a', text: '#166534' };
    if (pct >= 75)   return { bar: '#f59e0b', text: '#92400e' };
    if (pct >= 50)   return { bar: '#f97316', text: '#9a3412' };
    return               { bar: '#dc2626', text: '#991b1b' };
  };

  return (
    <div className={styles.perfWrap}>
      <div className={styles.perfHeader}>
        <div>
          <h2 className={styles.perfTitle}>🏆 Performance</h2>
          <p className={styles.perfSubtitle}>
            Cartons sold {isMTD ? 'MTD' : 'in period'} vs monthly target
            {isMTD && <span className={styles.perfMtdBadge}>LIVE</span>}
          </p>
        </div>
        <div className={styles.perfFilters}>
          <select className={styles.perfSelect} value={year} onChange={e => setYear(e.target.value)}>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className={styles.perfSelect} value={month} onChange={e => setMonth(e.target.value)}>
            {MONTHS.map((name, i) => <option key={i+1} value={String(i+1)}>{name}</option>)}
          </select>
          <input type="date" className={styles.perfSelect} style={{ minWidth: 130 }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <input type="date" className={styles.perfSelect} style={{ minWidth: 130 }} value={dateTo}   onChange={e => setDateTo(e.target.value)} />
          <select className={styles.perfSelect} value={regionId} onChange={e => setRegionId(e.target.value)}>
            <option value="">All Regions</option>
            {regions.map(r => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
          </select>
          <select className={styles.perfSelect} value={userId} onChange={e => setUserId(e.target.value)}>
            <option value="">All Salespersons</option>
            {filteredUsers.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
          </select>
          <select className={styles.perfSelect} value={subregionId} onChange={e => setSubregionId(e.target.value)}>
            <option value="">All Subregions</option>
            {filteredSubregions.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </select>
          <button className={styles.perfRefreshBtn} style={{ background: primary }} onClick={loadData} disabled={loading}>
            {loading ? '⏳' : '🔄'} Refresh
          </button>
          <button
            className={styles.perfExcelBtn}
            onClick={() => setPerfPreviewOpen(true)}
            disabled={rows.length === 0 || loading}
            title="Preview Report"
          >
            👁 Preview Report
          </button>
        </div>
      </div>

      {error && <div className={styles.alertDanger} style={{ margin: '0 0 16px' }}>{error}</div>}

      {rows.length > 0 && (
        <div className={styles.perfSummary}>
          <div className={styles.perfSummaryCard} style={{ borderTop: `4px solid ${primary}` }}>
            <div className={styles.perfSummaryVal}>{totalSold.toLocaleString()}</div>
            <div className={styles.perfSummaryLabel}>Total cartons sold</div>
          </div>
          <div className={styles.perfSummaryCard} style={{ borderTop: '4px solid #6366f1' }}>
            <div className={styles.perfSummaryVal}>{totalTarget.toLocaleString()}</div>
            <div className={styles.perfSummaryLabel}>Total target ({monthLabel})</div>
          </div>
          <div className={styles.perfSummaryCard} style={{ borderTop: `4px solid ${overallPct >= 100 ? '#16a34a' : overallPct >= 75 ? '#f59e0b' : '#dc2626'}` }}>
            <div className={styles.perfSummaryVal}>{overallPct !== null ? `${overallPct}%` : '—'}</div>
            <div className={styles.perfSummaryLabel}>Overall performance</div>
          </div>
          <div className={styles.perfSummaryCard} style={{ borderTop: '4px solid #16a34a' }}>
            <div className={styles.perfSummaryVal}>{onTrack} / {withTarget}</div>
            <div className={styles.perfSummaryLabel}>On target (≥ 100%)</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className={styles.perfLoading}>⏳ Loading performance data…</div>
      ) : rows.length === 0 ? (
        <div className={styles.perfEmpty}>No data found for this period.</div>
      ) : (
        <div className={styles.perfTableWrap}>
          <table className={styles.perfTable}>
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>Salesperson</th>
                <th className={styles.perfThNum}>Visits</th>
                <th className={styles.perfThNum}>Shops Sold</th>
                <th className={styles.perfThNum}>Shops Not Sold</th>
                <th className={styles.perfThNum}>Cartons Sold</th>
                <th className={styles.perfThNum}>Target</th>
                <th style={{ minWidth: 160 }}>Performance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const clr  = pctColor(row.performance_pct);
                const pct  = row.performance_pct;
                const barW = pct !== null ? Math.min(pct, 100) : 0;

                return (
                  <tr key={row.user_id} className={styles.perfRow}>
                    <td className={styles.perfIdx}>{idx + 1}</td>
                    <td>
                      <div className={styles.perfPersonCell}>
                        <div className={styles.perfAvatar} style={isManager && row.avatar_url ? { padding: 0, overflow: 'hidden', background: 'transparent' } : { background: primary }}>
                          {isManager && row.avatar_url
                            ? <img src={row.avatar_url} alt={row.full_name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%', display: 'block' }} />
                            : (row.full_name || 'U').charAt(0).toUpperCase()
                          }
                        </div>
                        <div>
                          <div className={styles.perfPersonName}>
                            {row.full_name}
                            {pct !== null && (
                              <span
                                className={styles.perfPctBadge}
                                style={{ background: clr.bar + '22', color: clr.text, border: `1px solid ${clr.bar}44` }}
                              >
                                {pct}%
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className={styles.perfNumCell}>
                      <button
                        className={styles.perfVisitBtn}
                        title={`Download visit detail for ${row.full_name}`}
                        onClick={() => openVisitPreview(row)}
                        disabled={!!visitDl[row.user_id]}
                      >
                        {visitDl[row.user_id] ? <span className={styles.perfVisitBtnSpinner}>⏳</span> : row.visits_total}
                        {!visitDl[row.user_id] && <span className={styles.perfVisitBtnIcon}>⬇</span>}
                      </button>
                    </td>
                    <td className={styles.perfNumCell}>
                      <span className={styles.perfPill} style={{ background: '#dcfce7', color: '#166534' }}>
                        {row.shops_sold}
                      </span>
                    </td>
                    <td className={styles.perfNumCell}>
                      <span className={styles.perfPill} style={{ background: '#fee2e2', color: '#991b1b' }}>
                        {row.shops_not_sold}
                      </span>
                    </td>
                    <td className={styles.perfNumCell}>
                      <strong style={{ color: '#0f172a' }}>{row.cartons_sold_mtd.toLocaleString()}</strong>
                      <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}> ctn</span>
                    </td>
                    <td className={styles.perfNumCell}>
                      {row.cartons_target != null
                        ? <>{row.cartons_target.toLocaleString()} <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}>ctn</span></>
                        : <span style={{ color: '#cbd5e1' }}>— not set</span>}
                    </td>
                    <td style={{ padding: '14px 10px' }}>
                      <div className={styles.perfBarRow}>
                        <div className={styles.perfBarTrack}>
                          <div
                            className={styles.perfBarFill}
                            style={{ width: `${barW}%`, background: clr.bar }}
                          />
                          {pct !== null && pct > 100 && (
                            <div className={styles.perfBarOverflow}
                              style={{ width: `${Math.min(pct - 100, 50)}%`, background: '#bbf7d0' }}
                            />
                          )}
                        </div>
                        <span className={styles.perfPctLabel} style={{ color: clr.text }}>
                          {pct !== null ? `${pct}%` : '—'}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.skuSection}>
        <div className={styles.skuSectionHeader}>
          <div>
            <div className={styles.skuSectionTitle}>📊 SKU Analysis</div>
            <div className={styles.skuSectionSubtitle}>
              Cartons sold per SKU — filter by salesperson, subregion &amp; date range
              {isSkuMTD && <span className={styles.perfMtdBadge} style={{ marginLeft: 8 }}>LIVE</span>}
            </div>
          </div>
          <div className={styles.skuViewToggle}>
            <button
              className={`${styles.skuViewBtn} ${skuView === 'sku' ? styles.skuViewBtnActive : ''}`}
              onClick={() => setSkuView('sku')}
            >📦 By SKU</button>
            <button
              className={`${styles.skuViewBtn} ${skuView === 'person' ? styles.skuViewBtnActive : ''}`}
              onClick={() => setSkuView('person')}
            >👤 By Salesperson</button>
          </div>
        </div>

        <div className={styles.skuFilterBar}>
          <select className={styles.perfSelect} value={skuYear} onChange={e => setSkuYear(e.target.value)}>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className={styles.perfSelect} value={skuMonth} onChange={e => setSkuMonth(e.target.value)}>
            {MONTHS.map((name, i) => <option key={i+1} value={String(i+1)}>{name}</option>)}
          </select>
          <input
            type="date"
            className={styles.perfSelect}
            style={{ minWidth: 130 }}
            value={skuDateFrom}
            onChange={e => setSkuDateFrom(e.target.value)}
          />
          <input
            type="date"
            className={styles.perfSelect}
            style={{ minWidth: 130 }}
            value={skuDateTo}
            onChange={e => setSkuDateTo(e.target.value)}
          />
          <select className={styles.perfSelect} value={skuRegionId} onChange={e => setSkuRegionId(e.target.value)}>
            <option value="">All Regions</option>
            {regions.map(r => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
          </select>
          <select className={styles.perfSelect} value={skuUserId} onChange={e => setSkuUserId(e.target.value)}>
            <option value="">All Salespersons</option>
            {skuFilteredUsers.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
          </select>
          <select className={styles.perfSelect} value={skuSubregionId} onChange={e => setSkuSubregionId(e.target.value)}>
            <option value="">All Subregions</option>
            {skuFilteredSubregions.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </select>
          <button
            className={styles.perfRefreshBtn}
            style={{ background: primary }}
            onClick={loadSkuData}
            disabled={skuLoading}
          >
            {skuLoading ? '⏳' : '🔄'} Refresh
          </button>
          <button
            className={styles.perfExcelBtn}
            onClick={() => setSkuPreviewOpen(true)}
            disabled={skuLoading || skuRows.length === 0}
          >
            👁 Preview Report
          </button>
        </div>

        {skuError && <div className={styles.alertDanger} style={{ margin: '0 0 16px' }}>{skuError}</div>}

        {!skuLoading && skuRows.length > 0 && (() => {
          const totalCtn = skuRows.reduce((a, b) => a + b.total_sold, 0);
          const topSku   = skuRows[0];
          const totalVisits = skuRows.reduce((a, b) => a + b.visits_count, 0);
          return (
            <div className={styles.skuSummary}>
              <div className={styles.skuSummaryItem}>
                <span className={styles.skuSummaryVal}>{totalCtn.toLocaleString()}</span>
                <span className={styles.skuSummaryLabel}>Total cartons sold</span>
              </div>
              <div className={styles.skuSummaryDivider} />
              <div className={styles.skuSummaryItem}>
                <span className={styles.skuSummaryVal}>{skuRows.length}</span>
                <span className={styles.skuSummaryLabel}>Active SKUs</span>
              </div>
              <div className={styles.skuSummaryDivider} />
              <div className={styles.skuSummaryItem}>
                <span className={styles.skuSummaryVal} style={{ fontSize: '1rem' }}>{topSku?.sku || '—'}</span>
                <span className={styles.skuSummaryLabel}>Top SKU ({(topSku?.total_sold || 0).toLocaleString()} ctn)</span>
              </div>
              <div className={styles.skuSummaryDivider} />
              <div className={styles.skuSummaryItem}>
                <span className={styles.skuSummaryVal}>{totalVisits.toLocaleString()}</span>
                <span className={styles.skuSummaryLabel}>Visits with SKU sales</span>
              </div>
            </div>
          );
        })()}

        {skuLoading ? (
          <div className={styles.skuEmpty}>⏳ Loading SKU data…</div>
        ) : skuRows.length === 0 ? (
          <div className={styles.skuEmpty}>No SKU sales data found for this period.</div>
        ) : skuView === 'sku' ? (
          (() => {
            const totalCtn = skuRows.reduce((a, b) => a + b.total_sold, 0);
            const colors = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6'];
            return (
              <div className={styles.skuTableWrap}>
                <table className={styles.skuTable}>
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>#</th>
                      <th>SKU / Product</th>
                      <th className={styles.skuThNum}>Cartons Sold</th>
                      <th className={styles.skuThNum}>Visits</th>
                      <th style={{ minWidth: 200 }}>Share of Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {skuRows.map((s, idx) => {
                      const pct   = totalCtn > 0 ? Math.round(s.total_sold / totalCtn * 100) : 0;
                      const color = colors[idx % colors.length];
                      return (
                        <tr key={s.product_id}>
                          <td style={{ color: '#94a3b8', fontWeight: 600 }}>{idx + 1}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span className={styles.skuPill} style={{ background: color + '18', color }}>{s.sku}</span>
                              <span style={{ color: '#0f172a', fontWeight: 500 }}>{s.name}</span>
                            </div>
                          </td>
                          <td className={styles.skuTdNum}>
                            <strong style={{ color: '#0f172a' }}>{s.total_sold.toLocaleString()}</strong>
                            <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}> ctn</span>
                          </td>
                          <td className={styles.skuTdNum}>{s.visits_count}</td>
                          <td>
                            <div className={styles.skuBarWrap}>
                              <div className={styles.skuBarTrack}>
                                <div className={styles.skuBarFill} style={{ width: `${pct}%`, background: color }} />
                              </div>
                              <span className={styles.skuBarLabel}>{pct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()
        ) : (
          (() => {
            const personMap = {};
            skuRows.forEach(s => {
              s.by_salesperson.forEach(p => {
                if (!personMap[p.user_id]) personMap[p.user_id] = { user_id: p.user_id, full_name: p.full_name };
              });
            });
            const allPersons = Object.values(personMap);
            const pivotData = allPersons.map(person => {
              const bySku = {};
              let total = 0;
              skuRows.forEach(s => {
                const found = s.by_salesperson.find(p => p.user_id === person.user_id);
                bySku[s.product_id] = found?.sold || 0;
                total += found?.sold || 0;
              });
              return { ...person, bySku, total };
            }).sort((a, b) => b.total - a.total);
            const grandTotal = skuRows.reduce((a, b) => a + b.total_sold, 0);
            return (
              <div className={styles.skuPivotWrap}>
                <table className={styles.skuPivotTable}>
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>#</th>
                      <th>Salesperson</th>
                      {skuRows.map((s, i) => {
                        const colors = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6'];
                        return (
                          <th key={s.product_id} style={{ textAlign: 'center' }}>
                            <span className={styles.skuPill} style={{ background: colors[i % colors.length] + '18', color: colors[i % colors.length] }}>{s.sku}</span>
                          </th>
                        );
                      })}
                      <th style={{ textAlign: 'center' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pivotData.map((person, idx) => (
                      <tr key={person.user_id}>
                        <td style={{ color: '#94a3b8', fontWeight: 600 }}>{idx + 1}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 28, height: 28, borderRadius: '50%', background: primary, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, flexShrink: 0 }}>
                              {(person.full_name || 'U').charAt(0).toUpperCase()}
                            </div>
                            <span style={{ fontWeight: 500, color: '#0f172a' }}>{person.full_name}</span>
                          </div>
                        </td>
                        {skuRows.map(s => (
                          <td key={s.product_id} style={{ textAlign: 'center', color: person.bySku[s.product_id] > 0 ? '#0f172a' : '#cbd5e1' }}>
                            {person.bySku[s.product_id] > 0 ? person.bySku[s.product_id].toLocaleString() : '—'}
                          </td>
                        ))}
                        <td style={{ textAlign: 'center' }}>
                          <strong style={{ color: '#0f172a' }}>{person.total.toLocaleString()}</strong>
                          <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}> ctn</span>
                        </td>
                      </tr>
                    ))}
                    {pivotData.length > 0 && (
                      <tr className={styles.skuPivotTotalsRow}>
                        <td></td>
                        <td style={{ fontWeight: 700, color: '#0f172a', letterSpacing: '0.03em' }}>TOTAL</td>
                        {skuRows.map(s => (
                          <td key={s.product_id} style={{ textAlign: 'center', fontWeight: 700, color: '#0f172a' }}>
                            {s.total_sold.toLocaleString()}
                          </td>
                        ))}
                        <td style={{ textAlign: 'center', fontWeight: 700, color: '#0f172a' }}>
                          {grandTotal.toLocaleString()}
                          <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}> ctn</span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            );
          })()
        )}
      </div>

      <ReportPreviewModal
        open={perfPreviewOpen}
        onClose={() => setPerfPreviewOpen(false)}
        title="Performance Report"
        subtitle={`${monthLabel}${dateFrom || dateTo ? ` (${dateFrom || ''}${dateFrom && dateTo ? ' → ' : ''}${dateTo || ''})` : ''}`}
        headers={['#', 'Salesperson', 'Visits', 'Shops Sold', 'Shops Not Sold', 'Cartons Sold', 'Target (ctn)', 'Performance %']}
        rows={rows.map((r, i) => [
          i + 1,
          r.full_name,
          r.visits_total,
          r.shops_sold,
          r.shops_not_sold,
          r.cartons_sold_mtd,
          r.cartons_target ?? 'Not set',
          r.performance_pct !== null && r.performance_pct !== undefined ? `${r.performance_pct}%` : '—',
        ])}
        onExport={handleExcelExport}
      />

      <ReportPreviewModal
        open={skuPreviewOpen}
        onClose={() => setSkuPreviewOpen(false)}
        title="SKU Analysis"
        subtitle={`${MONTHS[parseInt(skuMonth) - 1]} ${skuYear}`}
        headers={['#', 'SKU', 'Product Name', 'Cartons Sold', 'Visits']}
        rows={skuRows.map((r, i) => [i + 1, r.sku, r.product_name, r.total_sold, r.visits_count])}
        onExport={handleSkuExcelExport}
      />

      <ReportPreviewModal
        open={visitPreviewOpen}
        onClose={() => { setVisitPreviewOpen(false); setVisitPreviewData(null); }}
        title={`Visit Detail — ${visitPreviewData?.row?.full_name || ''}`}
        subtitle={monthLabel}
        headers={['#', 'Date', 'Time', 'Shop', 'Status', 'Items', 'Total Cartons']}
        rows={(visitPreviewData?.d || []).map((v, i) => {
          const dt = new Date(v.created_at);
          return [
            i + 1,
            dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
            dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            v.shop_name + (v.shop_location ? ` — ${v.shop_location}` : ''),
            v.visit_sold ? 'Sold ✓' : 'Not Sold',
            v.items?.filter(i => i.sold > 0).length ?? 0,
            v.total_sold_cartons,
          ];
        })}
        onExport={exportVisitDetailExcel}
      />

      <div className={styles.skuSection}>
        <div className={styles.skuSectionHeader}>
          <div>
            <div className={styles.skuSectionTitle}>
              📦 Uplifter's Stock Position to Date
              <span className={styles.perfMtdBadge} style={{ marginLeft: 8 }}>LIVE</span>
            </div>
          </div>
          <button
            className={styles.perfRefreshBtn}
            style={{ background: primary, alignSelf: 'center' }}
            onClick={() => { _stkCache.key = null; loadStkData(); }}
            disabled={stkLoading}
          >
            {stkLoading ? '⏳' : '🔄'} Refresh
          </button>
        </div>

        <div className={styles.skuFilterBar}>
          <select
            className={styles.perfSelect}
            value={stkRegionId}
            onChange={e => { setStkRegionId(e.target.value); setStkSubregionId(''); _stkCache.key = null; }}
          >
            <option value="">All Regions</option>
            {regions.map(r => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
          </select>
          <select
            className={styles.perfSelect}
            value={stkSubregionId}
            onChange={e => { setStkSubregionId(e.target.value); _stkCache.key = null; }}
          >
            <option value="">All Subregions</option>
            {(stkRegionId
              ? subregions.filter(s => String(s.region_id) === String(stkRegionId))
              : subregions
            ).map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </select>
        </div>

        {stkError && <div className={styles.alertDanger} style={{ margin: '0 0 16px' }}>{stkError}</div>}

        {stkLoading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8', fontSize: '0.9rem' }}>
            ⏳ Loading stock positions…
          </div>
        )}

        {!stkLoading && !stkError && stkRows.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8', fontSize: '0.875rem', border: '1px dashed #e2e8f0', borderRadius: 12 }}>
            No stock position data found.
          </div>
        )}

        {!stkLoading && stkRows.length > 0 && (() => {
          const totalUp  = stkRows.reduce((s, r) => s + r.total_uplifted, 0);
          const totalMnl = stkRows.reduce((s, r) => s + (r.total_manually_added || 0), 0);
          const totalSld = stkRows.reduce((s, r) => s + r.total_sold, 0);
          const totalBal = stkRows.reduce((s, r) => s + r.total_balance, 0);
          return (
            <>
              <div className={styles.skuSummary} style={{ marginBottom: 20 }}>
                <div className={styles.skuSummaryItem}>
                  <span className={styles.skuSummaryVal}>{stkRows.length}</span>
                  <span className={styles.skuSummaryLabel}>Salespersons</span>
                </div>
                <div className={styles.skuSummaryDivider} />
                <div className={styles.skuSummaryItem}>
                  <span className={styles.skuSummaryVal}>{totalUp.toLocaleString()}</span>
                  <span className={styles.skuSummaryLabel}>Total Uplifted</span>
                </div>
                <div className={styles.skuSummaryDivider} />
                <div className={styles.skuSummaryItem}>
                  <span className={styles.skuSummaryVal} style={{ color: '#d97706' }}>{totalMnl.toLocaleString()}</span>
                  <span className={styles.skuSummaryLabel}>Manually Added</span>
                </div>
                <div className={styles.skuSummaryDivider} />
                <div className={styles.skuSummaryItem}>
                  <span className={styles.skuSummaryVal}>{totalSld.toLocaleString()}</span>
                  <span className={styles.skuSummaryLabel}>Total Sold</span>
                </div>
                <div className={styles.skuSummaryDivider} />
                <div className={styles.skuSummaryItem}>
                  <span className={styles.skuSummaryVal} style={{ color: totalBal > 0 ? '#0f766e' : totalBal < 0 ? '#dc2626' : '#64748b' }}>
                    {totalBal.toLocaleString()}
                  </span>
                  <span className={styles.skuSummaryLabel}>Net Balance</span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {stkRows.slice(0, stkVisibleCount).map(person => {
                  const isOpen = !!stkExpanded[person.user_id];
                  return (
                    <div
                      key={person.user_id}
                      style={{
                        background: '#fff',
                        border: '1px solid #e2e8f0',
                        borderRadius: 14,
                        overflow: 'hidden',
                        boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
                        transition: 'box-shadow 0.15s',
                      }}
                    >
                      <div
                        onClick={() => setStkExpanded(prev => ({ ...prev, [person.user_id]: !prev[person.user_id] }))}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '14px 18px', cursor: 'pointer',
                          background: isOpen ? '#f8fafc' : '#fff',
                          borderBottom: isOpen ? '1px solid #e2e8f0' : 'none',
                          transition: 'background 0.15s',
                        }}
                      >
                        <div style={{
                          width: 36, height: 36, borderRadius: '50%',
                          background: primary, color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 700, fontSize: '0.85rem', flexShrink: 0,
                        }}>
                          {(person.full_name || 'S').charAt(0).toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0f172a' }}>{person.full_name}</div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                            {person.skus.length} SKU{person.skus.length !== 1 ? 's' : ''}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <span style={{ fontSize: '0.73rem', fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: '#eff6ff', color: '#2563eb' }}>
                            ⬆ {person.total_uplifted.toLocaleString()} uplifted
                          </span>
                          {(person.total_manually_added || 0) > 0 && (
                            <span style={{ fontSize: '0.73rem', fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: '#fef9ec', color: '#d97706' }}>
                              ✏️ {person.total_manually_added.toLocaleString()} manual
                            </span>
                          )}
                          <span style={{ fontSize: '0.73rem', fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: '#f0fdf4', color: '#16a34a' }}>
                            ✅ {person.total_sold.toLocaleString()} sold
                          </span>
                          <span style={{
                            fontSize: '0.73rem', fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                            background: person.total_balance > 0 ? '#f0fdf4' : person.total_balance < 0 ? '#fef2f2' : '#f8fafc',
                            color:      person.total_balance > 0 ? '#0f766e' : person.total_balance < 0 ? '#dc2626' : '#64748b',
                          }}>
                            📦 {person.total_balance.toLocaleString()} balance
                          </span>
                        </div>
                        <span style={{ color: '#94a3b8', fontSize: '0.85rem', marginLeft: 4, flexShrink: 0 }}>
                          {isOpen ? '▲' : '▼'}
                        </span>
                      </div>

                      {isOpen && (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                            <thead>
                              <tr style={{ background: '#f8fafc' }}>
                                {['SKU', 'Product Name', 'Uplifted', 'Manually Added', 'Sold', 'Balance'].map((h, i) => (
                                  <th key={h} style={{
                                    padding: '10px 14px', textAlign: i >= 2 ? 'center' : 'left',
                                    fontWeight: 700, color: '#475569', fontSize: '0.75rem',
                                    textTransform: 'uppercase', letterSpacing: '0.04em',
                                    borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap',
                                    position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1,
                                  }}>
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {person.skus.map((sku, idx) => {
                                const balColor = sku.balance > 0 ? '#0f766e' : sku.balance < 0 ? '#dc2626' : '#94a3b8';
                                const balBg    = sku.balance > 0 ? '#f0fdf4' : sku.balance < 0 ? '#fef2f2' : '#f8fafc';
                                const isLow    = sku.balance > 0 && sku.balance <= 5;
                                return (
                                  <tr
                                    key={sku.product_id}
                                    style={{ background: idx % 2 === 0 ? '#fff' : '#fafbfc', transition: 'background 0.1s' }}
                                    onMouseEnter={e => { e.currentTarget.style.background = '#f1f5f9'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = idx % 2 === 0 ? '#fff' : '#fafbfc'; }}
                                  >
                                    <td style={{ padding: '10px 14px', fontWeight: 700, color: '#334155', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>
                                      {sku.sku}
                                    </td>
                                    <td style={{ padding: '10px 14px', color: '#475569', borderBottom: '1px solid #f1f5f9' }}>
                                      {sku.name}
                                    </td>
                                    <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: '#2563eb', borderBottom: '1px solid #f1f5f9' }}>
                                      {sku.uplifted.toLocaleString()}
                                    </td>
                                    <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: '#d97706', borderBottom: '1px solid #f1f5f9' }}>
                                      {(sku.manually_added || 0).toLocaleString()}
                                    </td>
                                    <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: '#16a34a', borderBottom: '1px solid #f1f5f9' }}>
                                      {sku.sold.toLocaleString()}
                                    </td>
                                    <td style={{ padding: '10px 14px', textAlign: 'center', borderBottom: '1px solid #f1f5f9' }}>
                                      <span style={{
                                        display: 'inline-block', minWidth: 52, padding: '3px 10px',
                                        borderRadius: 20, fontWeight: 700, fontSize: '0.8rem',
                                        background: balBg, color: balColor,
                                      }}>
                                        {sku.balance.toLocaleString()}
                                        {isLow && <span style={{ marginLeft: 4 }} title="Low stock">⚠️</span>}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr style={{ background: '#f1f5f9', fontWeight: 700 }}>
                                <td colSpan={2} style={{ padding: '10px 14px', color: '#0f172a', fontSize: '0.78rem', textTransform: 'uppercase' }}>Total</td>
                                <td style={{ padding: '10px 14px', textAlign: 'center', color: '#2563eb' }}>{person.total_uplifted.toLocaleString()}</td>
                                <td style={{ padding: '10px 14px', textAlign: 'center', color: '#d97706' }}>{(person.total_manually_added || 0).toLocaleString()}</td>
                                <td style={{ padding: '10px 14px', textAlign: 'center', color: '#16a34a' }}>{person.total_sold.toLocaleString()}</td>
                                <td style={{ padding: '10px 14px', textAlign: 'center', color: person.total_balance > 0 ? '#0f766e' : person.total_balance < 0 ? '#dc2626' : '#64748b' }}>
                                  {person.total_balance.toLocaleString()}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {stkRows.length > 10 && (
                <div style={{ textAlign: 'center', marginTop: 16 }}>
                  <button
                    onClick={() => setStkVisibleCount(v => v >= stkRows.length ? 10 : stkRows.length)}
                    style={{
                      padding: '8px 28px', borderRadius: 20, border: `1.5px solid ${primary}`,
                      background: '#fff', color: primary, fontWeight: 700, fontSize: '0.82rem',
                      cursor: 'pointer',
                    }}
                  >
                    {stkVisibleCount >= stkRows.length
                      ? `▲ Show Less`
                      : `▼ Show More (${stkRows.length - stkVisibleCount} more)`}
                  </button>
                </div>
              )}
            </>
          );
        })()}
      </div>

      <div className={styles.skuSection}>
        <div className={styles.skuSectionHeader}>
          <div>
            <div className={styles.skuSectionTitle}>
              ❌ Reasons Not Sold
              <span className={styles.perfMtdBadge} style={{ marginLeft: 8 }}>LIVE</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', borderRadius: 10, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
              {['list', 'map'].map(v => (
                <button
                  key={v}
                  onClick={() => setRnsView(v)}
                  style={{
                    padding: '6px 16px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
                    background: rnsView === v ? primary : '#fff',
                    color:      rnsView === v ? '#fff'   : '#475569',
                    border: 'none', outline: 'none', transition: 'background 0.15s',
                  }}
                >
                  {v === 'list' ? '☰ List' : '🗺 Map'}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={() => { setRnsFilterMode('month'); setRnsDateFrom(''); setRnsDateTo(''); _rnsCache.key = null; }}
                style={{
                  padding: '6px 12px', borderRadius: 10, border: '1px solid #e2e8f0',
                  background: rnsFilterMode === 'month' ? primary : '#fff', color: rnsFilterMode === 'month' ? '#fff' : '#475569',
                  fontWeight: 700, fontSize: '0.77rem', cursor: 'pointer',
                }}
              >
                📅 Month
              </button>
              <button
                onClick={() => { setRnsFilterMode('range'); _rnsCache.key = null; }}
                style={{
                  padding: '6px 12px', borderRadius: 10, border: '1px solid #e2e8f0',
                  background: rnsFilterMode === 'range' ? primary : '#fff', color: rnsFilterMode === 'range' ? '#fff' : '#475569',
                  fontWeight: 700, fontSize: '0.77rem', cursor: 'pointer',
                }}
              >
                📆 Custom Range
              </button>
            </div>
            <button
              className={styles.perfRefreshBtn}
              style={{ background: primary }}
              onClick={() => { _rnsCache.key = null; loadRnsData(); }}
              disabled={rnsLoading}
            >
              {rnsLoading ? '⏳' : '🔄'} Refresh
            </button>
            <button
              className={styles.perfRefreshBtn}
              style={{ background: '#0f172a' }}
              onClick={() => setRnsPreviewOpen(true)}
              disabled={rnsSummaryRows.length === 0 && rnsRows.length === 0}
            >
              📄 Preview Report
            </button>
          </div>
        </div>

        <div className={styles.skuFilterBar}>
          <select
            className={styles.perfSelect}
            value={rnsYear}
            onChange={e => { const y = parseInt(e.target.value), m = parseInt(rnsMonth); setRnsFilterMode('month'); setRnsYear(String(y)); setRnsDateFrom(''); setRnsDateTo(''); _rnsCache.key = null; }}
          >
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select
            className={styles.perfSelect}
            value={rnsMonth}
            onChange={e => { const m = parseInt(e.target.value), y = parseInt(rnsYear); setRnsFilterMode('month'); setRnsMonth(String(m)); setRnsDateFrom(''); setRnsDateTo(''); _rnsCache.key = null; }}
          >
            {MONTHS.map((m, i) => <option key={i + 1} value={String(i + 1)}>{m}</option>)}
          </select>
          <select
            className={styles.perfSelect}
            value={rnsRegionId}
            onChange={e => { setRnsRegionId(e.target.value); setRnsSubregionId(''); setRnsUserId(''); _rnsCache.key = null; }}
          >
            <option value="">All Regions</option>
            {regions.map(r => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
          </select>
          <select
            className={styles.perfSelect}
            value={rnsSubregionId}
            onChange={e => { setRnsSubregionId(e.target.value); _rnsCache.key = null; }}
          >
            <option value="">All Subregions</option>
            {rnsFilteredSubregions.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </select>
          <select
            className={styles.perfSelect}
            value={rnsUserId}
            onChange={e => { setRnsUserId(e.target.value); _rnsCache.key = null; }}
          >
            <option value="">All Salespersons</option>
            {rnsFilteredUsers.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <input
            type="date"
            className={styles.perfSelect}
            value={rnsDateFrom}
            onChange={e => { setRnsFilterMode('range'); setRnsDateFrom(e.target.value); _rnsCache.key = null; }}
            style={{ minWidth: 132 }}
            title="Custom date from (overrides month)"
          />
          <input
            type="date"
            className={styles.perfSelect}
            value={rnsDateTo}
            onChange={e => { setRnsFilterMode('range'); setRnsDateTo(e.target.value); _rnsCache.key = null; }}
            style={{ minWidth: 132 }}
            title="Custom date to (overrides month)"
          />
          {(rnsRegionId || rnsSubregionId || rnsUserId) && (
            <button
              className={styles.perfRefreshBtn}
              style={{ background: '#64748b', fontSize: '0.75rem' }}
              onClick={() => { const currentYear = String(now.getFullYear()); const currentMonth = String(now.getMonth() + 1); setRnsFilterMode('month'); setRnsRegionId(''); setRnsSubregionId(''); setRnsUserId(''); setRnsYear(currentYear); setRnsMonth(currentMonth); setRnsDateFrom(''); setRnsDateTo(''); _rnsCache.key = null; }}
            >
              ✕ Clear
            </button>
          )}
        </div>

        {!rnsLoading && (rnsMeta.total > 0 || rnsRows.length > 0) && (
          <div className={styles.skuSummary} style={{ marginBottom: 16 }}>
            <div className={styles.skuSummaryItem}>
              <span className={styles.skuSummaryVal} style={{ color: '#dc2626' }}>{rnsMeta.total || rnsRows.length}</span>
              <span className={styles.skuSummaryLabel}>Not Sold Visits</span>
            </div>
            {rnsMeta.topReason && (
              <>
                <div className={styles.skuSummaryDivider} />
                <div className={styles.skuSummaryItem}>
                  <span className={styles.skuSummaryVal} style={{ fontSize: '0.78rem', maxWidth: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {rnsMeta.topReason}
                  </span>
                  <span className={styles.skuSummaryLabel}>Top Reason</span>
                </div>
              </>
            )}
            {rnsMeta.topRegion && (
              <>
                <div className={styles.skuSummaryDivider} />
                <div className={styles.skuSummaryItem}>
                  <span className={styles.skuSummaryVal} style={{ fontSize: '0.78rem' }}>{rnsMeta.topRegion}</span>
                  <span className={styles.skuSummaryLabel}>Most Affected Region</span>
                </div>
              </>
            )}
          </div>
        )}

        {rnsError && <div className={styles.alertDanger} style={{ margin: '0 0 16px' }}>{rnsError}</div>}

        {rnsLoading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8', fontSize: '0.9rem' }}>
            ⏳ Loading…
          </div>
        )}

        {!rnsLoading && !rnsError && rnsRows.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8', fontSize: '0.875rem', border: '1px dashed #e2e8f0', borderRadius: 12 }}>
            🎉 No "Not Sold" visits found for the selected period.
          </div>
        )}

        {!rnsLoading && rnsSummaryRows.length > 0 && rnsView === 'list' && (() => {
          return (
            <div style={{ overflowX: 'auto', borderRadius: 14, border: '1px solid #e2e8f0', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    {['#', 'Reason', 'Count'].map((h, i) => (
                      <th key={h} style={{
                        padding: '11px 14px',
                        textAlign: i === 0 ? 'center' : 'left',
                        fontWeight: 700, color: '#475569', fontSize: '0.73rem',
                        textTransform: 'uppercase', letterSpacing: '0.04em',
                        borderBottom: '2px solid #e2e8f0', whiteSpace: 'nowrap',
                        position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1,
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rnsSummaryRows.map((row, idx) => (
                    <tr
                      key={row.reason}
                      style={{ background: idx % 2 === 0 ? '#fff' : '#fafbfc', transition: 'background 0.1s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#f1f5f9'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = idx % 2 === 0 ? '#fff' : '#fafbfc'; }}
                    >
                      <td style={{ padding: '10px 14px', textAlign: 'center', color: '#94a3b8', fontSize: '0.75rem', borderBottom: '1px solid #f1f5f9', fontWeight: 600 }}>
                        {idx + 1}
                      </td>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: '#0f172a', borderBottom: '1px solid #f1f5f9' }}>
                        {row.reason}
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9' }}>
                        <button
                          onClick={() => {
                            setRnsDetailReason(row.reason);
                            setRnsDetailRows(row.rows || []);
                            setRnsPreviewOpen(true);
                          }}
                          style={{
                            border: 'none', borderRadius: 999, padding: '6px 12px',
                            background: '#fee2e2', color: '#991b1b', fontWeight: 700,
                            cursor: 'pointer', minWidth: 44,
                          }}
                        >
                          {row.count}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}

        {!rnsLoading && rnsRows.length > 0 && rnsView === 'map' && (() => {
          const mapMarkers = rnsRows
            .filter(r => r.latitude && r.longitude)
            .map(r => ({
              id:               `rns-${r.visit_id}`,
              shop_id:          null,
              shop_name:        r.shop_name,
              shop_location:    r.shop_location,
              latitude:         r.latitude,
              longitude:        r.longitude,
              type:             'not_sold',
              salesperson_name: r.salesperson_name,
              selfie_path:      r.selfie_path,
              selfie_url:       r.selfie_url,
              skus:             [],
              total_sold:       0,
              total_uplifted:   0,
              not_sold_reason:  r.reason,
              visited_at:       r.visited_at,
            }));

          return (
            <div>
              {mapMarkers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: '0.875rem', border: '1px dashed #e2e8f0', borderRadius: 12 }}>
                  No location data available for these visits.
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      Showing <strong>{mapMarkers.length}</strong> location{mapMarkers.length !== 1 ? 's' : ''} on map
                    </span>
                    <button
                      onClick={() => setRnsMapOpen(true)}
                      style={{
                        padding: '6px 16px', borderRadius: 8, border: 'none',
                        background: primary, color: '#fff', fontWeight: 700,
                        fontSize: '0.8rem', cursor: 'pointer',
                      }}
                    >
                      ⛶ Expand Map
                    </button>
                  </div>
                  <MapFullscreenModal
                    open={rnsMapOpen}
                    onClose={() => setRnsMapOpen(false)}
                    markers={mapMarkers}
                    filterLabel={[
                      rnsDateFrom || rnsDateTo ? `${rnsDateFrom || '…'} → ${rnsDateTo || '…'}` : `${MONTHS[parseInt(rnsMonth) - 1]} ${rnsYear}`,
                      regions.find(r => String(r.id) === rnsRegionId)?.name,
                      rnsFilteredSubregions.find(s => String(s.id) === rnsSubregionId)?.name,
                      rnsFilteredUsers.find(u => u.id === rnsUserId)?.full_name,
                    ].filter(Boolean).join(' · ')}
                    primary={primary}
                    hideLegend
                  />
                  <div
                    onClick={() => setRnsMapOpen(true)}
                    style={{
                      height: 360, borderRadius: 14, overflow: 'hidden',
                      border: '2px solid #e2e8f0', cursor: 'pointer', position: 'relative',
                      background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <div style={{ textAlign: 'center', color: '#475569' }}>
                      <div style={{ fontSize: '3rem', marginBottom: 8 }}>🗺</div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 4 }}>
                        {mapMarkers.length} Not Sold location{mapMarkers.length !== 1 ? 's' : ''}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Click to open interactive map</div>
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })()}

        <ReportPreviewModal
          open={rnsPreviewOpen}
          onClose={() => {
            setRnsPreviewOpen(false);
            setRnsDetailReason('');
            setRnsDetailRows([]);
          }}
          title={rnsDetailReason ? `Reason: ${rnsDetailReason}` : 'Reasons Not Sold'}
          subtitle={
            rnsDateFrom || rnsDateTo
              ? `${rnsDateFrom || '…'} → ${rnsDateTo || '…'}`
              : `${MONTHS[parseInt(rnsMonth) - 1]} ${rnsYear}`
          }
          headers={['#', 'Shop', 'Subregion', 'Salesperson', 'Visit Date', 'Reason Not Sold']}
          rows={(rnsDetailRows.length ? rnsDetailRows : rnsRows).map((r, i) => [
            i + 1,
            r.shop_name + (r.shop_location ? ` — ${r.shop_location}` : ''),
            r.subregion_name || '—',
            r.salesperson_name,
            new Date(r.visited_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            r.reason,
          ])}
          onExport={() => exportRnsExcel(rnsDetailRows.length ? rnsDetailRows : rnsRows, rnsDetailReason || undefined)}
        />
      </div>
    </div>
  );
}

/* ── Customer Analysis Tab ────────────────────────────────────── */
function CustomerAnalysisTab({ token, primary, branding, regionFilter }) {
  const now    = new Date();
  const MONTHS = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  const YEARS = Array.from({ length: 5 }, (_, i) => String(now.getFullYear() - i));
  const CHART_COLORS = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6','#f97316','#0ea5e9'];

  const [section,     setSection]     = useState('sales');
  const [year,        setYear]        = useState(String(now.getFullYear()));
  const [month,       setMonth]       = useState(String(now.getMonth() + 1));
  const [dateFrom,    setDateFrom]    = useState('');
  const [dateTo,      setDateTo]      = useState('');
  const [subregionId, setSubregionId] = useState('');
  const [subregions,  setSubregions]  = useState([]);
  const [regionId,    setRegionId]    = useState(regionFilter || '');
  const [regions,     setRegions]     = useState([]);
  const [rows,        setRows]        = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [expandedRow, setExpandedRow] = useState(null);
  const [limited,       setLimited]       = useState(false);
  const [periodCartons, setPeriodCartons] = useState(null);
  const [periodVisits,  setPeriodVisits]  = useState(null);
  const [periodShops,   setPeriodShops]   = useState(null);
  const [custPreviewOpen, setCustPreviewOpen] = useState(false);
  const [custStockVisible, setCustStockVisible] = useState(10);
  const [selectedTrendPoint, setSelectedTrendPoint] = useState(null);
  const [custShopSearch,   setCustShopSearch]   = useState('');
  const custDebounceRef = useRef(null);
  const trendChartRef = useRef(null);

  // ---- NEW PAGINATION STATE FOR SALES TRENDS ----
  const [salesVisibleCount, setSalesVisibleCount] = useState(10);

  useEffect(() => { setRegionId(regionFilter || ''); }, [regionFilter]);
  useEffect(() => { setSubregionId(''); }, [regionId]);

  const filteredSubregions = regionId ? subregions.filter(s => String(s.region_id) === String(regionId)) : subregions;

  useEffect(() => {
    if (!token) return;
    if (_custCache.subregions && _custCache.regions) {
      setSubregions(_custCache.subregions);
      setRegions(_custCache.regions);
      return;
    }
    fetch('/api/admin/map-regions', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(async regList => {
        const regionsList = Array.isArray(regList) ? regList : [];
        _custCache.regions = regionsList;
        setRegions(regionsList);
        if (!regionsList.length) return;
        const all = await Promise.all(
          regionsList.map(reg =>
            fetch(`/api/admin/map-regions?region_id=${reg.id}`, { headers: { Authorization: `Bearer ${token}` } })
              .then(r => r.json())
          )
        );
        const flat = all.flat();
        _custCache.subregions = flat;
        setSubregions(flat);
      });
  }, [token]);

  const [stockDebug, setStockDebug] = React.useState(null);

  const loadData = async (sec, yr, mo, from, to, subId, regId) => {
    const cacheKey = `${sec}:${yr}:${mo}:${from}:${to}:${subId}:${regId}`;
    if (_custCache.key === cacheKey && _custCache.data) {
      setRows(_custCache.data);
      setLimited(_custCache.limited || false);
      if (_custCache.periodCartons !== null) setPeriodCartons(_custCache.periodCartons);
      if (_custCache.periodVisits !== null) setPeriodVisits(_custCache.periodVisits);
      if (_custCache.periodShops !== null) setPeriodShops(_custCache.periodShops);
      return;
    }
    setLoading(true); setError(''); setExpandedRow(null); setStockDebug(null);
    try {
      const params = new URLSearchParams({ mode: sec });
      const safeValue = (value) => value != null && value !== '' && value !== 'null' && value !== 'undefined';
      if (sec !== 'stock') {
        if (!from && !to) {
          if (safeValue(yr)) params.set('year', yr);
          if (safeValue(mo)) params.set('month', mo);
        }
        if (safeValue(from))  params.set('dateFrom',     from);
        if (safeValue(to))    params.set('dateTo',       to);
      }
      if (safeValue(subId)) params.set('subregion_id', subId);
      if (safeValue(regId)) params.set('region_id',    regId);
      const r = await fetch(`/api/admin/customer-analysis?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const lim = r.headers.get('X-Data-Limited') === 'true';
      const rawCartons = r.headers.get('X-Total-Cartons');
      const rawVisits  = r.headers.get('X-Total-Visits');
      const rawShops   = r.headers.get('X-Active-Shops');
      let d;
      try {
        d = await r.json();
      } catch (jsonErr) {
        d = null;
      }
      if (sec === 'stock') {
        window.__lastStockApi = d;
      }
      if (!r.ok) {
        const message = (d && d.error) ? d.error : `API error ${r.status}: ${r.statusText}`;
        setError(message);
        setRows([]);
        return;
      }
      let resultRows;
      if (sec === 'stock' && d && typeof d === 'object' && 'data' in d) {
        setStockDebug(d._debug || null);
        resultRows = Array.isArray(d.data) ? d.data : [];
      } else {
        resultRows = Array.isArray(d) ? d : [];
      }
      _custCache.key = cacheKey;
      _custCache.data = resultRows;
      _custCache.limited = lim;
      if (rawCartons !== null) _custCache.periodCartons = parseInt(rawCartons, 10);
      if (rawVisits  !== null) _custCache.periodVisits  = parseInt(rawVisits, 10);
      if (rawShops   !== null) _custCache.periodShops   = parseInt(rawShops, 10);
      setLimited(lim);
      setRows(resultRows);
      if (rawCartons !== null) setPeriodCartons(parseInt(rawCartons, 10));
      if (rawVisits  !== null) setPeriodVisits(parseInt(rawVisits, 10));
      if (rawShops   !== null) setPeriodShops(parseInt(rawShops, 10));
      if (sec === 'stock') setCustStockVisible(10);
      // Reset pagination on new data
      setSalesVisibleCount(10);
    } catch { setError('Network error. Please try again.'); setRows([]); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!token) return;
    clearTimeout(custDebounceRef.current);
    custDebounceRef.current = setTimeout(() => {
      loadData(section, year, month, dateFrom, dateTo, subregionId, regionId);
    }, 400);
    return () => clearTimeout(custDebounceRef.current);
  }, [token, section, year, month, dateFrom, dateTo, subregionId, regionId]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (trendChartRef.current && !trendChartRef.current.contains(event.target)) {
        setSelectedTrendPoint(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const monthLabel = `${MONTHS[parseInt(month) - 1]} ${year}`;
  const themeHex   = (primary || '#2563eb').replace('#', '');

  const handleExcelExport = async () => {
    if (!rows.length) return;
    const ExcelJS   = (await import('exceljs')).default;
    const wb        = new ExcelJS.Workbook();
    wb.creator      = 'Sprint App';
    wb.created      = new Date();
    const companyName = branding?.company_name || 'Sprint App';

    const isSales = section === 'sales';

    if (section === 'stock') {
      const ws3 = wb.addWorksheet('Stock Positions', { views: [{ showGridLines: false }] });
      const sCols = ['Shop', 'Subregion', 'SKU', 'Product Name', 'Stock Position (cartons)', 'Last Recorded'];
      const sW    = [30, 18, 14, 30, 22, 16];
      const hdrRow = 1;
      sCols.forEach((h, i) => {
        ws3.getColumn(i + 1).width = sW[i];
        const cell = ws3.getCell(hdrRow, i + 1);
        cell.value = h;
        cell.font  = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${themeHex}` } };
        cell.alignment = { horizontal: i >= 4 ? 'center' : 'left', vertical: 'middle' };
      });
      ws3.getRow(hdrRow).height = 22;
      let sr3 = hdrRow + 1;
      rows.forEach(row => {
        const sks = row.skus || [];
        if (sks.length === 0) {
          const vals = [row.shop_name, row.subregion_name, '', '', 0, row.last_visit_date || '—'];
          vals.forEach((v, ci) => {
            const cell = ws3.getCell(sr3, ci + 1);
            cell.value = typeof v === 'number' ? v : v || '';
            cell.font  = { size: 11, color: { argb: 'FF334155' } };
            cell.alignment = { horizontal: ci >= 4 ? 'center' : 'left', vertical: 'middle' };
            if (ci === 4) {
              cell.font = { size: 11, bold: true, color: { argb: 'FFEF4444' } };
            }
          });
          sr3++;
        } else {
          sks.forEach(sk => {
            [row.shop_name, row.subregion_name, sk.sku, sk.name, sk.stock_position, sk.visit_date || '—'].forEach((v, ci) => {
              const cell = ws3.getCell(sr3, ci + 1);
              cell.value = typeof v === 'number' ? v : v;
              cell.font  = { size: 11, color: { argb: 'FF334155' } };
              cell.alignment = { horizontal: ci >= 4 ? 'center' : 'left', vertical: 'middle' };
              if (ci === 4 && typeof v === 'number') {
                cell.font = { size: 11, bold: true, color: { argb: v === 0 ? 'FFEF4444' : v <= 5 ? 'FFF59E0B' : 'FF059669' } };
              }
            });
            sr3++;
          });
        }
      });
      const footR = sr3 + 2;
      ws3.mergeCells(footR, 1, footR, sCols.length);
      const fc = ws3.getCell(footR, 1);
      fc.value = '';
      fc.font  = { italic: true, size: 9, color: { argb: 'FF94a3b8' } };
      fc.alignment = { horizontal: 'center' };
      const buf3  = await wb.xlsx.writeBuffer();
      const blob3 = new Blob([buf3], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url3  = URL.createObjectURL(blob3);
      const a3    = document.createElement('a');
      a3.href     = url3;
      a3.download = `stock-positions-${new Date().toISOString().slice(0,10)}.xlsx`;
      a3.click();
      URL.revokeObjectURL(url3);
      return;
    }

    const ws = wb.addWorksheet(isSales ? 'Sales Trends' : 'Uplift Trends', { views: [{ showGridLines: false }] });

    const startRow   = 1;
    const COLS       = isSales
      ? ['#','Shop','Location','Subregion','Visits','Cartons Sold','Not-Sold Visits','Last Visit','Top SKU']
      : ['#','Shop','Location','Subregion','Uplift Requests','Approved','Rejected','Pending','Cartons Uplifted','Last Uplift'];
    const colWidths  = isSales
      ? [5,30,28,18,10,14,16,14,14]
      : [5,30,28,18,16,12,12,10,16,14];

    ws.mergeCells(startRow, 1, startRow, COLS.length);
    const tc = ws.getCell(startRow, 1);
    tc.value = companyName;
    tc.font  = { bold: true, size: 16, color: { argb: `FF${themeHex}` } };
    tc.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(startRow).height = 28;

    ws.mergeCells(startRow + 1, 1, startRow + 1, COLS.length);
    const sc = ws.getCell(startRow + 1, 1);
    sc.value = `${isSales ? 'Sales Trends' : 'Uplift Trends'} — ${monthLabel}${dateFrom ? ` from ${dateFrom}` : ''}${dateTo ? ` to ${dateTo}` : ''}`;
    sc.font  = { size: 12, color: { argb: 'FF64748b' } };
    sc.alignment = { horizontal: 'center' };
    ws.getRow(startRow + 1).height = 20;
    ws.getRow(startRow + 2).height = 8;

    const hdrRow = startRow + 3;
    COLS.forEach((h, i) => {
      ws.getColumn(i + 1).width = colWidths[i];
      const cell = ws.getCell(hdrRow, i + 1);
      cell.value = h;
      cell.font  = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${themeHex}` } };
      cell.alignment = { horizontal: i >= 4 ? 'center' : 'left', vertical: 'middle' };
    });
    ws.getRow(hdrRow).height = 22;

    rows.forEach((row, idx) => {
      const r = hdrRow + 1 + idx;
      const bg = idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF';
      const vals = isSales
        ? [idx+1, row.shop_name, row.shop_location, row.subregion_name,
           row.period_visits, row.period_sold, row.period_not_sold_visits,
           row.last_visit_date || '—', row.top_sku || '—']
        : [idx+1, row.shop_name, row.shop_location, row.subregion_name,
           row.total_uplifts, row.approved_uplifts, row.rejected_uplifts,
           row.pending_uplifts, row.total_cartons_uplifted, row.last_uplift_date || '—'];
      vals.forEach((v, ci) => {
        const cell = ws.getCell(r, ci + 1);
        cell.value = v;
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.font  = { size: 11, color: { argb: 'FF334155' } };
        cell.alignment = { horizontal: ci >= 4 ? 'center' : 'left', vertical: 'middle' };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFe2e8f0' } } };
      });
      ws.getRow(r).height = 20;
    });

    const footerR = hdrRow + 1 + rows.length + 1;
    ws.mergeCells(footerR, 1, footerR, COLS.length);
    const fc = ws.getCell(footerR, 1);
    fc.value = '';
    fc.font  = { italic: true, size: 9, color: { argb: 'FF94a3b8' } };
    fc.alignment = { horizontal: 'center' };

    const ws2 = wb.addWorksheet('By SKU', { views: [{ showGridLines: false }] });
    const skuCols = isSales ? ['Shop','SKU','Product Name','Cartons Sold'] : ['Shop','SKU','Product Name','Cartons Uplifted'];
    const skuW    = [30, 12, 30, 16];
    skuCols.forEach((h, i) => {
      ws2.getColumn(i + 1).width = skuW[i];
      const cell = ws2.getCell(1, i + 1);
      cell.value = h;
      cell.font  = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${themeHex}` } };
      cell.alignment = { horizontal: i >= 3 ? 'center' : 'left', vertical: 'middle' };
    });
    ws2.getRow(1).height = 22;
    let r2 = 2;
    rows.forEach(row => {
      (row.by_sku || []).forEach(sk => {
        const qty = isSales ? sk.sold : sk.cartons;
        [row.shop_name, sk.sku, sk.name, qty].forEach((v, ci) => {
          const cell = ws2.getCell(r2, ci + 1);
          cell.value = v;
          cell.font  = { size: 11, color: { argb: 'FF334155' } };
          cell.alignment = { horizontal: ci >= 3 ? 'center' : 'left', vertical: 'middle' };
        });
        r2++;
      });
    });

    const buf  = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `customer-${section}-${year}-${String(month).padStart(2,'0')}${dateFrom ? `-${dateFrom}` : ''}${dateTo ? `-${dateTo}` : ''}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const summary = (() => {
    if (!rows.length || section === 'stock') return null;
    if (section === 'sales') {
      const totalCartons = rows.reduce((a, b) => a + (b.period_sold || 0), 0);
      const totalVisits  = rows.reduce((a, b) => a + (b.period_visits || 0), 0);
      const topShop      = rows[0];
      const skuMap = {};
      rows.forEach(r => (Array.isArray(r.by_sku) ? r.by_sku : []).forEach(s => { skuMap[s.sku] = (skuMap[s.sku] || 0) + s.sold; }));
      const topSku = Object.entries(skuMap).sort((a,b) => b[1]-a[1])[0];
      return { totalCartons, totalVisits, topShop, topSku };
    } else {
      const totalCartons = rows.reduce((a, b) => a + b.total_cartons_uplifted, 0);
      const totalUplifts = rows.reduce((a, b) => a + b.total_uplifts, 0);
      const totalApproved = rows.reduce((a, b) => a + b.approved_uplifts, 0);
      const approvalRate = totalUplifts > 0 ? Math.round(totalApproved / totalUplifts * 100) : 0;
      const topShop      = rows[0];
      return { totalCartons, totalUplifts, totalApproved, approvalRate, topShop };
    }
  })();

  // ---- Compute display rows for sales table ----
  const displayRows = custShopSearch.trim()
    ? rows.filter(r => (r.shop_name || '').toLowerCase().includes(custShopSearch.toLowerCase()))
    : rows;
  const visibleRows = displayRows.slice(0, salesVisibleCount);

  return (
    <div className={styles.custWrap}>
      <div className={styles.custHeader}>
        <div>
          <h2 className={styles.custTitle}>Customer Analysis</h2>
          <p className={styles.custSubtitle}>
            {section === 'sales'
              ? 'How shops buy from your sales team'
              : section === 'uplifts'
                ? 'How shops sell back to your sales reps (uplifts)'
                : 'Current carton counts at each shop, per SKU'
            }
          </p>
        </div>

        <div className={styles.custToggle}>
          <button
            className={`${styles.custToggleBtn} ${section === 'sales' ? styles.custToggleActive : ''}`}
            style={section === 'sales' ? { background: primary, borderColor: primary } : {}}
            onClick={() => setSection('sales')}
          >
            🛒 Sales Trends
          </button>
          <button
            className={`${styles.custToggleBtn} ${section === 'uplifts' ? styles.custToggleActive : ''}`}
            style={section === 'uplifts' ? { background: primary, borderColor: primary } : {}}
            onClick={() => setSection('uplifts')}
          >
            📦 Uplift Trends
          </button>
          <button
            className={`${styles.custToggleBtn} ${section === 'stock' ? styles.custToggleActive : ''}`}
            style={section === 'stock' ? { background: primary, borderColor: primary } : {}}
            onClick={() => setSection('stock')}
          >
            📊 Stock Positions
          </button>
        </div>
      </div>

      <div className={styles.custFilterBar}>
        {section !== 'stock' && (
          <>
            <select className={styles.custSelect} value={year} onChange={e => setYear(e.target.value)}>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select className={styles.custSelect} value={month} onChange={e => setMonth(e.target.value)}>
              {MONTHS.map((m, i) => <option key={i+1} value={String(i+1)}>{m}</option>)}
            </select>
            <input type="date" className={styles.custSelect} style={{ minWidth: 130 }}
              value={dateFrom} onChange={e => setDateFrom(e.target.value)} placeholder="From date" />
            <input type="date" className={styles.custSelect} style={{ minWidth: 130 }}
              value={dateTo} onChange={e => setDateTo(e.target.value)} placeholder="To date" />
          </>
        )}
        <select className={styles.custSelect} value={regionId} onChange={e => setRegionId(e.target.value)}>
          <option value="">All Regions</option>
          {regions.map(r => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
        </select>
        <select className={styles.custSelect} value={subregionId} onChange={e => setSubregionId(e.target.value)}>
          <option value="">All Subregions</option>
          {filteredSubregions.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
        </select>
        <button
          className={styles.custRefreshBtn}
          style={{ background: primary }}
          onClick={() => loadData(section, year, month, dateFrom, dateTo, subregionId, regionId)}
          disabled={loading}
        >
          {loading ? '⏳' : '🔄'} Refresh
        </button>
        <button
          className={styles.custExcelBtn}
          onClick={() => setCustPreviewOpen(true)}
          disabled={loading || rows.length === 0}
        >
          👁 Preview Report
        </button>
        <input
          type="text"
          placeholder="🔍 Search shop…"
          value={custShopSearch}
          onChange={e => setCustShopSearch(e.target.value)}
          style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: '0.82rem', minWidth: 150, outline: 'none' }}
        />
      </div>
      {error && <div className={styles.alertDanger} style={{ margin: '0 0 16px' }}>{error}</div>}

      {!loading && summary && (
        <div className={styles.custSummary}>
          {section === 'sales' ? (
            <>
              <div className={styles.custSummaryItem}>
                <span className={styles.custSummaryVal}>{(periodShops !== null ? periodShops : rows.length).toLocaleString()}</span>
                <span className={styles.custSummaryLabel}>Active Shops</span>
              </div>
              <div className={styles.custSummaryDivider} />
              <div className={styles.custSummaryItem}>
                <span className={styles.custSummaryVal}>{(periodVisits !== null ? periodVisits : summary.totalVisits).toLocaleString()}</span>
                <span className={styles.custSummaryLabel}>Total Visits</span>
              </div>
              <div className={styles.custSummaryDivider} />
              <div className={styles.custSummaryItem}>
                <span className={styles.custSummaryVal}>{(periodCartons !== null ? periodCartons : summary.totalCartons).toLocaleString()}</span>
                <span className={styles.custSummaryLabel}>Cartons Sold</span>
              </div>
              <div className={styles.custSummaryDivider} />
              <div className={styles.custSummaryItem}>
                <span className={styles.custSummaryVal} style={{ fontSize: '0.95rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary.topShop?.shop_name || '—'}</span>
                <span className={styles.custSummaryLabel}>Top Buying Shop ({(summary.topShop?.period_sold || 0).toLocaleString()} ctn)</span>
              </div>
              {summary.topSku && (
                <>
                  <div className={styles.custSummaryDivider} />
                  <div className={styles.custSummaryItem}>
                    <span className={styles.custSummaryVal}>{summary.topSku[0]}</span>
                    <span className={styles.custSummaryLabel}>Top SKU ({summary.topSku[1].toLocaleString()} ctn)</span>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className={styles.custSummaryItem}>
                <span className={styles.custSummaryVal}>{rows.length.toLocaleString()}</span>
                <span className={styles.custSummaryLabel}>Active Shops</span>
              </div>
              <div className={styles.custSummaryDivider} />
              <div className={styles.custSummaryItem}>
                <span className={styles.custSummaryVal}>{summary.totalUplifts.toLocaleString()}</span>
                <span className={styles.custSummaryLabel}>Uplift Requests</span>
              </div>
              <div className={styles.custSummaryDivider} />
              <div className={styles.custSummaryItem}>
                <span className={styles.custSummaryVal}>{summary.totalCartons.toLocaleString()}</span>
                <span className={styles.custSummaryLabel}>Cartons Uplifted</span>
              </div>
              <div className={styles.custSummaryDivider} />
              <div className={styles.custSummaryItem}>
                <span className={styles.custSummaryVal} style={{ color: summary.approvalRate >= 80 ? '#16a34a' : summary.approvalRate >= 50 ? '#f59e0b' : '#dc2626' }}>
                  {summary.approvalRate}%
                </span>
                <span className={styles.custSummaryLabel}>Approval Rate</span>
              </div>
              <div className={styles.custSummaryDivider} />
              <div className={styles.custSummaryItem}>
                <span className={styles.custSummaryVal} style={{ fontSize: '0.95rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary.topShop?.shop_name || '—'}</span>
                <span className={styles.custSummaryLabel}>Top Uplifting Shop ({(summary.topShop?.total_cartons_uplifted || 0).toLocaleString()} ctn)</span>
              </div>
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className={styles.custEmpty}>⏳ Loading customer data…</div>
      ) : rows.length === 0 ? (
        <div className={styles.custEmpty}>
          {section === 'stock'
            ? 'No stock position data found. Stock positions are recorded when salespersons submit visit forms.'
            : `No ${section === 'sales' ? 'sales' : 'uplift'} data found for ${monthLabel}${subregionId ? ' in selected subregion' : ''}.`
          }
        </div>
      ) : (
        <div className={styles.custTableWrap}>
          {section === 'stock' ? (
            <>
              <table className={styles.custTable}>
              <thead>
                <tr>
                  <th>Shop Name</th>
                  <th>Region</th>
                  <th>Subregion</th>
                  <th className={styles.custThNum}>Total Stock Position</th>
                  <th>Stock Position per SKU</th>
                  <th>Last Recorded Visit</th>
                </tr>
              </thead>
              <tbody>
                {(custShopSearch.trim() ? rows.filter(r => (r.shop_name||'').toLowerCase().includes(custShopSearch.toLowerCase())) : rows).slice(0, custStockVisible).map((row) => {
                  const totalStock = Array.isArray(row.skus)
                    ? row.skus.reduce((sum, s) => sum + (typeof s.stock_position === 'number' ? s.stock_position : 0), 0)
                    : 0;
                  const skuString = Array.isArray(row.skus)
                    ? row.skus.map(s => `${s.sku}: ${s.stock_position}`).join(', ')
                    : '';
                  return (
                    <tr key={row.shop_id} className={styles.custRow}>
                      <td>
                        <div className={styles.custShopCell}>
                          <div className={styles.custShopAvatar} style={{ background: `${primary}22`, color: primary }}>
                            {(row.shop_name || 'S').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className={styles.custShopName}>{row.shop_name}</div>
                            {row.shop_location && <div className={styles.custShopLoc}>📍 {row.shop_location}</div>}
                          </div>
                        </div>
                      </td>
                      <td>{row.region_name}</td>
                      <td><span className={styles.custSubregionBadge}>{row.subregion_name}</span></td>
                      <td className={styles.custTdNum} style={{ fontWeight: 700, fontSize: 13 }}>{totalStock}</td>
                      <td style={{ fontSize: 13 }}>{skuString}</td>
                      <td style={{ fontSize: 13, color: '#64748b' }}>{row.last_visit_date || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
              {rows.length > 10 && (
                <div style={{ textAlign: 'center', marginTop: 16, marginBottom: 8 }}>
                  <button
                    onClick={() => setCustStockVisible(v => v >= rows.length ? 10 : rows.length)}
                    style={{
                      padding: '8px 28px', borderRadius: 20, border: `1.5px solid ${primary}`,
                      background: '#fff', color: primary, fontWeight: 700, fontSize: '0.82rem',
                      cursor: 'pointer',
                    }}
                  >
                    {custStockVisible >= (custShopSearch.trim() ? rows.filter(r => (r.shop_name||'').toLowerCase().includes(custShopSearch.toLowerCase())) : rows).length
                      ? `▲ Show Less`
                      : `▼ Show More (${(custShopSearch.trim() ? rows.filter(r => (r.shop_name||'').toLowerCase().includes(custShopSearch.toLowerCase())) : rows).length - custStockVisible} more)`}
                  </button>
                </div>
              )}
              <div style={{ margin: '32px 0 0 0', textAlign: 'center', color: '#64748b', fontSize: 13, letterSpacing: 0.5 }}>
                Powered By Indomie
              </div>
            </>
          ) : section === 'sales' ? (
            // ---- UPDATED SALES TRENDS TABLE WITH PAGINATION (Top SKUs column removed) ----
            <>
              <table className={styles.custTable}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>#</th>
                    <th>Shop</th>
                    <th>Subregion</th>
                    <th className={styles.custThNum}>Visits</th>
                    <th className={styles.custThNum}>Cartons Sold</th>
                    <th className={styles.custThNum}>Not-Sold Visits</th>
                    <th className={styles.custThNum}>Last Visit</th>
                    {/* removed <th style={{ minWidth: 180 }}>Top SKUs</th> */}
                    <th style={{ width: 36 }} />
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, idx) => {
                    const isExpanded = expandedRow === row.shop_id;
                    // removed const topSkus = ...
                    return (
                      <React.Fragment key={row.shop_id}>
                        <tr
                          className={`${styles.custRow} ${isExpanded ? styles.custRowExpanded : ''}`}
                          onClick={() => setExpandedRow(isExpanded ? null : row.shop_id)}
                        >
                          <td className={styles.custTdIdx}>{idx + 1}</td>
                          <td>
                            <div className={styles.custShopCell}>
                              <div className={styles.custShopAvatar} style={{ background: `${primary}22`, color: primary }}>
                                {(row.shop_name || 'S').charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div className={styles.custShopName}>{row.shop_name}</div>
                                {row.shop_location && <div className={styles.custShopLoc}>📍 {row.shop_location}</div>}
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className={styles.custSubregionBadge}>{row.subregion_name}</span>
                          </td>
                          <td className={styles.custTdNum}>{row.period_visits}</td>
                          <td className={styles.custTdNum}>
                            <strong style={{ color: '#0f172a' }}>{(row.period_sold || 0).toLocaleString()}</strong>
                            <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}> ctn</span>
                          </td>
                          <td className={styles.custTdNum}>
                            {row.period_not_sold_visits > 0
                              ? <span style={{ color: '#ef4444' }}>{row.period_not_sold_visits}</span>
                              : <span style={{ color: '#94a3b8' }}>—</span>}
                          </td>
                          <td className={styles.custTdNum} style={{ color: '#64748b', fontSize: '0.82rem' }}>{row.last_visit_date || '—'}</td>
                          {/* removed <td> with SKU list */}
                          <td className={styles.custTdExpand}>
                            <span className={`${styles.custExpandChevron} ${isExpanded ? styles.custExpandChevronOpen : ''}`}>▾</span>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className={styles.custDetailRow}>
                            <td colSpan={8}> {/* changed from 9 to 8 */}
                              <div className={styles.custDetailWrap}>
                                <div className={styles.custDetailHeader}>
                                  🛒 Full SKU Purchase Breakdown
                                  {row.trend?.length > 0 && (
                                    <span style={{ marginLeft: 16, fontSize: '0.78rem', color: '#94a3b8' }}>
                                      {row.trend.length} active day{row.trend.length !== 1 ? 's' : ''} in period
                                    </span>
                                  )}
                                </div>

                                {row.by_sku.length === 0 ? (
                                  <p style={{ color: '#94a3b8', margin: 0 }}>No SKU data available.</p>
                                ) : (
                                  <div className={styles.custDetailSkuGrid}>
                                    {row.by_sku.map((s, i) => {
                                      const maxQty = row.by_sku[0] ? row.by_sku[0].sold : 1;
                                      const qty    = s.sold;
                                      const pct    = maxQty > 0 ? Math.round(qty / maxQty * 100) : 0;
                                      const color  = CHART_COLORS[i % CHART_COLORS.length];
                                      return (
                                        <div key={s.sku} className={styles.custDetailSkuRow}>
                                          <div className={styles.custDetailSkuInfo}>
                                            <span className={styles.custDetailSkuPill} style={{ background: color + '18', color }}>{s.sku}</span>
                                            <span className={styles.custDetailSkuName}>{s.name}</span>
                                          </div>
                                          <div className={styles.custDetailBar}>
                                            <div className={styles.custDetailBarTrack}>
                                              <div className={styles.custDetailBarFill} style={{ width: `${pct}%`, background: color }} />
                                            </div>
                                            <span className={styles.custDetailBarLabel}>
                                              {qty.toLocaleString()} <span style={{ color: '#94a3b8' }}>ctn</span>
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}

                                {row.trend?.length > 0 && (
                                  <div className={styles.custTrendWrap}>
                                    <div className={styles.custTrendTitle}>
                                      Recent Activity — {(() => {
                                        const trendPoints = row.trend.slice(-12);
                                        const firstValue = trendPoints[0]?.sold != null
                                          ? trendPoints[0].sold
                                          : (trendPoints[0]?.cartons ?? 0);
                                        const lastValue = trendPoints[trendPoints.length - 1]?.sold != null
                                          ? trendPoints[trendPoints.length - 1].sold
                                          : (trendPoints[trendPoints.length - 1]?.cartons ?? 0);
                                        const direction = lastValue > firstValue
                                          ? 'Increasing'
                                          : lastValue < firstValue
                                            ? 'Decreasing'
                                            : 'Stable';
                                        const color = direction === 'Increasing'
                                          ? '#16a34a'
                                          : direction === 'Decreasing'
                                            ? '#dc2626'
                                            : '#f59e0b';
                                        return <span style={{ color }}>{direction}</span>;
                                      })()}
                                    </div>
                                    <div className={styles.custTrendLineChart}>
                                      {(() => {
                                        const selectedPoint = selectedTrendPoint?.shopId === row.shop_id ? selectedTrendPoint : null;
                                        const recentPoints = row.trend.slice(-12).map((t, idx) => ({
                                          date: t.date,
                                          value: t.sold != null ? t.sold : (t.cartons ?? 0),
                                          skus: t.sold_skus || [],
                                          idx,
                                        }));

                                        if (!recentPoints.length) return null;
                                        const maxVal = Math.max(...recentPoints.map(p => p.value), 1);
                                        const width = Math.max(220, recentPoints.length * 56);
                                        const topPadding = 26;
                                        const bottomPadding = 34;
                                        const chartHeight = 60;
                                        const height = topPadding + chartHeight + bottomPadding;
                                        const xSpan = width - 24;
                                        const xStep = recentPoints.length > 1 ? xSpan / (recentPoints.length - 1) : 0;
                                        const baselineY = topPadding + chartHeight;

                                        const coords = recentPoints.map((p) => {
                                          const x = 12 + p.idx * xStep;
                                          const y = topPadding + chartHeight - (p.value / maxVal) * chartHeight;
                                          return { ...p, x, y };
                                        });
                                        const polyPoints = coords.map(p => `${p.x},${p.y}`).join(' ');

                                        return (
                                          <div ref={trendChartRef} style={{ width: '100%', overflowX: 'auto', position: 'relative' }}>
                                            <svg width={width} height={height} style={{ display: 'block' }}>
                                              <line x1={12} y1={baselineY} x2={width - 12} y2={baselineY} stroke="#cbd5e1" strokeWidth="1" />
                                              <polyline
                                                points={polyPoints}
                                                fill="none"
                                                stroke={primary}
                                                strokeWidth="2"
                                                strokeLinejoin="round"
                                                strokeLinecap="round"
                                              />
                                              {coords.map((p) => (
                                                <g key={p.date}>
                                                  <circle
                                                    cx={p.x}
                                                    cy={p.y}
                                                    r="18"
                                                    fill="rgba(255,255,255,0.01)"
                                                    style={{ cursor: 'pointer', pointerEvents: 'all' }}
                                                    onClick={() => {
                                                      const alreadySelected = selectedTrendPoint?.shopId === row.shop_id && selectedTrendPoint?.date === p.date;
                                                      setSelectedTrendPoint(alreadySelected ? null : { shopId: row.shop_id, date: p.date, value: p.value, skus: p.skus, x: p.x, y: p.y });
                                                    }}
                                                  />
                                                  <circle cx={p.x} cy={p.y} r="4" fill={primary} />
                                                  <text x={p.x} y={Math.max(12, p.y - 10)} textAnchor="middle" fontSize="10" fill={primary} fontWeight="700">
                                                    {p.value}
                                                  </text>
                                                  <text x={p.x} y={baselineY + 18} textAnchor="middle" fontSize="10" fill="#64748b">
                                                    {p.date.slice(5)}
                                                  </text>
                                                </g>
                                              ))}
                                            </svg>
                                            {selectedPoint && selectedPoint.shopId === row.shop_id && (
                                              <div style={{
                                                position: 'absolute',
                                                left: Math.min(width - 150, Math.max(8, selectedPoint.x - 70)),
                                                top: Math.max(8, selectedPoint.y - (selectedPoint.value > 0 ? 72 : 92)),
                                                zIndex: 10,
                                                width: 140,
                                                padding: '6px 8px',
                                                borderRadius: 12,
                                                border: '1px solid #cbd5e1',
                                                background: '#ffffff',
                                                boxShadow: '0 6px 18px rgba(15, 23, 42, 0.12)',
                                                color: '#0f172a',
                                                fontSize: '0.75rem',
                                              }}>
                                                <div style={{ fontWeight: 700, marginBottom: 4, lineHeight: 1.2 }}>
                                                  {selectedPoint.value > 0
                                                    ? `${selectedPoint.value.toLocaleString()} ctn`
                                                    : 'Not sold'}
                                                </div>
                                                {selectedPoint.value > 0 ? (
                                                  <div style={{ display: 'grid', gap: 3 }}>
                                                    {(selectedPoint.skus || []).slice(0, 2).map((sku, idx) => (
                                                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                                                        <span style={{ fontWeight: 700 }}>{sku.sku}</span>
                                                        <span style={{ color: '#64748b' }}>{sku.sold.toLocaleString()}</span>
                                                      </div>
                                                    ))}
                                                    {selectedPoint.skus.length > 2 && (
                                                      <div style={{ color: '#64748b' }}>+{selectedPoint.skus.length - 2} more</div>
                                                    )}
                                                  </div>
                                                ) : (
                                                  <div style={{ color: '#64748b' }}>No sales</div>
                                                )}
                                              </div>
                                            )}
                                            <div style={{ marginTop: 8, fontSize: '0.82rem', color: '#475569' }}>
                                              Lifetime Cartons Sold: <strong>{(row.total_sold || 0).toLocaleString()}</strong> ctn
                                              <span style={{ margin: '0 8px', color: '#94a3b8' }}>·</span>
                                              Lifetime Visits: <strong>{(row.total_visits || 0).toLocaleString()}</strong>
                                            </div>
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
              {/* ---- PAGINATION BUTTONS ---- */}
              {displayRows.length > 10 && (
                <div style={{ textAlign: 'center', marginTop: 16, marginBottom: 8 }}>
                  {salesVisibleCount < displayRows.length ? (
                    <button
                      onClick={() => setSalesVisibleCount(prev => Math.min(prev + 10, displayRows.length))}
                      style={{
                        padding: '8px 28px', borderRadius: 20,
                        border: `1.5px solid ${primary}`,
                        background: '#fff', color: primary,
                        fontWeight: 700, fontSize: '0.82rem',
                        cursor: 'pointer',
                      }}
                    >
                      &#9660; Load {Math.min(10, displayRows.length - salesVisibleCount)} more
                    </button>
                  ) : (
                    <button
                      onClick={() => setSalesVisibleCount(10)}
                      style={{
                        padding: '8px 28px', borderRadius: 20,
                        border: `1.5px solid ${primary}`,
                        background: '#fff', color: primary,
                        fontWeight: 700, fontSize: '0.82rem',
                        cursor: 'pointer',
                      }}
                    >
                      &#9650; Show less
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            // ---- UPLIFTS TABLE (unchanged) ----
            <table className={styles.custTable}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <th>Shop</th>
                  <th>Subregion</th>
                  <th className={styles.custThNum}>Requests</th>
                  <th className={styles.custThNum}>Cartons</th>
                  <th className={styles.custThNum} style={{ color: '#16a34a' }}>Approved</th>
                  <th className={styles.custThNum} style={{ color: '#dc2626' }}>Rejected</th>
                  <th className={styles.custThNum} style={{ color: '#f59e0b' }}>Pending</th>
                  <th className={styles.custThNum}>Last Uplift</th>
                  <th style={{ minWidth: 180 }}>Top SKUs</th>
                  <th style={{ width: 36 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const isExpanded = expandedRow === row.shop_id;
                  const topSkus    = (row.by_sku || []).slice(0, 3);
                  return (
                    <React.Fragment key={row.shop_id}>
                      <tr
                        className={`${styles.custRow} ${isExpanded ? styles.custRowExpanded : ''}`}
                        onClick={() => setExpandedRow(isExpanded ? null : row.shop_id)}
                      >
                        <td className={styles.custTdIdx}>{idx + 1}</td>
                        <td>
                          <div className={styles.custShopCell}>
                            <div className={styles.custShopAvatar} style={{ background: `${primary}22`, color: primary }}>
                              {(row.shop_name || 'S').charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className={styles.custShopName}>{row.shop_name}</div>
                              {row.shop_location && <div className={styles.custShopLoc}>📍 {row.shop_location}</div>}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={styles.custSubregionBadge}>{row.subregion_name}</span>
                        </td>
                        <td className={styles.custTdNum}>{row.total_uplifts}</td>
                        <td className={styles.custTdNum}>
                          <strong style={{ color: '#0f172a' }}>{(row.total_cartons_uplifted || 0).toLocaleString()}</strong>
                          <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}> ctn</span>
                        </td>
                        <td className={styles.custTdNum}>
                          <span className={styles.custBadgeApproved}>{row.approved_uplifts}</span>
                        </td>
                        <td className={styles.custTdNum}>
                          {row.rejected_uplifts > 0
                            ? <span className={styles.custBadgeRejected}>{row.rejected_uplifts}</span>
                            : <span style={{ color: '#94a3b8' }}>—</span>}
                        </td>
                        <td className={styles.custTdNum}>
                          {row.pending_uplifts > 0
                            ? <span className={styles.custBadgePending}>{row.pending_uplifts}</span>
                            : <span style={{ color: '#94a3b8' }}>—</span>}
                        </td>
                        <td className={styles.custTdNum} style={{ color: '#64748b', fontSize: '0.82rem' }}>{row.last_uplift_date || '—'}</td>
                        <td>
                          <div className={styles.custSkuList}>
                            {topSkus.map((s, i) => (
                              <span key={s.sku} className={styles.custSkuChip} style={{ background: CHART_COLORS[i % CHART_COLORS.length] + '18', color: CHART_COLORS[i % CHART_COLORS.length] }}>
                                {s.sku}
                                <span className={styles.custSkuQty}>{s.cartons}</span>
                              </span>
                            ))}
                            {Array.isArray(row.by_sku) && row.by_sku.length > 3 && (
                              <span className={styles.custSkuMore}>+{row.by_sku.length - 3}</span>
                            )}
                          </div>
                        </td>
                        <td className={styles.custTdExpand}>
                          <span className={`${styles.custExpandChevron} ${isExpanded ? styles.custExpandChevronOpen : ''}`}>▾</span>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className={styles.custDetailRow}>
                          <td colSpan={11}>
                            <div className={styles.custDetailWrap}>
                              <div className={styles.custDetailHeader}>
                                📦 Full SKU Uplift Breakdown
                                {row.trend?.length > 0 && (
                                  <span style={{ marginLeft: 16, fontSize: '0.78rem', color: '#94a3b8' }}>
                                    {row.trend.length} active day{row.trend.length !== 1 ? 's' : ''} in period
                                  </span>
                                )}
                              </div>

                              {row.by_sku.length === 0 ? (
                                <p style={{ color: '#94a3b8', margin: 0 }}>No SKU data available.</p>
                              ) : (
                                <div className={styles.custDetailSkuGrid}>
                                  {row.by_sku.map((s, i) => {
                                    const maxQty = row.by_sku[0] ? row.by_sku[0].cartons : 1;
                                    const qty    = s.cartons;
                                    const pct    = maxQty > 0 ? Math.round(qty / maxQty * 100) : 0;
                                    const color  = CHART_COLORS[i % CHART_COLORS.length];
                                    return (
                                      <div key={s.sku} className={styles.custDetailSkuRow}>
                                        <div className={styles.custDetailSkuInfo}>
                                          <span className={styles.custDetailSkuPill} style={{ background: color + '18', color }}>{s.sku}</span>
                                          <span className={styles.custDetailSkuName}>{s.name}</span>
                                        </div>
                                        <div className={styles.custDetailBar}>
                                          <div className={styles.custDetailBarTrack}>
                                            <div className={styles.custDetailBarFill} style={{ width: `${pct}%`, background: color }} />
                                          </div>
                                          <span className={styles.custDetailBarLabel}>
                                            {qty.toLocaleString()} <span style={{ color: '#94a3b8' }}>ctn</span>
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {row.trend?.length > 0 && (
                                <div className={styles.custTrendWrap}>
                                  <div className={styles.custTrendTitle}>
                                    Recent Activity — {(() => {
                                      const trendPoints = row.trend.slice(-12);
                                      const firstValue = trendPoints[0]?.sold != null
                                        ? trendPoints[0].sold
                                        : (trendPoints[0]?.cartons ?? 0);
                                      const lastValue = trendPoints[trendPoints.length - 1]?.sold != null
                                        ? trendPoints[trendPoints.length - 1].sold
                                        : (trendPoints[trendPoints.length - 1]?.cartons ?? 0);
                                      const direction = lastValue > firstValue
                                        ? 'Increasing'
                                        : lastValue < firstValue
                                          ? 'Decreasing'
                                          : 'Stable';
                                      const color = direction === 'Increasing'
                                        ? '#16a34a'
                                        : direction === 'Decreasing'
                                          ? '#dc2626'
                                          : '#f59e0b';
                                      return <span style={{ color }}>{direction}</span>;
                                    })()}
                                  </div>
                                  <div className={styles.custTrendLineChart}>
                                    {(() => {
                                      const recentPoints = row.trend.slice(-12).map((t, idx) => ({
                                        date: t.date,
                                        value: t.sold != null ? t.sold : (t.cartons ?? 0),
                                        idx,
                                      }));

                                      if (!recentPoints.length) return null;
                                      const maxVal = Math.max(...recentPoints.map(p => p.value), 1);
                                      const width = Math.max(220, recentPoints.length * 56);
                                      const topPadding = 26;
                                      const bottomPadding = 34;
                                      const chartHeight = 60;
                                      const height = topPadding + chartHeight + bottomPadding;
                                      const xSpan = width - 24;
                                      const xStep = recentPoints.length > 1 ? xSpan / (recentPoints.length - 1) : 0;
                                      const baselineY = topPadding + chartHeight;

                                      const coords = recentPoints.map((p) => {
                                        const x = 12 + p.idx * xStep;
                                        const y = topPadding + chartHeight - (p.value / maxVal) * chartHeight;
                                        return { ...p, x, y };
                                      });
                                      const polyPoints = coords.map(p => `${p.x},${p.y}`).join(' ');

                                      return (
                                        <div style={{ width: '100%', overflowX: 'auto' }}>
                                          <svg width={width} height={height} style={{ display: 'block' }}>
                                            <line x1={12} y1={baselineY} x2={width - 12} y2={baselineY} stroke="#cbd5e1" strokeWidth="1" />
                                            <polyline
                                              points={polyPoints}
                                              fill="none"
                                              stroke={primary}
                                              strokeWidth="2"
                                              strokeLinejoin="round"
                                              strokeLinecap="round"
                                            />
                                            {coords.map((p) => (
                                              <g key={p.date}>
                                                <circle
                                                  cx={p.x}
                                                  cy={p.y}
                                                  r="10"
                                                  fill="transparent"
                                                  style={{ cursor: 'pointer', pointerEvents: 'all' }}
                                                  onPointerEnter={() => setHoveredTrendPoint({ shopId: row.shop_id, date: p.date, value: p.value, skus: p.skus })}
                                                  onPointerMove={() => setHoveredTrendPoint({ shopId: row.shop_id, date: p.date, value: p.value, skus: p.skus })}
                                                  onPointerLeave={() => setHoveredTrendPoint(null)}
                                                />
                                                <circle
                                                  cx={p.x}
                                                  cy={p.y}
                                                  r="4"
                                                  fill={primary}
                                                />
                                                <text x={p.x} y={Math.max(12, p.y - 10)} textAnchor="middle" fontSize="10" fill={primary} fontWeight="700">
                                                  {p.value}
                                                </text>
                                                <text x={p.x} y={baselineY + 18} textAnchor="middle" fontSize="10" fill="#64748b">
                                                  {p.date.slice(5)}
                                                </text>
                                              </g>
                                            ))}
                                          </svg>
                                          {hoveredPoint && (
                                            <div style={{
                                              marginTop: 10,
                                              padding: '10px 12px',
                                              borderRadius: 16,
                                              border: '1px solid #e2e8f0',
                                              background: '#f8fafc',
                                              color: '#0f172a',
                                              fontSize: '0.82rem',
                                            }}>
                                              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                                                {hoveredPoint.date} · {hoveredPoint.value > 0 ? `${hoveredPoint.value.toLocaleString()} cartons sold` : 'Not Sold'}
                                              </div>
                                              {hoveredPoint.value > 0 ? (
                                                hoveredPoint.skus.length > 0 ? (
                                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                                    {hoveredPoint.skus.map((sku, idx) => (
                                                      <div key={idx} style={{
                                                        padding: '6px 10px',
                                                        borderRadius: 12,
                                                        background: '#ffffff',
                                                        border: '1px solid #e2e8f0',
                                                        minWidth: 120,
                                                        fontSize: '0.8rem',
                                                      }}>
                                                        <strong>{sku.sku}</strong>
                                                        {sku.name ? ` · ${sku.name}` : ''}
                                                        <div style={{ color: '#64748b', marginTop: 2 }}>
                                                          {sku.sold.toLocaleString()} ctn
                                                        </div>
                                                      </div>
                                                    ))}
                                                  </div>
                                                ) : (
                                                  <div style={{ color: '#64748b' }}>Sold, SKU details unavailable.</div>
                                                )
                                              ) : (
                                                <div style={{ color: '#64748b' }}>Not Sold</div>
                                              )}
                                            </div>
                                          )}
                                          <div style={{ marginTop: 8, fontSize: '0.82rem', color: '#475569' }}>
                                            Lifetime Cartons Sold: <strong>{(row.total_sold || 0).toLocaleString()}</strong> ctn
                                          </div>
                                        </div>
                                      );
                                    })()}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      <ReportPreviewModal
        open={custPreviewOpen}
        onClose={() => setCustPreviewOpen(false)}
        title={section === 'sales' ? 'Customer Sales Analysis' : section === 'uplifts' ? 'Uplift Analysis' : 'Stock Positions'}
        subtitle={dateFrom ? `${dateFrom}${dateTo ? ' → ' + dateTo : ''}` : `${MONTHS[parseInt(month) - 1]} ${year}`}
        headers={
          section === 'stock'
            ? ['Shop', 'Subregion', 'SKU', 'Product Name', 'Stock Position', 'Last Recorded']
            : section === 'uplifts'
            ? ['#', 'Shop', 'Location', 'Subregion', 'Uplift Requests', 'Approved', 'Rejected', 'Pending', 'Cartons Uplifted', 'Last Uplift']
            : ['#', 'Shop', 'Location', 'Subregion', 'Visits', 'Cartons Sold', 'Not-Sold Visits', 'Last Visit', 'Top SKU']
        }
        rows={
          section === 'stock'
            ? rows.flatMap(r => {
                const sks = r.skus || [];
                if (sks.length === 0) return [[r.shop_name, r.subregion_name, '', '', 0, r.last_visit_date || '—']];
                return sks.map(sk => [r.shop_name, r.subregion_name, sk.sku, sk.name, sk.stock_position, sk.visit_date || '—']);
              })
            : section === 'uplifts'
            ? rows.map((r, i) => [i + 1, r.shop_name, r.shop_location || '', r.subregion_name, r.total_uplifts, r.approved_uplifts, r.rejected_uplifts, r.pending_uplifts, r.total_cartons_uplifted, r.last_uplift_date || '—'])
            : rows.map((r, i) => [i + 1, r.shop_name, r.shop_location || '', r.subregion_name, r.period_visits, r.period_sold, r.period_not_sold_visits, r.last_visit_date || '—', r.top_sku || '—'])
        }
        onExport={handleExcelExport}
      />
    </div>
  );
}

/* ── Map Tab (Corrected) ──────────────────────────────────────────────────── */
function MapTab({ token, primary, accent, regionFilter }) {
  const mapRef        = useRef(null);
  const leafletMapRef = useRef(null);
  const markersRef    = useRef([]);
  const tileLayerRef  = useRef(null);
  const labelLayerRef = useRef(null);
  const popupRef      = useRef(null);

  const now = new Date();
  const [year,        setYear]        = useState(String(now.getFullYear()));
  const [month,       setMonth]       = useState(String(now.getMonth() + 1));
  const [dateFrom,    setDateFrom]    = useState('');
  const [dateTo,      setDateTo]      = useState('');
  const [regionId,    setRegionId]    = useState(regionFilter || '');
  const [subregionId, setSubregionId] = useState('');
  const [userId,      setUserId]      = useState('');

  useEffect(() => { setRegionId(regionFilter || ''); }, [regionFilter]);

  const [regions,     setRegions]     = useState([]);
  const [subregions,  setSubregions]  = useState([]);
  const [users,       setUsers]       = useState([]);

  const filteredUsers = regionId
    ? users.filter(u => (u.user_regions || []).some(r => String(r.region_id) === String(regionId)))
    : users;

  const [markers,     setMarkers]     = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [mapReady,    setMapReady]    = useState(false);
  const [activeMarker, setActiveMarker] = useState(null);

  const [selfieUrl, setSelfieUrl] = useState(null);

  const [satellite, setSatellite] = useState(false);
  const [mapFullscreenOpen, setMapFullscreenOpen] = useState(false);
  const [showAllShops,     setShowAllShops]     = useState(false);
  const [showOnlyUnvisited, setShowOnlyUnvisited] = useState(false);

  const MONTHS = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  const YEARS = Array.from({ length: 5 }, (_, i) => String(now.getFullYear() - i));

  const loadSelfie = async (selfiePath) => {
    if (!selfiePath) return;
    try {
      const res = await fetch(`/api/admin/signed-url?path=${encodeURIComponent(selfiePath)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.url) {
        setSelfieUrl(data.url);
      } else {
        setSelfieUrl(null);
      }
    } catch (err) {
      console.error('Failed to load selfie', err);
      setSelfieUrl(null);
    }
  };

  useEffect(() => {
    setSelfieUrl(null);
  }, [activeMarker]);

  useEffect(() => {
    async function loadMeta() {
      if (_mapMetaCache.token === token && _mapMetaCache.regions && _mapMetaCache.users) {
        setRegions(_mapMetaCache.regions);
        setUsers(_mapMetaCache.users);
        return;
      }
      try {
        const [rRes, uRes] = await Promise.all([
          fetch('/api/admin/map-regions',  { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/admin/map-users',    { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        const rData = await rRes.json();
        const uData = await uRes.json();
        if (rRes.ok) { const r = Array.isArray(rData) ? rData : []; _mapMetaCache.token = token; _mapMetaCache.regions = r; setRegions(r); }
        if (uRes.ok) { const u = Array.isArray(uData) ? uData : []; _mapMetaCache.users = u; setUsers(u); }
      } catch { /* silent */ }
    }
    if (token) loadMeta();
  }, [token]);

  useEffect(() => {
    setSubregionId('');
    setSubregions([]);
    setUserId('');
    if (!regionId) return;
    async function loadSubs() {
      try {
        const r = await fetch(`/api/admin/map-regions?region_id=${regionId}`, { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json();
        if (r.ok) setSubregions(Array.isArray(d) ? d : []);
      } catch { /* silent */ }
    }
    loadSubs();
  }, [regionId, token]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (leafletMapRef.current) return;
    if (!mapRef.current) return;
    if (mapRef.current._leaflet_id) return;

    let mounted = true;

    import('leaflet').then(L => {
      if (!mounted || !mapRef.current || mapRef.current._leaflet_id) return;

      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const map = L.map(mapRef.current, {
        center: [-1.286389, 36.817223],
        zoom: 11,
        zoomControl: true,
      });

      tileLayerRef.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      });
      tileLayerRef.current.addTo(map);

      leafletMapRef.current = map;
      if (mounted) setMapReady(true);
    });

    return () => {
      mounted = false;
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !leafletMapRef.current || !tileLayerRef.current) return;
    import('leaflet').then(L => {
      tileLayerRef.current.remove();
      if (labelLayerRef.current) { labelLayerRef.current.remove(); labelLayerRef.current = null; }

      const url = satellite
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      const attribution = satellite
        ? 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
        : '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
      tileLayerRef.current = L.tileLayer(url, { attribution, maxZoom: 19 });
      tileLayerRef.current.addTo(leafletMapRef.current);

      if (satellite) {
        labelLayerRef.current = L.tileLayer(
          'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
          { maxZoom: 19, opacity: 1, pane: 'overlayPane' }
        );
        labelLayerRef.current.addTo(leafletMapRef.current);
      }

      markersRef.current.forEach(m => { try { m.bringToFront(); } catch { /* ignore */ } });
    });
  }, [satellite, mapReady]);

  // ── Marker rendering ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || typeof window === 'undefined') return;

    import('leaflet').then(L => {
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];

      if (markers.length === 0) return;

      const bounds = [];

      const displayList = showOnlyUnvisited
        ? markers.filter(m => m.type === 'unvisited')
        : markers;

      displayList.forEach(m => {
        const isUnvisited = m.type === 'unvisited';

        // Determine the base color and extra styling based on showAllShops
        let bgColor, borderColor, dotColor, emoji;

        if (showAllShops) {
          // ── Show‑all‑shops mode ──
          if (isUnvisited) {
            bgColor = '#374151';
            borderColor = '#1f2937';
            dotColor = '#374151';
            emoji = '';
          } else {
            // Visited shops: white circle with colored border and a small inner dot
            bgColor = '#ffffff';
            // border color based on type
            if (m.type === 'sold') borderColor = '#16a34a';
            else if (m.type === 'uplift') borderColor = '#d97706';
            else borderColor = '#dc2626'; // not_sold
            dotColor = borderColor;
            emoji = ''; // we could add a small dot inside via HTML
          }
        } else {
          // ── Normal mode ──
          if (isUnvisited) {
            bgColor = '#374151';
            borderColor = '#1f2937';
            dotColor = '#374151';
            emoji = '';
          } else {
            if (m.type === 'sold') {
              bgColor = '#16a34a';
              borderColor = '#16a34a';
              dotColor = '#16a34a';
              emoji = '🟢';
            } else if (m.type === 'uplift') {
              bgColor = '#d97706';
              borderColor = '#d97706';
              dotColor = '#d97706';
              emoji = '🟡';
            } else {
              bgColor = '#dc2626';
              borderColor = '#dc2626';
              dotColor = '#dc2626';
              emoji = '🔴';
            }
          }
        }

        // Build icon HTML
        let iconHtml;
        if (isUnvisited) {
          iconHtml = `<div style="width:26px;height:26px;border-radius:50%;background:${bgColor};border:2.5px solid ${borderColor};box-shadow:0 1px 6px rgba(0,0,0,0.4);cursor:pointer;opacity:0.7;"></div>`;
        } else {
          if (showAllShops) {
            // White circle with coloured border and small coloured dot in centre
            iconHtml = `<div style="width:34px;height:34px;border-radius:50%;background:${bgColor};border:3px solid ${borderColor};box-shadow:0 2px 8px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:transform .15s;">
              <div style="width:10px;height:10px;border-radius:50%;background:${dotColor};"></div>
            </div>`;
          } else {
            // Normal coloured circle with emoji
            iconHtml = `<div style="width:34px;height:34px;border-radius:50%;background:${bgColor};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;font-size:14px;cursor:pointer;transition:transform .15s;">${emoji}</div>`;
          }
        }

        const icon = L.divIcon({
          className: '',
          html: iconHtml,
          iconSize: isUnvisited ? [26, 26] : [34, 34],
          iconAnchor: isUnvisited ? [13, 13] : [17, 17],
          popupAnchor: [0, -16],
        });

        const fmtDate = iso => new Date(iso).toLocaleString('en-GB', {
          day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });

        // Build popup content
        let popupHtml;
        if (m.type === 'unvisited') {
          popupHtml = `
            <div style="width:230px;font-family:system-ui,sans-serif;font-size:0.82rem;padding:2px 0">
              <div style="font-weight:700;font-size:0.94rem;color:#1e293b;margin-bottom:3px">${m.shop_name}</div>
              ${m.shop_location ? `<div style="font-size:0.7rem;color:#64748b;margin-bottom:6px;display:flex;align-items:center;gap:3px">📍 ${m.shop_location}</div>` : ''}
              <div style="margin-bottom:6px"><span style="display:inline-flex;align-items:center;gap:5px;background:#374151;color:#f9fafb;padding:3px 11px;border-radius:20px;font-size:0.72rem;font-weight:700;letter-spacing:0.02em">● Not Yet Visited</span></div>
              <div>
                <a href="https://www.google.com/maps?q=&layer=c&cbll=${m.latitude},${m.longitude}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:4px 12px;background:#1a73e8;color:#fff;border-radius:6px;font-size:0.72rem;font-weight:700;text-decoration:none">🗣 Street View</a>
              </div>
            </div>`;
        } else {
          // Popup for visited / uplift
          const color = showAllShops ? (m.type === 'sold' ? '#16a34a' : m.type === 'uplift' ? '#d97706' : '#dc2626') :
            (m.type === 'sold' ? '#16a34a' : m.type === 'uplift' ? '#d97706' : '#dc2626');
          const label = m.type === 'sold' ? '✅ Sold' : m.type === 'uplift' ? `📦 Uplift${m.uplift_status ? ' · ' + m.uplift_status : ''}` : '❌ Not Sold';
          const skuText = m.type === 'not_sold'
            ? (m.not_sold_reason ? `Reason: ${m.not_sold_reason}` : 'Reason not recorded')
            : (m.skus || [])
              .filter(s => {
                if (m.type === 'sold')   return s.sold > 0;
                if (m.type === 'uplift') return s.cartons_uplifted > 0;
                return true;
              })
              .map(s =>
                m.type === 'uplift'
                  ? `${s.sku}: ${s.cartons_uplifted} ctn uplifted`
                  : `${s.sku}: ${s.sold} ctn sold`
              ).join('<br>');

          const selfieImg = m.selfie_url
            ? `<img src="${m.selfie_url}" style="width:100%;max-height:160px;object-fit:contain;background:#f1f5f9;border-radius:6px;margin-bottom:6px;display:block;"><br>`
            : '';

          popupHtml = `
            ${selfieImg}
            <b>${m.shop_name}</b><br>
            ${m.shop_location || ''}<br>
            <span style="color:${color}">${label}</span><br>
            👤 ${m.salesperson_name}<br>
            🕒 ${fmtDate(m.visited_at)}<br><hr>
            ${skuText}
            ${m.type === 'sold' ? `<br><b>Total: ${m.total_sold} ctn</b>` : ''}
            ${m.type === 'uplift' ? `<br><b>Total uplifted: ${m.total_uplifted} ctn</b>` : ''}
            ${m.rejected_reason ? `<br><span style="color:#dc2626;font-weight:600">❌ Rejection reason: ${m.rejected_reason}</span>` : ''}
            <br><a href="https://www.google.com/maps?q=&layer=c&cbll=${m.latitude},${m.longitude}" target="_blank" style="display:inline-block;margin-top:6px;font-size:11px;color:#2563eb;font-weight:600;text-decoration:none">📍 Street View</a>
          `.trim();
        }

        const lMarker = L.marker([m.latitude, m.longitude], { icon })
          .addTo(leafletMapRef.current);

        lMarker.bindPopup(popupHtml, { maxWidth: 320 });

        if (m.type !== 'unvisited') {
          lMarker.on('click', () => {
            setActiveMarker(m);
            if (m.selfie_path) {
              loadSelfie(m.selfie_path);
            } else {
              setSelfieUrl(null);
            }
          });
        } else {
          lMarker.on('click', () => setActiveMarker(m));
        }

        markersRef.current.push(lMarker);
        bounds.push([m.latitude, m.longitude]);
      });

      if (bounds.length > 0) {
        leafletMapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      }
    });
  }, [markers, mapReady, showOnlyUnvisited, showAllShops]);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(''); setActiveMarker(null); setShowOnlyUnvisited(false);
    try {
      const params = new URLSearchParams();
      if (dateFrom || dateTo) {
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo)   params.set('date_to',   dateTo);
      } else {
        params.set('year', year);
        params.set('month', month);
      }
      if (regionId)    params.set('region_id',    regionId);
      if (subregionId) params.set('subregion_id', subregionId);
      if (userId)      params.set('user_id',       userId);
      if (showAllShops) params.set('show_all', '1');

      const r = await fetch(`/api/admin/map-data?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || 'Failed to load map data');
        setMarkers([]);
        return;
      }
      setMarkers(Array.isArray(d) ? d : []);
    } catch {
      setError('Network error.');
      setMarkers([]);
    } finally {
      setLoading(false);
    }
  }, [token, year, month, dateFrom, dateTo, regionId, subregionId, userId, showAllShops]);

  useEffect(() => {
    if (token && mapReady) fetchData();
  }, [token, mapReady, fetchData]);

  const handleExport = () => {
    const fmtDate = iso => new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    const markerJs = markers.map(m => {
      if (m.type === 'unvisited') {
        const safeId = String(m.id).replace(/[^a-zA-Z0-9]/g, '');
        const popup = `<b>${m.shop_name}</b>${m.shop_location ? `<br><small style="color:#6b7280">📍 ${m.shop_location}</small>` : ''}<br><span style="background:#374151;color:#f9fafb;padding:1px 8px;border-radius:12px;font-size:11px;font-weight:700">● Not Yet Visited</span><br><a href="https://www.google.com/maps?q=&layer=c&cbll=${m.latitude},${m.longitude}" target="_blank" style="font-size:11px;color:#2563eb;font-weight:600;text-decoration:none">📍 Street View</a>`;
        return `
          var icon${safeId} = L.divIcon({ className:'', html:'<div style="width:22px;height:22px;border-radius:50%;background:#374151;border:2.5px solid rgba(255,255,255,0.85);box-shadow:0 1px 5px rgba(0,0,0,0.45);opacity:0.72;"></div>', iconSize:[22,22], iconAnchor:[11,11] });
          L.marker([${m.latitude},${m.longitude}],{icon:icon${safeId}}).addTo(map).bindPopup(${JSON.stringify(popup)});
        `;
      }
      const color = m.type === 'sold' ? '#16a34a' : m.type === 'uplift' ? '#d97706' : '#dc2626';
      const label = m.type === 'sold' ? '✅ Sold' : m.type === 'uplift' ? `📦 Uplift${m.uplift_status ? ' · ' + m.uplift_status : ''}` : '❌ Not Sold';
      const skuText = m.type === 'not_sold'
        ? (m.not_sold_reason ? `Reason: ${m.not_sold_reason}` : 'Reason not recorded')
        : (m.skus || [])
          .filter(s => {
            if (m.type === 'sold')   return s.sold > 0;
            if (m.type === 'uplift') return s.cartons_uplifted > 0;
            return true;
          })
          .map(s =>
            m.type === 'uplift'
              ? `${s.sku}: ${s.cartons_uplifted} ctn uplifted`
              : `${s.sku}: ${s.sold} ctn sold`
          ).join('<br>');

      const selfieImg = m.selfie_url
        ? `<img src="${m.selfie_url}" style="width:100%;max-height:160px;object-fit:contain;background:#f1f5f9;border-radius:6px;margin-bottom:6px;display:block;"><br>`
        : '';

      const popup = `
        ${selfieImg}
        <b>${m.shop_name}</b><br>
        ${m.shop_location || ''}<br>
        <span style="color:${color}">${label}</span><br>
        👤 ${m.salesperson_name}<br>
        🕒 ${fmtDate(m.visited_at)}<br><hr>
        ${skuText}
        ${m.type === 'sold' ? `<br><b>Total: ${m.total_sold} ctn</b>` : ''}
        ${m.type === 'uplift' ? `<br><b>Total uplifted: ${m.total_uplifted} ctn</b>` : ''}
        ${m.rejected_reason ? `<br><span style="color:#dc2626;font-weight:600">❌ Rejection reason: ${m.rejected_reason}</span>` : ''}
        <br><a href="https://www.google.com/maps?q=&layer=c&cbll=${m.latitude},${m.longitude}" target="_blank" style="display:inline-block;margin-top:6px;font-size:11px;color:#2563eb;font-weight:600;text-decoration:none">📍 Street View</a>
      `.trim();

      return `
        var icon${m.id.replace('-','')} = L.divIcon({
          className:'',
          html:'<div style="width:28px;height:28px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>',
          iconSize:[28,28],iconAnchor:[14,14]
        });
        L.marker([${m.latitude},${m.longitude}],{icon:icon${m.id.replace('-','')}})
          .addTo(map)
          .bindPopup(${JSON.stringify(popup)});
      `;
    }).join('\n');

    const regionLabel    = regions.find(r => String(r.id) === regionId)?.name || 'All Regions';
    const subLabel       = subregions.find(s => String(s.id) === subregionId)?.name || 'All Subregions';
    const userLabel      = users.find(u => u.id === userId)?.full_name || 'All Salespersons';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Map Export — ${MONTHS[parseInt(month)-1]} ${year}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
  body{margin:0;font-family:system-ui,sans-serif}
  #map{height:100vh;width:100%}
  #legend{position:fixed;top:16px;left:60px;background:#fff;padding:12px 16px;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.15);z-index:1000;font-size:13px}
  #legend h3{margin:0 0 8px;font-size:14px}
  .leg{display:flex;align-items:center;gap:8px;margin-bottom:5px}
  .dot{width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.2)}
</style>
</head>
<body>
<div id="map"></div>
<div id="legend">
  <h3>🗺️ ${MONTHS[parseInt(month)-1]} ${year}</h3>
  <div style="font-size:11px;color:#64748b;margin-bottom:8px">${regionLabel} › ${subLabel}<br>${userLabel}</div>
  <div class="leg"><div class="dot" style="background:#16a34a"></div> Sold (${markers.filter(m=>m.type==='sold').length})</div>
  <div class="leg"><div class="dot" style="background:#dc2626"></div> Not Sold (${markers.filter(m=>m.type==='not_sold').length})</div>
  <div class="leg"><div class="dot" style="background:#d97706"></div> Uplift (${markers.filter(m=>m.type==='uplift').length})</div>
  ${markers.some(m=>m.type==='unvisited') ? `<div class="leg"><div class="dot" style="background:#374151;border:2px solid rgba(255,255,255,0.7);"></div> Unvisited (${markers.filter(m=>m.type==='unvisited').length})</div>` : ''}
  
</div>
<div id="tile-toggle" style="position:fixed;top:16px;right:10px;z-index:1000;display:flex;gap:4px">
  <button id="btn-default" onclick="setTile(false)" style="height:32px;padding:0 12px;border:none;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.2);background:#0f766e;color:#fff">🗺 Default</button>
  <button id="btn-sat" onclick="setTile(true)" style="height:32px;padding:0 12px;border:none;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.2);background:rgba(255,255,255,0.9);color:#1e293b">🛰 Satellite</button>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map = L.map('map').setView([${markers[0]?.latitude || -1.286389},${markers[0]?.longitude || 36.817223}],12);
var tileLayer, labelLayer;
function setTile(sat) {
  if (tileLayer) tileLayer.remove();
  if (labelLayer) { labelLayer.remove(); labelLayer = null; }
  var bd = document.getElementById('btn-default'), bs = document.getElementById('btn-sat');
  if (sat) {
    tileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom:19,attribution:'&copy; Esri'}).addTo(map);
    labelLayer = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {maxZoom:19,pane:'overlayPane'}).addTo(map);
    bs.style.background='#1d4ed8'; bs.style.color='#fff';
    bd.style.background='rgba(255,255,255,0.9)'; bd.style.color='#1e293b';
  } else {
    tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {attribution:'&copy; OpenStreetMap contributors &copy; CARTO',maxZoom:19}).addTo(map);
    bd.style.background='#0f766e'; bd.style.color='#fff';
    bs.style.background='rgba(255,255,255,0.9)'; bs.style.color='#1e293b';
  }
}
setTile(false);
${markerJs}
</script>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `map-export-${year}-${String(month).padStart(2,'0')}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const soldCount       = markers.filter(m => m.type === 'sold').length;
  const notSoldCount    = markers.filter(m => m.type === 'not_sold').length;
  const upliftCount     = markers.filter(m => m.type === 'uplift').length;
  const unvisitedCount  = markers.filter(m => m.type === 'unvisited').length;
  const visitedShopIds  = new Set(markers.filter(m => m.type !== 'unvisited').map(m => m.shop_id).filter(Boolean));
  const visitedShopCount = visitedShopIds.size;
  const totalShopCount   = showAllShops ? (visitedShopCount + unvisitedCount) : null;
  const coveragePct      = totalShopCount > 0 ? Math.round((visitedShopCount / totalShopCount) * 100) : null;

  return (
    <div className={styles.mapWrap}>
      <div className={styles.mapFilterBar}>
        <div className={styles.mapFilterTitle}>🗺️ Map View</div>

        <div className={styles.mapFilters}>
          <input
            type="date"
            className={styles.mapSelect}
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            title="From date"
          />
          <input
            type="date"
            className={styles.mapSelect}
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            title="To date"
          />

          <select className={styles.mapSelect} value={year} onChange={e => setYear(e.target.value)} disabled={!!(dateFrom || dateTo)}>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          <select className={styles.mapSelect} value={month} onChange={e => setMonth(e.target.value)} disabled={!!(dateFrom || dateTo)}>
            {MONTHS.map((name, i) => (
              <option key={i+1} value={String(i+1)}>{name}</option>
            ))}
          </select>

          <select className={styles.mapSelect} value={regionId} onChange={e => setRegionId(e.target.value)}>
            <option value="">All Regions</option>
            {regions.map(r => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
          </select>

          <select className={styles.mapSelect} value={subregionId} onChange={e => setSubregionId(e.target.value)} disabled={!regionId || subregions.length === 0}>
            <option value="">All Subregions</option>
            {subregions.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </select>

          <select className={styles.mapSelect} value={userId} onChange={e => setUserId(e.target.value)}>
            <option value="">All Salespersons</option>
            {filteredUsers.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
          </select>

          <button
            className={styles.mapApplyBtn}
            style={{ background: primary }}
            onClick={fetchData}
            disabled={loading}
          >
            {loading ? '⏳ Loading…' : '🔍 Apply'}
          </button>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.8rem', color: '#475569', userSelect: 'none', whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={showAllShops}
              onChange={e => setShowAllShops(e.target.checked)}
              style={{ width: 15, height: 15, cursor: 'pointer' }}
            />
            Show All Shops
          </label>

          <button
            className={styles.mapExportBtn}
            onClick={handleExport}
            disabled={markers.length === 0 || loading}
            title="Download map as standalone HTML file"
          >
            ⬇ Download Map
          </button>

          <button
            className={styles.mapPreviewBtn}
            onClick={() => setMapFullscreenOpen(true)}
            disabled={markers.length === 0 || loading}
            title="Open map in full screen"
          >
            🖥 Preview Map
          </button>
        </div>
      </div>

      {error && <div className={styles.alertDanger} style={{ margin: '0 0 12px' }}>{error}</div>}

      {showAllShops && totalShopCount !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1e293b' }}>Coverage:</span>
          <span style={{ fontSize: '0.8rem', color: '#475569' }}>
            <strong style={{ color: '#16a34a' }}>{visitedShopCount}</strong> / {totalShopCount} shops
          </span>
          <div style={{ flex: '1 1 120px', maxWidth: 200, height: 8, borderRadius: 99, background: '#e2e8f0', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 99, background: '#16a34a', width: `${coveragePct}%`, transition: 'width 0.4s' }} />
          </div>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#16a34a' }}>{coveragePct}%</span>
          <button
            onClick={() => setShowOnlyUnvisited(v => !v)}
            style={{
              marginLeft: 4,
              padding: '3px 12px', borderRadius: 99, fontSize: '0.75rem', fontWeight: 600,
              border: `1.5px solid ${showOnlyUnvisited ? '#1f2937' : '#4b5563'}`, cursor: 'pointer',
              background: showOnlyUnvisited ? '#374151' : '#fff',
              color: showOnlyUnvisited ? '#f9fafb' : '#374151',
              transition: 'all 0.15s',
            }}
          >
            {showOnlyUnvisited ? '● Unvisited Only ✕' : '● Show Only Unvisited'}
          </button>
        </div>
      )}

      <div className={styles.mapLegend}>
        <span className={styles.mapLegendPill} style={{ background: '#dcfce7', color: '#166534' }}>
          🟢 Sold <strong>{soldCount}</strong>
        </span>
        <span className={styles.mapLegendPill} style={{ background: '#fee2e2', color: '#991b1b' }}>
          🔴 Not Sold <strong>{notSoldCount}</strong>
        </span>
        <span className={styles.mapLegendPill} style={{ background: '#fef3c7', color: '#92400e' }}>
          🟡 Uplift <strong>{upliftCount}</strong>
        </span>
        {showAllShops && (
          <span className={styles.mapLegendPill} style={{ background: '#374151', color: '#f9fafb', border: '1.5px solid #1f2937' }}>
            ● Unvisited <strong>{unvisitedCount}</strong>
          </span>
        )}
        <span className={styles.mapLegendPill} style={{ background: '#f1f5f9', color: '#475569' }}>
          Total <strong>{markers.length}</strong>
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', background: '#f1f5f9', borderRadius: 8, padding: 2, gap: 2, flexShrink: 0 }}>
          {[{ label: '🗺 Default', val: false }, { label: '🛰 Satellite', val: true }].map(opt => (
            <button
              key={String(opt.val)}
              onClick={() => setSatellite(opt.val)}
              style={{
                padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontSize: '0.75rem', fontWeight: 700, transition: 'background .15s',
                background: satellite === opt.val ? '#1e293b' : 'transparent',
                color:      satellite === opt.val ? '#f9fafb' : '#64748b',
              }}
            >{opt.label}</button>
          ))}
        </div>
      </div>

      <div className={styles.mapBody}>
        <div ref={mapRef} className={styles.mapContainer} />
        {loading && (
          <div className={styles.mapLoadOverlay}>
            <div className={styles.mapLoadCard}>
              <div className={styles.mapLoadSonar}>
                {[0, 0.7, 1.4].map((delay, i) => (
                  <div
                    key={i}
                    className={styles.mapLoadRing}
                    style={{ borderColor: primary || '#3b82f6', animationDelay: `${delay}s` }}
                  />
                ))}
                <div className={styles.mapLoadPinDot} style={{ background: primary || '#3b82f6' }}>
                  📍
                </div>
              </div>
              <div className={styles.mapLoadTitle}>Loading map data</div>
              <div className={styles.mapLoadSub}>Fetching visits &amp; uplifts&hellip;</div>
              <div className={styles.mapLoadDots}>
                {[0, 0.18, 0.36].map((delay, i) => (
                  <span
                    key={i}
                    className={styles.mapLoadDot}
                    style={{ background: primary || '#3b82f6', animationDelay: `${delay}s` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {activeMarker && (
          <div className={styles.mapDetailPanel}>
            <button className={styles.mapDetailClose} onClick={() => setActiveMarker(null)}>✕</button>

            {selfieUrl && (
              <img
                src={selfieUrl}
                alt="Selfie"
                className={styles.mapDetailSelfie}
              />
            )}

            <div className={styles.mapDetailShop}>{activeMarker.shop_name}</div>
            {activeMarker.shop_location && (
              <div className={styles.mapDetailLocation}>{activeMarker.shop_location}</div>
            )}

            {activeMarker.type === 'sold' && (
              <span className={styles.mapDetailBadge} style={{ background: '#dcfce7', color: '#166534' }}>✅ Sold</span>
            )}
            {activeMarker.type === 'not_sold' && (
              <span className={styles.mapDetailBadge} style={{ background: '#fee2e2', color: '#991b1b' }}>❌ Not Sold</span>
            )}
            {activeMarker.type === 'uplift' && (
              <span className={styles.mapDetailBadge} style={{ background: '#fef3c7', color: '#92400e' }}>
                📦 Uplift{activeMarker.uplift_status ? ` · ${activeMarker.uplift_status}` : ''}
              </span>
            )}
            {activeMarker.type === 'unvisited' && (
              <span className={styles.mapDetailBadge} style={{ background: '#374151', color: '#f9fafb', border: '1px solid #1f2937' }}>● Not Yet Visited</span>
            )}

            <div className={styles.mapDetailMeta}>
              {activeMarker.type !== 'unvisited' && activeMarker.salesperson_name && (
                <div>👤 <strong>{activeMarker.salesperson_name}</strong></div>
              )}
              {activeMarker.type !== 'unvisited' && activeMarker.visited_at && (
                <div>🕒 {new Date(activeMarker.visited_at).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}</div>
              )}
            </div>

            {activeMarker.not_sold_reason && (
              <div className={styles.mapDetailReason}>📝 {activeMarker.not_sold_reason}</div>
            )}

            {activeMarker.type !== 'not_sold' && activeMarker.type !== 'unvisited' && (
              <>
                <div className={styles.mapDetailSkusLabel}>Items</div>
                <div className={styles.mapDetailSkus}>
                  {(activeMarker.skus || []).filter(s =>
                    activeMarker.type === 'uplift' ? s.cartons_uplifted > 0 : s.sold > 0
                  ).map((s, i) => (
                    <div key={i} className={styles.mapDetailSkuRow}>
                      <span className={styles.mapDetailSku}>{s.sku}</span>
                      <span className={styles.mapDetailSkuName}>{s.name}</span>
                      {activeMarker.type === 'uplift' ? (
                        <span style={{ color: '#d97706', fontWeight: 700 }}>{s.cartons_uplifted} ctn</span>
                      ) : s.sold > 0 ? (
                        <span style={{ color: '#16a34a', fontWeight: 700 }}>{s.sold} ctn</span>
                      ) : (
                        <span style={{ color: '#dc2626', fontSize: '0.7rem' }}>{(s.not_sold_reason?.toLowerCase() === 'other' ? 'Other (no details provided)' : s.not_sold_reason) || 'Not sold'}</span>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {(activeMarker.type === 'sold') && (
              <div className={styles.mapDetailTotal} style={{ color: '#16a34a' }}>
                Total sold: <strong>{activeMarker.total_sold} cartons</strong>
              </div>
            )}
            {(activeMarker.type === 'uplift') && (
              <div className={styles.mapDetailTotal} style={{ color: '#d97706' }}>
                Total uplifted: <strong>{activeMarker.total_uplifted} cartons</strong>
              </div>
            )}

            {activeMarker.latitude && activeMarker.longitude && (
              <a
                href={`https://www.google.com/maps?q=&layer=c&cbll=${activeMarker.latitude},${activeMarker.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-block', marginTop: 10,
                  padding: '6px 14px', background: '#1a73e8', color: '#fff',
                  borderRadius: 7, fontSize: '0.78rem', fontWeight: 700,
                  textDecoration: 'none',
                }}
              >
                🗣 Street View
              </a>
            )}
          </div>
        )}
      </div>

      {!loading && markers.length === 0 && !error && (
        <div className={styles.mapEmpty}>
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🗺️</div>
          <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>No visit data for this period</div>
          <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>Adjust the filters and click Apply to search again.</div>
        </div>
      )}
      {!loading && showOnlyUnvisited && unvisitedCount === 0 && markers.length > 0 && (
        <div className={styles.mapEmpty}>
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>✅</div>
          <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>100% Coverage</div>
          <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>All registered shops in this area have been visited.</div>
        </div>
      )}

      <MapFullscreenModal
        open={mapFullscreenOpen}
        onClose={() => setMapFullscreenOpen(false)}
        markers={showOnlyUnvisited ? markers.filter(m => m.type === 'unvisited') : markers}
        filterLabel={[
          dateFrom || dateTo
            ? `${dateFrom || '…'} → ${dateTo || '…'}`
            : `${MONTHS[parseInt(month) - 1]} ${year}`,
          regions.find(r => String(r.id) === regionId)?.name,
          subregions.find(s => String(s.id) === subregionId)?.name,
          filteredUsers.find(u => u.id === userId)?.full_name,
        ].filter(Boolean).join(' · ')}
        primary={primary}
      />


    </div>
  );
}

/* ── Main Page ────────────────────────────────────────────────── */
export default function AdminPage() {
  useEffect(() => {
    registerPush();
  }, []);
  const router = useRouter();
  const [role,        setRole]        = useState(null);
  const [token,       setToken]       = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [activeTab,   setActiveTab]   = useState('uplifts');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [features,    setFeatures]    = useState(null);
  const [regionFilter, setRegionFilter] = useState('');
  const [regions,      setRegions]      = useState([]);
  const { branding: appCfg } = useBranding();

  const primary = appCfg.theme_color  || '#2563eb';
  const accent  = appCfg.accent_color || '#10b981';

  useEffect(() => {
    async function check() {
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token;
      if (!tok) { setLoading(false); return; }
      setToken(tok);
      const res  = await fetch('/api/admin/check', { headers: { Authorization: `Bearer ${tok}` } });
      const body = await res.json();
      setRole(body.role || null);
      setCurrentUser({ full_name: body.full_name || null, avatar_url: body.avatar_url || null, position: body.position || null });

      if (body.role === 'Manager') {
        fetch('/api/admin/map-regions', { headers: { Authorization: `Bearer ${tok}` } })
          .then(r => r.json())
          .then(d => setRegions(Array.isArray(d) ? d : []))
          .catch(() => {});
      }

      try {
        const featRes  = await fetch('/api/admin/features-public', { headers: { Authorization: `Bearer ${tok}` } });
        const featData = await featRes.json();
        setFeatures(featRes.ok ? featData : {});
      } catch {
        setFeatures({});
      }

      setLoading(false);
    }
    check();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  if (loading) return <div className={styles.splash}>Verifying access…</div>;
  if (!role)   return <div className={styles.splash}>Not authenticated. <a href="/login">Sign in</a></div>;
  if (role !== 'Admin' && role !== 'Super Admin' && role !== 'Manager') {
    return <div className={styles.splash}>Access denied. Admin role required.</div>;
  }

  const isManager = role === 'Manager';

  const visibleTabs = ALL_TABS.filter(t => {
    if (isManager) {
      if (t.id === 'uplifts') return false;
      if (MANAGER_REQUIRED_TAB_IDS.has(t.id)) return true;
      if (features === null) return true;
      return features[`mgr_${t.id}`] !== false;
    }
    if (REQUIRED_TAB_IDS.has(t.id)) return true;
    if (features === null) return true;
    return features[t.id] !== false;
  });

  const safeActiveTab = visibleTabs.some(t => t.id === activeTab) ? activeTab : 'dashboard';

  const renderTab = () => {
    switch (safeActiveTab) {
      case 'dashboard':
        return (
          <DashboardTab
            currentUser={currentUser}
            branding={appCfg}
            token={token}
            onNavigate={setActiveTab}
            isManager={isManager}
            regionFilter={regionFilter}
          />
        );
      case 'uplifts':
        return <UpliftsTab token={token} />;
      case 'customer':
        return <CustomerAnalysisTab token={token} primary={primary} branding={appCfg} regionFilter={regionFilter} />;
      case 'competitor':
        return (
          <CompetitorAnalysisPanel token={token} primary={primary} />
        );
      case 'map':
        return <MapTab token={token} primary={primary} accent={accent} regionFilter={regionFilter} />;
      case 'targets':
        return <TargetsTab token={token} primary={primary} branding={appCfg} readOnly={isManager} regionFilter={regionFilter} />;
      case 'performance':
        return <PerformanceTab token={token} primary={primary} branding={appCfg} regionFilter={regionFilter} isManager={isManager} />;
      case 'fuel':
        return <FuelManagement token={token} primary={primary} branding={appCfg} readOnly={isManager} regionFilter={regionFilter} />;
      default:
        return null;
    }
  };

  return (
    <div className={styles.layout}>
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : styles.sidebarClosed}`}>
        <div className={styles.sidebarHeader}>
          <div
            className={styles.logoMark}
            style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}
          >
            {appCfg.company_logo
              ? <img src={appCfg.company_logo} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="logo" />
              : (appCfg.company_name || appCfg.system_name || 'A')[0].toUpperCase()
            }
          </div>
          {sidebarOpen && (
            <div>
              <div className={styles.sidebarTitle}>{appCfg.system_name || 'Sales Visit'}</div>
              {appCfg.company_name && (
                <div className={styles.sidebarCompanyName}>{appCfg.company_name}</div>
              )}
            </div>
          )}
        </div>

        <nav className={styles.nav}>
          {visibleTabs.map(t => (
            <button
              key={t.id}
              className={`${styles.navItem} ${safeActiveTab === t.id ? styles.navItemActive : ''}`}
              style={safeActiveTab === t.id ? { boxShadow: `inset 3px 0 0 ${primary}` } : {}}
              onClick={() => setActiveTab(t.id)}
              title={t.label}
            >
              <span className={styles.navIcon}>{t.icon}</span>
              {sidebarOpen && <span className={styles.navLabel}>{t.label}</span>}
            </button>
          ))}
        </nav>

        <button className={styles.logoutBtn} onClick={handleLogout}>
          <span className={styles.navIcon}>🚪</span>
          {sidebarOpen && <span>Logout</span>}
        </button>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <button className={styles.toggleBtn} onClick={() => setSidebarOpen(o => !o)}>☰</button>
          <h1 className={styles.topbarTitle}>{visibleTabs.find(t => t.id === activeTab)?.label ?? ALL_TABS.find(t => t.id === activeTab)?.label}</h1>
          <div className={styles.topbarRight}>
            {isManager && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 12 }}>
                <span style={{ fontSize: '0.78rem', color: '#64748b' }}>Region:</span>
                <select
                  value={regionFilter}
                  onChange={e => setRegionFilter(e.target.value)}
                  style={{ fontSize: '0.78rem', padding: '4px 8px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer' }}
                >
                  <option value="">All</option>
                  {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            )}
            {isManager ? (
              currentUser?.position && (
                <span className={styles.roleBadge} style={{ background: '#ef4444' }}>
                  {currentUser.position}
                </span>
              )
            ) : (
              <span
                className={styles.roleBadge}
                style={{ background: `linear-gradient(90deg, ${primary}, ${accent})` }}
              >{role}</span>
            )}
            <div className={styles.topbarUserChip}>
              {currentUser?.avatar_url ? (
                <img
                  src={currentUser.avatar_url}
                  className={styles.topbarAvatar}
                  alt="avatar"
                />
              ) : (
                <div
                  className={styles.topbarAvatarInitial}
                  style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}
                >
                  {(currentUser?.full_name || 'A')[0].toUpperCase()}
                </div>
              )}
              <span className={styles.topbarUserName}>{currentUser?.full_name || 'Admin'}</span>
              {!isManager && currentUser?.position && (
                <span style={{ fontSize: '0.72rem', color: '#94a3b8', marginLeft: 4 }}>· {currentUser.position}</span>
              )}
            </div>
          </div>
        </header>

        <main className={styles.content}>
          {renderTab()}
        </main>

        <footer className={styles.portalCopyright}>
          Powered By Indomie
        </footer>
      </div>
    </div>
  );
}