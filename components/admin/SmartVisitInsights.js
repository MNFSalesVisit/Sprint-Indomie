import React, { useEffect, useState, useCallback } from 'react';
import ReportPreviewModal from '../ReportPreviewModal';

export default function SmartVisitInsights({ token, primary = '#b91c1c', branding }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [insightsPreviewOpen, setInsightsPreviewOpen] = useState(false);
  const [regionId, setRegionId] = useState('');
  const [salesRep, setSalesRep] = useState('');
  const [regions, setRegions] = useState([]);
  const [users, setUsers] = useState([]);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const YEARS = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i));
  const MONTHS = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];

  const loadFilters = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/map-regions', { headers });
      if (r.ok) setRegions(await r.json());
    } catch (e) {}
    try {
      const u = await fetch('/api/admin/users', { headers });
      if (u.ok) setUsers(await u.json());
    } catch (e) {}
  }, [token]);

  const buildQuery = () => {
    const qs = new URLSearchParams();
    if (regionId) qs.set('region_id', regionId);
    if (salesRep) qs.set('sales_rep', salesRep);
    // If year+month specified, convert to dateFrom/dateTo for API
    if (year && month) {
      const y = parseInt(year, 10);
      const m = parseInt(month, 10);
      const first = new Date(y, m - 1, 1).toISOString().slice(0,10);
      const lastDay = new Date(y, m, 0).getDate();
      const last = new Date(y, m - 1, lastDay).toISOString().slice(0,10);
      qs.set('dateFrom', first);
      qs.set('dateTo', last);
    }
    return qs.toString() ? `?${qs.toString()}` : '';
  };

  const load = useCallback(async () => {
    setLoading(true); setError(''); setRows([]);
    try {
      const url = `/api/admin/customer-insights${buildQuery()}`;
      const res = await fetch(url, { headers });
      if (!res.ok) { const d = await res.json().catch(()=>({})); setError(d.error || 'Failed to load'); setRows([]); }
      else { const d = await res.json(); setRows(Array.isArray(d) ? d : []); }
    } catch (e) { setError('Network error'); }
    finally { setLoading(false); }
  }, [token, regionId, salesRep, year, month]);

  useEffect(() => { loadFilters(); }, [loadFilters]);
  useEffect(() => { load(); }, [load]);

  const handleExcelExport = async () => {
    if (!rows || rows.length === 0) return;
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = branding?.company_name || 'Sprint App';
      wb.created = new Date();
      const ws = wb.addWorksheet('Smart Visit Insights');

      ws.columns = [
        { header: '#', key: 'idx', width: 6 },
        { header: 'Shop', key: 'shop', width: 32 },
        { header: 'Last Visit', key: 'last', width: 14 },
        { header: 'Visits', key: 'visits', width: 10 },
        { header: 'Sales', key: 'sales', width: 10 },
        { header: 'Cartons', key: 'cartons', width: 12 },
        { header: 'Efficiency (%)', key: 'eff', width: 14 },
        { header: 'Priority', key: 'priority', width: 12 },
        { header: 'Recommendation', key: 'rec', width: 30 },
      ];

      rows.forEach((r, i) => {
        ws.addRow({ idx: i + 1, shop: r.shop_name, last: r.last_visit_date || '', visits: r.total_visits, sales: r.total_sales, cartons: r.total_cartons, eff: r.efficiency, priority: r.priority, rec: r.recommendation });
      });

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const fileName = `smart-visit-insights-${year}-${String(month).padStart(2,'0')}.xlsx`;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Excel export failed', err);
      setError('Excel export failed');
    }
  };

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={year} onChange={e => setYear(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={month} onChange={e => setMonth(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
          {MONTHS.map((m, i) => <option key={i+1} value={String(i+1)}>{m}</option>)}
        </select>
        <select value={regionId} onChange={e => setRegionId(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
          <option value="">All Regions</option>
          {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select value={salesRep} onChange={e => setSalesRep(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
          <option value="">All Sales Reps</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
        </select>
        <button onClick={load} style={{ padding: '8px 12px', borderRadius: 8, background: primary, color: '#fff', border: 'none' }}>{loading ? '⏳' : 'Refresh'}</button>
        <button onClick={() => setInsightsPreviewOpen(true)} style={{ padding: '8px 12px', borderRadius: 8, background: '#0f172a', color: '#fff', border: 'none' }} disabled={!rows || rows.length === 0}>👁 Preview Report</button>
      </div>

      {error && <div style={{ color: '#991b1b', marginBottom: 8 }}>{error}</div>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #eee' }}>
              <th style={{ padding: 8 }}>Shop</th>
              <th style={{ padding: 8 }}>Visits</th>
              <th style={{ padding: 8 }}>Sales</th>
              <th style={{ padding: 8 }}>Efficiency</th>
              <th style={{ padding: 8 }}>Priority</th>
              <th style={{ padding: 8 }}>Recommendation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.shop_id || i} style={{ borderBottom: '1px solid #f3f4f6', background: r.problem ? '#fff1f2' : (r.efficiency > 60 ? '#ecfdf5' : 'transparent') }}>
                <td style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700 }}>{r.shop_name}</div>
                  <div style={{ color: '#64748b', fontSize: '0.85rem' }}>{r.last_visit_date || ''}</div>
                </td>
                <td style={{ padding: 10 }}>{r.total_visits}</td>
                <td style={{ padding: 10 }}>{r.total_sales} ({r.total_cartons} ctn)</td>
                <td style={{ padding: 10 }}>{r.efficiency}% {r.problem && <span style={{ color: '#b91c1c', fontWeight: 700, marginLeft: 8 }}>Problem</span>}</td>
                <td style={{ padding: 10, fontWeight: 700 }}>{r.priority}</td>
                <td style={{ padding: 10 }}>{r.recommendation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ReportPreviewModal
        open={insightsPreviewOpen}
        onClose={() => setInsightsPreviewOpen(false)}
        title="Smart Visit Insights"
        subtitle={`${MONTHS[parseInt(month) - 1]} ${year}`}
        headers={['#', 'Shop', 'Last Visit', 'Visits', 'Sales', 'Cartons', 'Efficiency %', 'Priority', 'Recommendation']}
        rows={(rows || []).map((r, i) => [
          i + 1,
          r.shop_name,
          r.last_visit_date || '—',
          r.total_visits,
          r.total_sales,
          r.total_cartons,
          r.efficiency != null ? r.efficiency + '%' : '—',
          r.priority,
          r.recommendation,
        ])}
        onExport={handleExcelExport}
      />
    </div>
  );
}
