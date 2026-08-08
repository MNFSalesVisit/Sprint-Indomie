import React, { useEffect, useState, useCallback } from 'react';
import ReportPreviewModal from '../ReportPreviewModal';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTrend(trendData) {
  if (!trendData || trendData.length < 2) return { label: '⚖️ Stable', color: '#f59e0b' };
  const first = trendData[0].sold;
  const last  = trendData[trendData.length - 1].sold;
  if (first === 0 && last === 0) return { label: '⚖️ Stable', color: '#f59e0b' };
  if (first === 0) return { label: '📈 Increasing', color: '#16a34a' };
  const score = (last - first) / first;
  if (score > 0) return { label: '📈 Increasing', color: '#16a34a' };
  if (score < 0) return { label: '📉 Declining',  color: '#dc2626' };
  return { label: '⚖️ Stable', color: '#f59e0b' };
}

// ── NEW / UPDATED TrendChart ──
function TrendChart({ data, color }) {
  if (!data || data.length < 2) {
    return <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>Not enough data points</span>;
  }

  // Dynamic width: minimum 260px, add 12px per data point
  const H = 72;
  const baseWidth = 260;
  const perPoint = 12;
  const W = Math.max(baseWidth, data.length * perPoint);

  const maxV = Math.max(...data.map(d => d.sold), 1);
  const xStep = (W - 8) / (data.length - 1);

  const pts = data
    .map((d, i) => {
      const x = (4 + i * xStep).toFixed(1);
      const y = (H - 6 - (d.sold / maxV) * (H - 12)).toFixed(1);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
      <svg width={W} height={H} style={{ display: 'block' }}>
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {data.map((d, i) => {
          const cx = (4 + i * xStep).toFixed(1);
          const cy = (H - 6 - (d.sold / maxV) * (H - 12)).toFixed(1);
          return <circle key={i} cx={cx} cy={cy} r="3" fill={color} />;
        })}
      </svg>
    </div>
  );
}

function StatChip({ label, value, color }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '3px 8px', borderRadius: 6, background: `${color}14`,
    }}>
      <span style={{ fontWeight: 700, fontSize: '0.83rem', color }}>{value}</span>
      <span style={{ fontSize: '0.67rem', color: '#9ca3af', marginTop: 1 }}>{label}</span>
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const YEARS = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i));
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const selStyle = {
  padding: '6px 10px', borderRadius: 6, border: '1px solid #e5e7eb',
  fontSize: '0.82rem', color: '#374151', background: '#fff', outline: 'none',
};

const cardBase = {
  background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden',
};

// ── Main component ────────────────────────────────────────────────────────────

