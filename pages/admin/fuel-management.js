import React, { useEffect, useState } from 'react';
import styles from '../../styles/admin.module.css';
import { supabase } from '../../lib/supabaseClient';
import ReportPreviewModal from '../../components/ReportPreviewModal';

export default function FuelManagement({ token: propToken, primary, branding }) {
  const ACCENT = '#ef4444'; // modern red theme
  const today = new Date();
  const defaultDate = today.toISOString().slice(0, 10);
  const defaultYear = String(today.getFullYear());
  const defaultMonth = String(today.getMonth() + 1);

  const [date, setDate] = useState(defaultDate);
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [regionId, setRegionId] = useState('');
  const [salespersonId, setSalespersonId] = useState('');
  const [regions, setRegions] = useState([]);
  const [users, setUsers] = useState([]);
  const [rates, setRates] = useState({ van: null, motorbike: null, tuktuk: null });
  const [fuelTypes, setFuelTypes] = useState({ van: null, motorbike: null, tuktuk: null });
  const [fuelPrices, setFuelPrices] = useState({ petrol: null, diesel: null });

  // DEFAULT_FUEL_RATES_UI uses km/L internally; UI displays L/km (we convert when loading/saving)
  const DEFAULT_FUEL_RATES_UI = { van: 16, motorbike: 40, tuktuk: 25 };

  function safeDiv(n, d) { return (!d || d === 0) ? 0 : (n / d); }
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [limited, setLimited] = useState(false);
  const [fuelPreviewOpen, setFuelPreviewOpen] = useState(false);

  useEffect(() => {
    // Load regions for dropdowns on mount
    let mounted = true;
    async function loadRegions() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const tok = session?.access_token || propToken;
        const headers = tok ? { Authorization: `Bearer ${tok}` } : {};
        const rRes = await fetch('/api/admin/map-regions', { headers });
        const rJson = await rRes.json();
        if (!mounted) return;
        setRegions(Array.isArray(rJson) ? rJson : []);
        // load default fuel rates (if admin)
        try {
          const cfgRes = await fetch('/api/admin/fuel-config', { headers });
          if (cfgRes.ok) {
            const cfg = await cfgRes.json();
            // Convert stored km/L values into L/km for the UI inputs
            setRates({
              van: cfg.fuel_rate_van ? (1 / Number(cfg.fuel_rate_van)) : null,
              motorbike: cfg.fuel_rate_motorbike ? (1 / Number(cfg.fuel_rate_motorbike)) : null,
              tuktuk: cfg.fuel_rate_tuktuk ? (1 / Number(cfg.fuel_rate_tuktuk)) : null,
            });
            setFuelTypes({
              van: cfg.fuel_type_van || null,
              motorbike: cfg.fuel_type_motorbike || null,
              tuktuk: cfg.fuel_type_tuktuk || null,
            });
            setFuelPrices({
              petrol: cfg.fuel_price_petrol ? Number(cfg.fuel_price_petrol) : null,
              diesel: cfg.fuel_price_diesel ? Number(cfg.fuel_price_diesel) : null,
            });
          }
        } catch (e) {
          // ignore
        }
      } catch (e) {
        console.log('FuelManagement loadRegions error', e && e.message);
      }
    }
    loadRegions();
    return () => { mounted = false; };
  }, [propToken]);

  // Fetch salespersons whenever region selection changes (server-filtered)
  useEffect(() => {
    let mounted = true;
    async function loadUsers() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const tok = session?.access_token || propToken;
        const headers = tok ? { Authorization: `Bearer ${tok}` } : {};
        const url = regionId ? `/api/admin/map-users?region_id=${encodeURIComponent(regionId)}` : '/api/admin/map-users';
        const uRes = await fetch(url, { headers });
        const uJson = await uRes.json();
        if (!mounted) return;
        setUsers(Array.isArray(uJson) ? uJson : []);
      } catch (e) {
        console.log('FuelManagement loadUsers error', e && e.message);
        setUsers([]);
      }
    }
    loadUsers();
    return () => { mounted = false; };
  }, [propToken, regionId]);

  function displayName(u) {
    if (!u) return '—';
    return u.full_name || u.name || (u.first_name && u.last_name ? `${u.first_name} ${u.last_name}` : null) || u.display_name || u.email || u.id || '—';
  }

  const filteredSalespeople = users.filter(u => {
    if (!regionId) return true;
    const regs = (u.user_regions || []).map(r => String(r.region_id));
    return regs.includes(String(regionId));
  });

  const fetchReport = async () => {
    setLoading(true); setData([]); setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token || propToken;
      if (!tok) { setError('Not authenticated — please log in as an admin.'); setLoading(false); return; }
      const q = new URLSearchParams();
      // prefer exact date if provided, otherwise year+month
      if (date) q.set('date', date);
      else if (year && month) { q.set('year', String(year)); q.set('month', String(month)); }
      if (salespersonId) q.set('user_id', salespersonId);
      if (regionId) q.set('region_id', String(regionId));
      const res = await fetch(`/api/admin/fuel-report?${q.toString()}`, { headers: { Authorization: `Bearer ${tok}` } });
      const lim = res.headers.get('X-Data-Limited') === 'true';
      const j = await res.json();
      if (res.ok) {
        setData(j || []);
        setLimited(lim);
        if (!Array.isArray(j) || (Array.isArray(j) && j.length === 0)) setError('No results for selected filters.');
      } else {
        const msg = j?.error || res.statusText || 'Unknown server error';
        console.log('fuel-report error', j);
        setError(`Server error: ${msg}`);
        setData([]);
      }
    } catch (e) {
      console.log('fetchReport error', e);
      setError(e?.message || String(e));
    } finally { setLoading(false); }
  };

  const saveRates = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token || propToken;
      if (!tok) return;
      const headers = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
      // Convert UI rates (L/km) back to storage format (km/L)
      const convertToKmPerL = v => (v && v > 0) ? (1 / v) : null;
      const body = {
        fuel_rate_van: convertToKmPerL(rates.van),
        fuel_rate_motorbike: convertToKmPerL(rates.motorbike),
        fuel_rate_tuktuk: convertToKmPerL(rates.tuktuk),
        fuel_type_van: fuelTypes.van,
        fuel_type_motorbike: fuelTypes.motorbike,
        fuel_type_tuktuk: fuelTypes.tuktuk,
        fuel_price_petrol: fuelPrices.petrol,
        fuel_price_diesel: fuelPrices.diesel,
      };
      const res = await fetch('/api/admin/fuel-config', { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.json();
        console.log('saveRates error', err);
      } else {
        console.log('Fuel rates saved');
        // Refresh report so computed columns (costs) update with new prices.
        // Small delay helps in case DB visibility is slightly delayed.
        setTimeout(() => { try { fetchReport(); } catch (e) { console.log('fetchReport after save failed', e && e.message); } }, 600);
      }
    } catch (e) { console.log('saveRates exception', e && e.message); }
  };

  const exportFuelExcel = async () => {
    try {
      const { Workbook } = await import('exceljs');
      const wb = new Workbook();
      const ws = wb.addWorksheet('Fuel Report');
      ws.columns = [
        { header: 'Salesperson', key: 'name', width: 30 },
        { header: 'Vehicle', key: 'vehicle', width: 12 },
        { header: 'Fuel Rate (L / Km)', key: 'fuel_rate', width: 14 },
        { header: 'Distance (km)', key: 'distance', width: 12 },
        { header: 'Fuel (L)', key: 'fuel_l', width: 12 },
        { header: 'Fuel Price (KSh/L)', key: 'fuel_price', width: 16 },
        { header: 'Cost (KSh)', key: 'cost', width: 14 },
        { header: 'Cost / km', key: 'cost_km', width: 12 },
        { header: 'Cost / visit', key: 'cost_visit', width: 12 },
        { header: 'Cost / carton', key: 'cost_carton', width: 14 },
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Shops', key: 'shops', width: 8 },
        { header: 'Cartons sold', key: 'cartons', width: 12 },
      ];
      const safeDivLocal = (n, d) => (!d || d === 0) ? 0 : (n / d);
      const DEFAULT_FUEL_RATES_UI_LOCAL = { van: 16, motorbike: 40, tuktuk: 25 };
      for (const r of data || []) {
        const total_distance = Number(r.total_distance_km) || 0;
        const vehicle = (r.vehicle_type || '').toLowerCase() || 'motorbike';
        const backendRate = (r.fuel_rate_used != null && r.fuel_rate_used !== '') ? Number(r.fuel_rate_used) : null;
        const configuredRate = rates[vehicle] || null;
        const configuredRateKm = (configuredRate != null && configuredRate > 0) ? (1 / configuredRate) : null;
        const fuel_rate = backendRate || configuredRateKm || DEFAULT_FUEL_RATES_UI_LOCAL[vehicle] || DEFAULT_FUEL_RATES_UI_LOCAL.motorbike;
        const fuel_used = fuel_rate ? safeDivLocal(total_distance, fuel_rate) : 0;
        const backendPrice = (r.fuel_price_used != null && r.fuel_price_used !== '') ? Number(r.fuel_price_used) : null;
        const fuel_price = backendPrice || fuelPrices[(r.fuel_type || vehicle || '').toLowerCase()] || 0;
        const fuel_cost = (fuel_used || 0) * (fuel_price || 0);
        const cost_per_km = safeDivLocal(fuel_cost, total_distance);
        const cost_per_visit = safeDivLocal(fuel_cost, Number(r.number_of_shops) || 0);
        const cost_per_carton = safeDivLocal(fuel_cost, Number(r.cartons_sold) || 0);
        ws.addRow({
          name: (users.find(u => String(u.id) === String(r.user_id))?.full_name) || r.user_name || r.user_id,
          vehicle: r.vehicle_type || '-',
          fuel_rate: fuel_rate ? (1 / fuel_rate) : 0,
          distance: total_distance,
          fuel_l: fuel_used,
          fuel_price: fuel_price,
          cost: fuel_cost,
          cost_km: cost_per_km,
          cost_visit: cost_per_visit,
          cost_carton: cost_per_carton,
          date: r.date || '',
          shops: r.number_of_shops || 0,
          cartons: r.cartons_sold || 0,
        });
      }
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fuel-report-${new Date().toISOString().slice(0,10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed', err);
      alert('Export failed — check console for details');
    }
  };

  return (
    <div style={{ padding: 20, fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <h2 style={{ margin: 0, color: '#111827' }}>Fuel Management</h2>
        <div style={{ color: '#6b7280' }}>{branding?.company_name || ''}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, marginBottom: 18 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: '#374151' }}>Region</label>
          <select value={regionId} onChange={e => { setRegionId(e.target.value); setSalespersonId(''); }} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e5e7eb' }}>
            <option value=''>All Regions</option>
            {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: '#374151' }}>Salesperson</label>
          <select value={salespersonId} onChange={e => setSalespersonId(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e5e7eb' }}>
            <option value=''>All Salespersons</option>
            {filteredSalespeople.map(u => <option key={u.id} value={u.id}>{displayName(u)}</option>)}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: '#374151' }}>Date</label>
          <input type='date' value={date} onChange={e => { setDate(e.target.value); }} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e5e7eb' }} />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: '#374151' }}>Year</label>
          <select value={year} onChange={e => { setYear(e.target.value); if (e.target.value) setDate(''); }} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e5e7eb' }}>
            <option value=''>—</option>
            {Array.from({ length: 6 }).map((_, idx) => {
              const y = new Date().getFullYear() - idx;
              return <option key={y} value={String(y)}>{y}</option>;
            })}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: '#374151' }}>Month</label>
          <select value={month} onChange={e => { setMonth(e.target.value); if (e.target.value) setDate(''); }} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e5e7eb' }}>
            <option value=''>—</option>
            {Array.from({ length: 12 }).map((_, i) => {
              const m = i + 1;
              const label = new Date(0, i).toLocaleString('default', { month: 'long' });
              return <option key={m} value={String(m)}>{label}</option>;
            })}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'end', gap: 8 }}>
          <button onClick={fetchReport} disabled={loading} style={{ background: ACCENT, color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 10, cursor: 'pointer' }}>
            {loading ? 'Loading…' : 'Fetch Report'}
          </button>
          <button onClick={() => setFuelPreviewOpen(true)} disabled={!data.length} style={{ border: '1px solid #e5e7eb', background: '#fff', padding: '10px 12px', borderRadius: 10, cursor: 'pointer' }}>👁 Preview Report</button>
          <button onClick={() => { setDate(defaultDate); setYear(defaultYear); setMonth(defaultMonth); }} style={{ border: '1px solid #e5e7eb', background: '#fff', padding: '10px 12px', borderRadius: 10 }}>Reset</button>
        </div>
      </div>

      {/* Settings: default fuel consumption rates */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'flex-end' }}>
        <div style={{ background: '#fff', padding: 12, borderRadius: 10, boxShadow: '0 6px 18px rgba(15,23,42,0.04)', flex: '0 0 420px' }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Default Vehicle Consumption (L / Km)</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, color: '#374151' }}>Van (L / Km)</label>
              <input type='number' step='0.0001' value={rates.van ?? ''} onChange={e => setRates(s => ({ ...s, van: e.target.value ? Number(e.target.value) : null }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb' }} />
              <div style={{ marginTop: 6 }}>
                <label style={{ fontSize: 12, color: '#374151' }}>Fuel Type</label>
                <select value={fuelTypes.van || ''} onChange={e => setFuelTypes(s => ({ ...s, van: e.target.value || null }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', marginTop: 4 }}>
                  <option value=''>—</option>
                  <option value='petrol'>Petrol</option>
                  <option value='diesel'>Diesel</option>
                </select>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, color: '#374151' }}>Motorbike (L / Km)</label>
              <input type='number' step='0.0001' value={rates.motorbike ?? ''} onChange={e => setRates(s => ({ ...s, motorbike: e.target.value ? Number(e.target.value) : null }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb' }} />
              <div style={{ marginTop: 6 }}>
                <label style={{ fontSize: 12, color: '#374151' }}>Fuel Type</label>
                <select value={fuelTypes.motorbike || ''} onChange={e => setFuelTypes(s => ({ ...s, motorbike: e.target.value || null }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', marginTop: 4 }}>
                  <option value=''>—</option>
                  <option value='petrol'>Petrol</option>
                  <option value='diesel'>Diesel</option>
                </select>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, color: '#374151' }}>Tuktuk (L / Km)</label>
              <input type='number' step='0.0001' value={rates.tuktuk ?? ''} onChange={e => setRates(s => ({ ...s, tuktuk: e.target.value ? Number(e.target.value) : null }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb' }} />
              <div style={{ marginTop: 6 }}>
                <label style={{ fontSize: 12, color: '#374151' }}>Fuel Type</label>
                <select value={fuelTypes.tuktuk || ''} onChange={e => setFuelTypes(s => ({ ...s, tuktuk: e.target.value || null }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', marginTop: 4 }}>
                  <option value=''>—</option>
                  <option value='petrol'>Petrol</option>
                  <option value='diesel'>Diesel</option>
                </select>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Fuel Prices (KSh)</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: '#374151' }}>Petrol (KSh / L)</label>
                <input type='number' step='0.1' value={fuelPrices.petrol ?? ''} onChange={e => setFuelPrices(s => ({ ...s, petrol: e.target.value ? Number(e.target.value) : null }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: '#374151' }}>Diesel (KSh / L)</label>
                <input type='number' step='0.1' value={fuelPrices.diesel ?? ''} onChange={e => setFuelPrices(s => ({ ...s, diesel: e.target.value ? Number(e.target.value) : null }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb' }} />
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button onClick={saveRates} style={{ background: ACCENT, color: '#fff', border: 'none', padding: '8px 12px', borderRadius: 8 }}>Save Rates</button>
            <button onClick={() => { setRates({ van: null, motorbike: null, tuktuk: null }); }} style={{ border: '1px solid #e5e7eb', background: '#fff', padding: '8px 12px', borderRadius: 8 }}>Clear</button>
          </div>
        </div>

        <div style={{ flex: 1 }} />
      </div>

      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 6px 24px rgba(15,23,42,0.06)', padding: 12 }}>
        {error && (
          <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: '#fff5f5', color: '#b91c1c', border: '1px solid #fecaca' }}>{error}</div>
        )}
        {limited && (
          <div style={{ marginBottom: 12, padding: '8px 14px', borderRadius: 8, background: '#fef9c3', border: '1px solid #fde047', color: '#854d0e', fontSize: '0.82rem' }}>
            Showing first 10 records. Apply any filter above to see all data.
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #f3f4f6' }}>
                <th style={{ padding: '12px 10px', color: '#374151' }}>Salesperson</th>
                <th style={{ padding: '12px 10px', color: '#374151' }}>Vehicle</th>
                <th style={{ padding: '12px 10px', color: '#374151' }}>Fuel Rate (L / Km)</th>
                <th style={{ padding: '12px 10px', color: '#374151' }}>Distance (km)</th>
                <th style={{ padding: '12px 10px', color: '#374151' }}>Fuel (L)</th>
                  <th style={{ padding: '12px 10px', color: '#374151' }}>Fuel Price (KSh/L)</th>
                  <th style={{ padding: '12px 10px', color: '#374151' }}>Cost</th>
                <th style={{ padding: '12px 10px', color: '#374151' }}>Cost / km</th>
                <th style={{ padding: '12px 10px', color: '#374151' }}>Cost / visit</th>
                <th style={{ padding: '12px 10px', color: '#374151' }}>Cost / carton</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr><td colSpan={9} style={{ padding: 24, color: '#9ca3af' }}>No data — choose filters and click "Fetch Report".</td></tr>
              )}
              {data.map((r, i) => {
                const name = (users.find(u => String(u.id) === String(r.user_id))?.full_name) || r.user_name || r.user_id;
                const total_distance = Number(r.total_distance_km) || 0;
                const vehicle = (r.vehicle_type || '').toLowerCase() || 'motorbike';
                // prefer backend-per-user rate, otherwise admin-configured defaults, otherwise built-in defaults
                const backendRate = (r.fuel_rate_used != null && r.fuel_rate_used !== '') ? Number(r.fuel_rate_used) : null;
                // rates[] holds UI values in L/km; convert to km/L for calculations
                const configuredRateKm = (rates[vehicle] != null && rates[vehicle] > 0) ? (1 / rates[vehicle]) : null;
                const fuel_rate = backendRate || configuredRateKm || DEFAULT_FUEL_RATES_UI[vehicle] || DEFAULT_FUEL_RATES_UI.motorbike; // km/L
                const fuel_used = fuel_rate ? safeDiv(total_distance, fuel_rate) : 0;
                // price: prefer backend value, otherwise admin-entered prices, otherwise 0
                const backendPrice = (r.fuel_price_used != null && r.fuel_price_used !== '') ? Number(r.fuel_price_used) : null;
                const fuel_price = backendPrice || fuelPrices[(r.fuel_type || vehicle || '').toLowerCase()] || 0;
                const fuel_cost = (fuel_used || 0) * (fuel_price || 0);
                const cost_per_km = safeDiv(fuel_cost, total_distance);
                const cost_per_visit = safeDiv(fuel_cost, Number(r.number_of_shops) || 0);
                const cost_per_carton = safeDiv(fuel_cost, Number(r.cartons_sold) || 0);
                return (
                  <tr key={i} style={{ borderTop: '1px solid #f8fafc' }}>
                    <td style={{ padding: '12px 10px' }}>{name}</td>
                    <td style={{ padding: '12px 10px' }}>{r.vehicle_type || '-'}</td>
                    <td style={{ padding: '12px 10px' }}>{fuel_rate ? (1 / fuel_rate).toFixed(4) : '-'}</td>
                    <td style={{ padding: '12px 10px' }}>{total_distance.toFixed(2)}</td>
                    <td style={{ padding: '12px 10px' }}>{fuel_used.toFixed(2)}</td>
                    <td style={{ padding: '12px 10px' }}>{fuel_price ? fuel_price.toFixed(2) : '-'}</td>
                    <td style={{ padding: '12px 10px' }}>{fuel_cost.toFixed(2)}</td>
                    <td style={{ padding: '12px 10px' }}>{cost_per_km.toFixed(2)}</td>
                    <td style={{ padding: '12px 10px' }}>{cost_per_visit.toFixed(2)}</td>
                    <td style={{ padding: '12px 10px' }}>{cost_per_carton.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <ReportPreviewModal
        open={fuelPreviewOpen}
        onClose={() => setFuelPreviewOpen(false)}
        title="Fuel Report"
        subtitle={date || (year && month ? `${new Date(0, parseInt(month) - 1).toLocaleString('default', { month: 'long' })} ${year}` : '')}
        headers={['Salesperson', 'Vehicle', 'Distance (km)', 'Fuel (L)', 'Fuel Cost (KSh)', 'Cost/km', 'Cost/Visit', 'Cost/Carton', 'Date', 'Shops', 'Cartons']}
        rows={(data || []).map(r => {
          const safeDivL = (n, d) => (!d || d === 0) ? 0 : (n / d);
          const DEFAULT_R = { van: 16, motorbike: 40, tuktuk: 25 };
          const name = (users.find(u => String(u.id) === String(r.user_id))?.full_name) || r.user_name || r.user_id;
          const total_distance = Number(r.total_distance_km) || 0;
          const vehicle = (r.vehicle_type || '').toLowerCase() || 'motorbike';
          const backendRate = (r.fuel_rate_used != null && r.fuel_rate_used !== '') ? Number(r.fuel_rate_used) : null;
          const configuredRateKm = (rates[vehicle] != null && rates[vehicle] > 0) ? (1 / rates[vehicle]) : null;
          const fuel_rate = backendRate || configuredRateKm || DEFAULT_R[vehicle] || DEFAULT_R.motorbike;
          const fuel_used = fuel_rate ? safeDivL(total_distance, fuel_rate) : 0;
          const backendPrice = (r.fuel_price_used != null && r.fuel_price_used !== '') ? Number(r.fuel_price_used) : null;
          const fuel_price = backendPrice || fuelPrices[(r.fuel_type || vehicle || '').toLowerCase()] || 0;
          const fuel_cost = (fuel_used || 0) * (fuel_price || 0);
          return [
            name,
            r.vehicle_type || '-',
            total_distance.toFixed(2),
            fuel_used.toFixed(2),
            fuel_cost.toFixed(2),
            safeDivL(fuel_cost, total_distance).toFixed(2),
            safeDivL(fuel_cost, Number(r.number_of_shops) || 0).toFixed(2),
            safeDivL(fuel_cost, Number(r.cartons_sold) || 0).toFixed(2),
            r.date || '',
            r.number_of_shops || 0,
            r.cartons_sold || 0,
          ];
        })}
        onExport={exportFuelExcel}
      />
    </div>
  );
}