export default function ShopSalesTrend({
  token, primary = '#b91c1c', branding,
  externalYear, externalMonth, externalDateFrom, externalDateTo,
  externalRegionId, externalSubregionId, externalShopSearch,
}) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [expanded, setExpanded] = useState({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10); // pagination

  // Filter state
  const isExternal = !!(externalYear || externalMonth || externalRegionId || externalSubregionId || externalDateFrom || externalDateTo);
  const [year, setYear]           = useState(String(externalYear || new Date().getFullYear()));
  const [month, setMonth]         = useState(String(externalMonth || new Date().getMonth() + 1));
  const [dateFrom, setDateFrom]   = useState(externalDateFrom || '');
  const [dateTo, setDateTo]       = useState(externalDateTo   || '');
  const [regionId, setRegionId]   = useState(externalRegionId    || '');
  const [subregionId, setSubregionId] = useState(externalSubregionId || '');
  const [userId, setUserId]       = useState('');
  const [shopSearch, setShopSearch] = useState(externalShopSearch || '');

  // Sync external filter changes into internal state
  useEffect(() => { if (externalYear)       setYear(String(externalYear)); },       [externalYear]);
  useEffect(() => { if (externalMonth)      setMonth(String(externalMonth)); },     [externalMonth]);
  useEffect(() => { if (externalDateFrom !== undefined) setDateFrom(externalDateFrom || ''); }, [externalDateFrom]);
  useEffect(() => { if (externalDateTo   !== undefined) setDateTo(externalDateTo   || ''); }, [externalDateTo]);
  useEffect(() => { if (externalRegionId    !== undefined) setRegionId(externalRegionId    || ''); }, [externalRegionId]);
  useEffect(() => { if (externalSubregionId !== undefined) setSubregionId(externalSubregionId || ''); }, [externalSubregionId]);
  useEffect(() => { if (externalShopSearch  !== undefined) setShopSearch(externalShopSearch  || ''); }, [externalShopSearch]);

  // Filter options
  const [regions, setRegions]         = useState([]);
  const [subregions, setSubregions]   = useState([]);
  const [users, setUsers]             = useState([]);

  const authHeader = { Authorization: `Bearer ${token}` };

  // ── Load filter options ────────────────────────────────────────────────────
  const loadFilters = useCallback(async () => {
    if (!token) return;
    try {
      const [regData, userList] = await Promise.all([
        fetch('/api/admin/map-regions', { headers: authHeader }).then(r => r.ok ? r.json() : []),
        fetch('/api/admin/users',        { headers: authHeader }).then(r => r.ok ? r.json() : []),
      ]);
      const regionsList = Array.isArray(regData) ? regData : [];
      setRegions(regionsList);
      if (Array.isArray(userList)) setUsers(userList);
      if (regionsList.length === 0) return;
      const allSubs = await Promise.all(
        regionsList.map(reg =>
          fetch(`/api/admin/map-regions?region_id=${reg.id}`, { headers: authHeader })
            .then(r => r.ok ? r.json() : [])
        )
      );
      setSubregions(allSubs.flat());
    } catch (_) {}
  }, [token]);

  // ── Build query string ─────────────────────────────────────────────────────
  const buildQuery = useCallback(() => {
    const qs = new URLSearchParams({ mode: 'sales' });
    const safeValue = (value) => value != null && value !== '' && value !== 'null' && value !== 'undefined';
    if (safeValue(dateFrom)) {
      qs.set('dateFrom', dateFrom);
      if (safeValue(dateTo)) qs.set('dateTo', dateTo);
    } else if (safeValue(year) && safeValue(month)) {
      const y = parseInt(year, 10), m = parseInt(month, 10);
      qs.set('dateFrom', new Date(y, m - 1, 1).toISOString().slice(0, 10));
      qs.set('dateTo', new Date(y, m, 0).toISOString().slice(0, 10));
    }
    if (safeValue(regionId))    qs.set('region_id', regionId);
    if (safeValue(subregionId)) qs.set('subregion_id', subregionId);
    if (safeValue(userId))      qs.set('user_id', userId);
    return qs.toString();
  }, [year, month, dateFrom, dateTo, regionId, subregionId, userId]);

  // ── Load data ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true); setError(''); setRows([]); setExpanded({});
    setVisibleCount(10);
    try {
      const res = await fetch(`/api/admin/customer-analysis?${buildQuery()}`, { headers: authHeader });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Failed to load data');
      } else {
        const d = await res.json();
        setRows(Array.isArray(d) ? d : []);
      }
    } catch (_) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [token, buildQuery]);

  // ── Excel export ───────────────────────────────────────────────────────────
  const handleExport = async () => {
    const exportRows = shopSearch.trim()
      ? rows.filter(r => (r.shop_name || '').toLowerCase().includes(shopSearch.toLowerCase()))
      : rows;

    if (!exportRows || exportRows.length === 0) return;
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = branding?.company_name || 'Sprint App';
      wb.created = new Date();
      const ws = wb.addWorksheet('Sales Trend Insights');
      ws.columns = [
        { header: '#',            key: 'idx',      width: 6  },
        { header: 'Shop',         key: 'shop',     width: 32 },
        { header: 'Region',       key: 'region',   width: 18 },
        { header: 'Subregion',    key: 'sub',      width: 18 },
        { header: 'Last Visit',   key: 'last',     width: 14 },
        { header: 'Visits',       key: 'visits',   width: 10 },
        { header: 'Cartons Sold', key: 'cartons',  width: 14 },
        { header: 'Efficiency %', key: 'eff',      width: 14 },
        { header: 'Trend',        key: 'trend',    width: 16 },
        { header: 'Top SKU (Period)', key: 'topsku', width: 16 },
      ];
      exportRows.forEach((r, i) => {
        const totalSaleVisits = r.total_visits - (r.total_not_sold_visits || 0);
        const eff = r.total_visits > 0 ? Math.round((totalSaleVisits / r.total_visits) * 100) : 0;
        const trendInfo = getTrend(r.trend);
        ws.addRow({
          idx:     i + 1,
          shop:    r.shop_name,
          region:  r.region_name || '—',
          sub:     r.subregion_name || '—',
          last:    r.last_visit_date || '—',
          visits:  r.total_visits,
          cartons: r.total_sold,
          eff:     eff + '%',
          trend:   trendInfo.label,
          topsku:  r.top_sku || '—',
        });
      });
      const period = dateFrom ? `${dateFrom}${dateTo ? '_to_' + dateTo : ''}` : `${year}-${String(month).padStart(2, '0')}`;
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sales-trend-insights-${period}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Excel export failed', err);
    }
  };

  useEffect(() => { loadFilters(); }, [loadFilters]);
  useEffect(() => { load(); }, [load]);

  const filteredSubregions = regionId
    ? subregions.filter(s => String(s.region_id) === String(regionId))
    : subregions;
  const displayRows = shopSearch.trim()
    ? rows.filter(r => (r.shop_name || '').toLowerCase().includes(shopSearch.toLowerCase()))
    : rows;

  // Reset pagination when filter/search changes
  useEffect(() => {
    setVisibleCount(10);
  }, [shopSearch, rows]);

  const visibleRows = displayRows.slice(0, visibleCount);

  const toggleExpand = (shopId) =>
    setExpanded(prev => ({ ...prev, [shopId]: !prev[shopId] }));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '0 0 24px' }}>

      {/* Filter bar — hidden when external filters are provided by parent */}
      {!isExternal && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <select value={year} onChange={e => setYear(e.target.value)} style={selStyle}>
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={month} onChange={e => setMonth(e.target.value)} style={selStyle}>
          {MONTHS.map((m, i) => <option key={i + 1} value={String(i + 1)}>{m}</option>)}
        </select>
        <input
          type="date" value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          style={{ ...selStyle, minWidth: 130 }}
          title="Custom from date (overrides year/month)"
        />
        <input
          type="date" value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          style={{ ...selStyle, minWidth: 130 }}
          title="Custom to date"
        />
        <select value={regionId} onChange={e => { setRegionId(e.target.value); setSubregionId(''); }} style={selStyle}>
          <option value="">All Regions</option>
          {regions.map(r => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
        </select>
        <select value={subregionId} onChange={e => setSubregionId(e.target.value)} style={selStyle}>
          <option value="">All Subregions</option>
          {filteredSubregions.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
        </select>
        <select value={userId} onChange={e => setUserId(e.target.value)} style={selStyle}>
          <option value="">All Salespersons</option>
          {users.map(u => <option key={u.id} value={String(u.id)}>{u.name || u.email}</option>)}
        </select>
        <button
          onClick={load}
          disabled={loading}
          style={{
            padding: '6px 14px', background: primary, color: '#fff',
            border: 'none', borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: 600, fontSize: '0.82rem', opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? '⏳' : '🔄'} Refresh
        </button>
        <button
          onClick={() => setPreviewOpen(true)}
          disabled={loading || rows.length === 0}
          style={{
            padding: '6px 14px', background: '#0f172a', color: '#fff',
            border: 'none', borderRadius: 6,
            cursor: (loading || rows.length === 0) ? 'not-allowed' : 'pointer',
            fontWeight: 600, fontSize: '0.82rem',
            opacity: (loading || rows.length === 0) ? 0.5 : 1,
          }}
        >
          👁 Preview Report
        </button>
      </div>}

      {/* Error */}
      {error && (
        <div style={{
          padding: '10px 14px', background: '#fee2e2', color: '#dc2626',
          borderRadius: 8, marginBottom: 12, fontSize: '0.875rem',
        }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#6b7280', fontSize: '0.95rem' }}>
          ⏳ Loading trend data…
        </div>
      )}

      {/* Empty */}
      {!loading && !error && displayRows.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#9ca3af', fontSize: '0.95rem' }}>
          No sales trend data found for the selected period.
        </div>
      )}

      {/* Shop cards */}
      {!loading && displayRows.length > 0 && (
        <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visibleRows.map((shop) => {
            const isOpen = !!expanded[shop.shop_id];
            const trend  = getTrend(shop.trend);
            const totalSaleVisits = shop.total_visits - (shop.total_not_sold_visits || 0);
            const efficiency = shop.total_visits > 0
              ? Math.round((totalSaleVisits / shop.total_visits) * 100)
              : 0;

            return (
              <div key={shop.shop_id} style={cardBase}>

                {/* ── Card header (always visible) ── */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleExpand(shop.shop_id)}
                  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggleExpand(shop.shop_id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    cursor: 'pointer', padding: '12px 16px', userSelect: 'none',
                  }}
                >
                  {/* Avatar */}
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: `${primary}20`, color: primary,
                    fontWeight: 700, fontSize: '1.05rem', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {(shop.shop_name || 'S').charAt(0).toUpperCase()}
                  </div>

                  {/* Name + location */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontWeight: 600, fontSize: '0.92rem', color: '#111827',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {shop.shop_name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 2 }}>
                      {shop.subregion_name !== '—' ? `📍 ${shop.subregion_name}` : ''}
                      {shop.shop_location ? ` · ${shop.shop_location}` : ''}
                    </div>
                  </div>

                  {/* Stat chips */}
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                    <StatChip label="Visits"   value={shop.total_visits} color="#2563eb" />
                    <StatChip label="Cartons"  value={shop.total_sold}   color={primary} />
                    <StatChip
                      label="Efficiency"
                      value={`${efficiency}%`}
                      color={efficiency >= 60 ? '#16a34a' : efficiency >= 30 ? '#f59e0b' : '#dc2626'}
                    />
                    {shop.top_sku && (
                      <StatChip
                        label="Top SKU (period)"
                        value={`${shop.top_sku}${shop.top_sku_sold ? ': ' + shop.top_sku_sold + ' ctn' : ''}`}
                        color="#7c3aed"
                      />
                    )}
                  </div>

                  {/* Trend badge */}
                  <div style={{
                    marginLeft: 4, padding: '3px 10px', borderRadius: 999,
                    background: `${trend.color}16`, color: trend.color,
                    fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    {trend.label}
                  </div>

                  {/* Chevron */}
                  <div style={{
                    marginLeft: 4, color: '#9ca3af', fontSize: '0.75rem', flexShrink: 0,
                    transition: 'transform 0.2s',
                    transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  }}>
                    ▼
                  </div>
                </div>

                {/* ── Expanded detail ── */}
                {isOpen && (
                  <div style={{ padding: '0 16px 16px', borderTop: '1px solid #f3f4f6' }}>

                    {/* Trend chart */}
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: 8 }}>
                        📊 Daily Sales Trend (cartons)
                      </div>
                      {shop.trend && shop.trend.length >= 2 ? (
                        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                          <div style={{
                            background: '#f9fafb', borderRadius: 8, padding: '10px 12px',
                            border: '1px solid #f3f4f6', maxWidth: '100%', overflow: 'hidden',
                          }}>
                            <TrendChart data={shop.trend} color={primary} />
                          </div>
                          <div style={{
                            display: 'flex', flexDirection: 'column', gap: 3,
                            fontSize: '0.75rem', maxHeight: 120, overflowY: 'auto',
                          }}>
                            {shop.trend.map(pt => (
                              <div key={pt.date} style={{ display: 'flex', gap: 8 }}>
                                <span style={{ color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>{pt.date}</span>
                                <span style={{ fontWeight: 600, color: '#111827' }}>{pt.sold} ctn</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: '#9ca3af', fontSize: '0.82rem' }}>
                          Not enough daily data to display a trend chart.
                        </div>
                      )}
                    </div>

                    {/* Top SKUs */}
                    {shop.by_sku && shop.by_sku.length > 0 && (
                      <div style={{ marginTop: 14 }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                          🏷️ Top SKUs
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {shop.by_sku.slice(0, 8).map(s => (
                            <span key={s.sku} style={{
                              padding: '3px 9px', borderRadius: 999,
                              background: `${primary}14`, color: primary,
                              fontSize: '0.73rem', fontWeight: 600,
                            }}>
                              {s.sku}: {s.sold} ctn
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Last visit */}
                    {shop.last_visit_date && (
                      <div style={{ marginTop: 10, fontSize: '0.75rem', color: '#9ca3af' }}>
                        Last visit: <strong style={{ color: '#374151' }}>{shop.last_visit_date}</strong>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Show more / Show less */}
        {displayRows.length > 10 && (
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            {visibleCount < displayRows.length ? (
              <button
                onClick={() => setVisibleCount(prev => Math.min(prev + 10, displayRows.length))}
                style={{
                  padding: '8px 20px', background: '#f3f4f6', color: '#374151',
                  border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer',
                  fontSize: '0.82rem', fontWeight: 600, display: 'inline-flex',
                  alignItems: 'center', gap: 6,
                }}
              >
                &#9660; Load {Math.min(10, displayRows.length - visibleCount)} more
              </button>
            ) : (
              <button
                onClick={() => setVisibleCount(10)}
                style={{
                  padding: '8px 20px', background: '#f3f4f6', color: '#374151',
                  border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer',
                  fontSize: '0.82rem', fontWeight: 600, display: 'inline-flex',
                  alignItems: 'center', gap: 6,
                }}
              >
                &#9650; Show less
              </button>
            )}
          </div>
        )}
        </>
      )}

      <ReportPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Sales Trend Insights"
        subtitle={dateFrom ? `${dateFrom}${dateTo ? ' → ' + dateTo : ''}` : `${MONTHS[parseInt(month) - 1]} ${year}`}
        headers={['#', 'Shop', 'Region', 'Subregion', 'Last Visit', 'Visits', 'Cartons Sold', 'Efficiency %', 'Trend', 'Top SKU (Period)']}
        rows={rows.map((r, i) => {
          const totalSaleVisits = r.total_visits - (r.total_not_sold_visits || 0);
          const eff = r.total_visits > 0 ? Math.round((totalSaleVisits / r.total_visits) * 100) : 0;
          const trendInfo = getTrend(r.trend);
          return [
            i + 1,
            r.shop_name,
            r.region_name || '—',
            r.subregion_name || '—',
            r.last_visit_date || '—',
            r.total_visits,
            r.total_sold,
            eff + '%',
            trendInfo.label,
            r.top_sku ? `${r.top_sku}: ${r.top_sku_sold || 0} ctn` : '—',
          ];
        })}
        onExport={handleExport}
      />
    </div>
  );
}