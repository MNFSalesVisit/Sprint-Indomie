import React, { useEffect, useState, useCallback, useRef } from 'react';
import ReportPreviewModal from '../ReportPreviewModal';
import styles from '../../styles/admin.module.css';

export default function CompetitorAnalysisPanel({ token, primary = '#dc2626' }) {
  const [regions, setRegions] = useState([]);
  const [selectedRegion, setSelectedRegion] = useState('');
  const [subregions, setSubregions] = useState([]);
  const [selectedSubregion, setSelectedSubregion] = useState('');

  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState([]);
  const [error, setError] = useState('');
  const [limited, setLimited] = useState(false);
  const [compPreviewOpen, setCompPreviewOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);

  const years = [];
  const now = new Date();
  for (let y = now.getFullYear(); y >= now.getFullYear() - 5; y--) years.push(y);

  const months = [ '', 'January','February','March','April','May','June','July','August','September','October','November','December' ];

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const loadRegions = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/map-regions', { headers });
      if (!res.ok) return setRegions([]);
      const d = await res.json();
      setRegions(Array.isArray(d) ? d : []);
    } catch (e) { setRegions([]); }
  }, [token]);

  useEffect(() => { loadRegions(); }, [loadRegions]);

  // Auto-load 10 default records on mount
  useEffect(() => { fetchReport(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedRegion) { setSubregions([]); setSelectedSubregion(''); return; }
    (async () => {
      try {
        const res = await fetch(`/api/admin/map-regions?region_id=${selectedRegion}`, { headers });
        if (!res.ok) { setSubregions([]); return; }
        const d = await res.json();
        setSubregions(Array.isArray(d) ? d : []);
      } catch (e) { setSubregions([]); }
    })();
  }, [selectedRegion]);

  const buildQuery = () => {
    const params = new URLSearchParams();
    if (dateFrom || dateTo) {
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo)   params.set('date_to',   dateTo);
    } else {
      if (year)  params.set('year', year);
      if (month) params.set('month', month);
    }
    if (selectedRegion)    params.set('region_id',    selectedRegion);
    if (selectedSubregion) params.set('subregion_id', selectedSubregion);
    return params.toString();
  };

  const fetchReport = async () => {
    setLoading(true); setError(''); setData([]); setLimited(false);
    try {
      const qs = buildQuery();
      const url = `/api/admin/competitor-analysis${qs ? `?${qs}` : ''}`;
      const res = await fetch(url, { headers });
      const lim = res.headers.get('X-Data-Limited') === 'true';
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Failed to load report'); setData([]); }
      else { setData(Array.isArray(d) ? d : []); setLimited(lim); setVisibleCount(10); }
    } catch (e) { setError('Network error'); setData([]); }
    finally { setLoading(false); }
  };

  const resetFilters = () => { setYear(''); setMonth(''); setDateFrom(''); setDateTo(''); setSelectedRegion(''); setSelectedSubregion(''); setData([]); };
  const hasFilters = Boolean(dateFrom || dateTo || year || month || selectedRegion || selectedSubregion);

  const downloadExcel = async () => {
    if (!data || !data.length) return;
    try {
      const XLSX = await import('xlsx');
      const rows = [ ['Customer name','Subregion','Brands','Last updated'] ];
      data.forEach(r => {
        const brands = Array.isArray(r.brands) ? r.brands.join('; ') : '';
        const last = r.last_seen ? new Date(r.last_seen).toLocaleString() : '';
        rows.push([r.shop_name, r.subregion_name || '', brands, last]);
      });
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Competitor Analysis');
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `competitor-analysis-${new Date().toISOString().slice(0,10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Excel export failed', e);
    }
  };

  const downloadCsv = () => {
    if (!data || !data.length) return;
    const dateLabel = dateFrom || dateTo
      ? `${dateFrom || ''}${dateTo ? '_to_' + dateTo : ''}`
      : year && month ? `${year}-${String(month).padStart(2,'0')}` : new Date().toISOString().slice(0,10);
    const header = ['#','Customer Name','Subregion','Competitor Brands','Last Updated'];
    const rows = data.map((r, i) => [
      i + 1,
      r.shop_name || '',
      r.subregion_name || '',
      Array.isArray(r.brands) ? r.brands.join('; ') : '',
      r.last_seen ? new Date(r.last_seen).toLocaleString() : '',
    ]);
    const csvContent = [header, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `competitor-analysis-${dateLabel}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // ── Leaflet support (uses OpenStreetMap tiles; no API key) ─────────
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markersRef = useRef([]);
  const tileLayerRef = useRef(null);
  const labelLayerRef = useRef(null);
  const satelliteRef = useRef(false);
  const [satellite, setSatellite] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [compMapFullscreen, setCompMapFullscreen] = useState(false);

  const loadLeaflet = () => new Promise((resolve, reject) => {
    if (window.L) return resolve(window.L);
    const cssId = 'leaflet-css';
    const jsId = 'leaflet-js';
    if (!document.getElementById(cssId)) {
      const l = document.createElement('link');
      l.id = cssId; l.rel = 'stylesheet';
      l.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(l);
    }
    if (document.getElementById(jsId)) {
      const check = setInterval(() => { if (window.L) { clearInterval(check); resolve(window.L); } }, 200);
      return;
    }
    const s = document.createElement('script');
    s.id = jsId;
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.async = true;
    s.onload = () => resolve(window.L);
    s.onerror = () => reject(new Error('Failed to load Leaflet JS'));
    document.head.appendChild(s);
  });

  const swapTiles = (isSat) => {
    if (!mapInstance.current || !window.L) return;
    if (tileLayerRef.current) { tileLayerRef.current.remove(); tileLayerRef.current = null; }
    if (labelLayerRef.current) { labelLayerRef.current.remove(); labelLayerRef.current = null; }
    const url = isSat
      ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    const attr = isSat ? '&copy; Esri' : '&copy; OpenStreetMap contributors';
    tileLayerRef.current = window.L.tileLayer(url, { maxZoom: 19, attribution: attr });
    tileLayerRef.current.addTo(mapInstance.current);
    if (isSat) {
      labelLayerRef.current = window.L.tileLayer(
        'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19, opacity: 1, pane: 'overlayPane' }
      );
      labelLayerRef.current.addTo(mapInstance.current);
    }
  };

  const initLeaflet = () => {
    if (!mapRef.current) return;
    if (!window.L) return;
    // clear previous markers and map
    markersRef.current.forEach(m => { try { m.remove(); } catch (e) {} });
    markersRef.current = [];
    if (mapInstance.current && mapInstance.current.remove) mapInstance.current.remove();

    const points = (data || []).map(d => ({
      id: d.shop_id,
      name: d.shop_name,
      brands: Array.isArray(d.brands) ? d.brands.join(', ') : '',
      lat: Number(d.latitude),
      lng: Number(d.longitude),
      last: d.last_seen,
      sub: d.subregion_name || ''
    })).filter(p => p.lat !== null && p.lng !== null && !isNaN(p.lat) && !isNaN(p.lng));

    const center = points.length > 0 ? [points[0].lat, points[0].lng] : [0, 0];
    mapInstance.current = window.L.map(mapRef.current).setView(center, points.length > 0 ? 12 : 2);
    swapTiles(satelliteRef.current);

    const bounds = window.L.latLngBounds([]);
    points.forEach(p => {
      const marker = window.L.marker([p.lat, p.lng]).addTo(mapInstance.current);
      const popupHtml = '<div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif"><strong>' + (p.name || '') + '</strong><div style="font-size:0.9rem;color:#374151">' + (p.sub || '') + '</div><div style="margin-top:6px">' + (p.brands || '') + '</div><div style="font-size:0.85rem;color:#6b7280;margin-top:6px">' + (p.last ? new Date(p.last).toLocaleString() : '') + '</div><a href="https://www.google.com/maps?q=&layer=c&cbll=' + p.lat + ',' + p.lng + '" target="_blank" rel="noreferrer" style="display:inline-block;margin-top:8px;font-size:0.78rem;color:#2563eb;text-decoration:none;font-weight:600">📍 Street View</a></div>';
      marker.bindPopup(popupHtml);
      markersRef.current.push(marker);
      bounds.extend([p.lat, p.lng]);
    });
    if (points.length > 0) mapInstance.current.fitBounds(bounds, { padding: [40,40] });
  };

  useEffect(() => {
    if (!showMap) return;
    loadLeaflet().then(() => initLeaflet()).catch(err => console.error('Leaflet load/init error', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMap, data]);

  useEffect(() => {
    satelliteRef.current = satellite;
    swapTiles(satellite);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satellite]);

  const downloadMapHtml = () => {
    const points = (data || [])
      .map(d => ({ name: d.shop_name, lat: d.latitude, lng: d.longitude, brands: Array.isArray(d.brands) ? d.brands.join(', ') : '', sub: d.subregion_name || '', last: d.last_seen }))
      .filter(p => p.lat !== null && p.lng !== null && !isNaN(Number(p.lat)) && !isNaN(Number(p.lng)));
    const ptsJson = JSON.stringify(points);
    /* eslint-disable no-template-curly-in-string */
    const html = `<!doctype html>
<html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Competitor Map</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>body{margin:0;font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif}#map{height:100vh;width:100vw}</style>
</head><body>
<div id="map" style="height:100vh;width:100vw"></div>
<div id="tile-toggle" style="position:fixed;top:16px;right:10px;z-index:1000;display:flex;gap:4px">
  <button id="btn-default" onclick="setTile(false)" style="height:32px;padding:0 12px;border:none;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.2);background:#0f766e;color:#fff">\u{1F5FA} Default</button>
  <button id="btn-sat" onclick="setTile(true)" style="height:32px;padding:0 12px;border:none;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.2);background:rgba(255,255,255,0.9);color:#1e293b">\u{1F6F0} Satellite</button>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<script>
const data = ${ptsJson};
const map = L.map('map').setView(data.length>0?[parseFloat(data[0].lat),parseFloat(data[0].lng)]:[0,0],data.length>0?12:2);
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
    tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {maxZoom:19,attribution:'&copy; OpenStreetMap contributors &copy; CARTO'}).addTo(map);
    bd.style.background='#0f766e'; bd.style.color='#fff';
    bs.style.background='rgba(255,255,255,0.9)'; bs.style.color='#1e293b';
  }
}
setTile(false);
const bounds = L.latLngBounds([]);
data.forEach(function(p) {
  const lat = parseFloat(p.lat), lng = parseFloat(p.lng);
  const marker = L.marker([lat, lng]).addTo(map);
  const svLink = '<a href="https://www.google.com/maps?q=&layer=c&cbll=' + lat + ',' + lng + '" target="_blank" style="display:inline-block;margin-top:8px;font-size:0.78rem;color:#2563eb;text-decoration:none;font-weight:600">\u{1F4CD} Street View</a>';
  const popupHtml = '<div style="font-family:Inter,system-ui,sans-serif"><strong>' + (p.name||'') + '</strong><div style="font-size:0.9rem;color:#374151">' + (p.sub||'') + '</div><div style="margin-top:6px">' + (p.brands||'') + '</div><div style="font-size:0.85rem;color:#6b7280;margin-top:6px">' + (p.last?new Date(p.last).toLocaleString():'') + '</div>' + svLink + '</div>';
  marker.bindPopup(popupHtml);
  bounds.extend([lat, lng]);
});
if (data.length>0) map.fitBounds(bounds,{padding:[40,40]});
<\/script></body></html>`;
    /* eslint-enable no-template-curly-in-string */
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'competitor-map-' + new Date().toISOString().slice(0,10) + '.html';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  // ── Summary stats ──────────────────────────────────────────────────
  const allBrands = data.flatMap(r => Array.isArray(r.brands) ? r.brands : []);
  const brandFreq = allBrands.reduce((acc, b) => { acc[b] = (acc[b] || 0) + 1; return acc; }, {});
  const brandEntries = Object.entries(brandFreq).sort((a, b) => b[1] - a[1]);
  const topBrand = brandEntries[0];
  const uniqueBrands = brandEntries.length;

  return (
    <div className={styles.targetsWrap} style={{ maxWidth: 1200 }}>

      {/* ── Header ── */}
      <div className={styles.targetsHeader}>
        <div>
          <h2 className={styles.targetsTitle}>🔬 Competitor Analysis</h2>
          <p className={styles.targetsSubtitle}>
            {data.length > 0
              ? `${data.length} shop${data.length !== 1 ? 's' : ''} stocking competitor brands`
              : 'Report of shops stocking competitor brands'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            className={styles.perfExcelBtn}
            onClick={() => setCompPreviewOpen(true)}
            disabled={!data.length}
          >
            👁 Preview Report
          </button>
          <button
            onClick={() => { setShowMap(s => !s); if (compMapFullscreen) setCompMapFullscreen(false); }}
            style={{
              height: 38, padding: '0 16px', border: 'none', borderRadius: 8,
              background: showMap ? '#0f766e' : '#0e7490',
              color: '#fff', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer',
            }}
          >
            {showMap ? '🗺️ Hide Map' : '🗺️ Show Map'}
          </button>
          {showMap && data.length > 0 && (
            <button
              onClick={() => { setCompMapFullscreen(true); setTimeout(() => { if (mapInstance.current) mapInstance.current.invalidateSize(); }, 200); }}
              style={{ height: 38, padding: '0 16px', border: 'none', borderRadius: 8, background: '#1e293b', color: '#fff', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer' }}
            >
              🖥 Fullscreen
            </button>
          )}
          <button
            onClick={() => { try { downloadMapHtml(); } catch (e) { console.error(e); alert('Map export failed: ' + (e.message || e)); } }}
            disabled={!data.length}
            style={{
              height: 38, padding: '0 16px', border: 'none', borderRadius: 8,
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              color: '#fff', fontSize: '0.82rem', fontWeight: 700,
              cursor: data.length ? 'pointer' : 'default',
              opacity: data.length ? 1 : 0.4,
              boxShadow: data.length ? '0 2px 8px rgba(99,102,241,0.3)' : 'none',
            }}
          >
            ⬇ Download Map
          </button>
          <button
            onClick={downloadCsv}
            disabled={!data.length}
            style={{
              height: 38, padding: '0 16px', border: 'none', borderRadius: 8,
              background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
              color: '#fff', fontSize: '0.82rem', fontWeight: 700,
              cursor: data.length ? 'pointer' : 'default',
              opacity: data.length ? 1 : 0.4,
              boxShadow: data.length ? '0 2px 8px rgba(5,150,105,0.3)' : 'none',
            }}
          >
            📥 Export CSV
          </button>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className={styles.custFilterBar} style={{ marginBottom: 20 }}>
        <select className={styles.custSelect} value={year} onChange={e => { setYear(e.target.value); setDateFrom(''); setDateTo(''); }} disabled={!!(dateFrom || dateTo)}>
          <option value="">Year</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className={styles.custSelect} value={month} onChange={e => { setMonth(e.target.value); setDateFrom(''); setDateTo(''); }} disabled={!!(dateFrom || dateTo)}>
          <option value="">Month</option>
          {months.map((m, i) => i > 0 && <option key={i} value={i}>{m}</option>)}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={e => { setDateFrom(e.target.value); setYear(''); setMonth(''); }}
          className={styles.custSelect}
          title="From date"
          style={{ minWidth: 140 }}
          placeholder="From date"
        />
        <input
          type="date"
          value={dateTo}
          onChange={e => { setDateTo(e.target.value); setYear(''); setMonth(''); }}
          className={styles.custSelect}
          title="To date"
          style={{ minWidth: 140 }}
          placeholder="To date"
        />
        <select className={styles.custSelect} value={selectedRegion} onChange={e => setSelectedRegion(e.target.value)}>
          <option value="">All Regions</option>
          {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select className={styles.custSelect} value={selectedSubregion} onChange={e => setSelectedSubregion(e.target.value)} disabled={!selectedRegion}>
          <option value="">All Subregions</option>
          {subregions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button
          className={styles.custRefreshBtn}
          style={{ background: primary }}
          onClick={fetchReport}
          disabled={loading}
        >
          {loading ? '⏳ Loading…' : '🔍 Apply'}
        </button>
        <button className={styles.btnCancel} onClick={resetFilters}>
          ✕ Reset
        </button>
      </div>

      {/* ── Month-without-year warning ── */}
      {month && !year && !(dateFrom || dateTo) && (
        <div style={{ marginBottom: 12, padding: '8px 14px', background: '#fef9c3', color: '#854d0e', borderRadius: 8, fontSize: '0.82rem', border: '1px solid #fde047' }}>
          ⚠️ Please also select a <strong>Year</strong> — month alone cannot filter results.
        </div>
      )}

      {/* ── Alerts ── */}
      {error && <div className={styles.alertDanger} style={{ marginBottom: 16 }}>{error}</div>}


      {/* ── Summary strip ── */}
      {data.length > 0 && (
        <div className={styles.targetsSummary}>
          <div className={styles.targetsSummaryItem}>
            <span className={styles.targetsSummaryVal}>{data.length}</span>
            <span className={styles.targetsSummaryLabel}>Shops Found</span>
          </div>
          <div className={styles.targetsSummaryDivider} />
          <div className={styles.targetsSummaryItem}>
            <span className={styles.targetsSummaryVal}>{uniqueBrands}</span>
            <span className={styles.targetsSummaryLabel}>Competitor Brands</span>
          </div>
          <div className={styles.targetsSummaryDivider} />
          <div className={styles.targetsSummaryItem}>
            <span className={styles.targetsSummaryVal} style={{ fontSize: '0.95rem' }}>
              {topBrand ? topBrand[0] : '—'}
            </span>
            <span className={styles.targetsSummaryLabel}>Top Competitor</span>
          </div>
          <div className={styles.targetsSummaryDivider} />
          <div className={styles.targetsSummaryItem}>
            <span className={styles.targetsSummaryVal}>{allBrands.length}</span>
            <span className={styles.targetsSummaryLabel}>Brand Sightings</span>
          </div>
        </div>
      )}

      {/* ── Loading state ── */}
      {loading && <div className={styles.loadingState}>⏳ Loading competitor data…</div>}

      {/* ── Map section ── */}
      {showMap && (
        <div style={compMapFullscreen ? {
          position: 'fixed', inset: 0, zIndex: 9900,
          background: '#0f172a', display: 'flex', flexDirection: 'column',
          animation: 'mapFsIn 0.2s ease',
        } : {
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
          overflow: 'hidden', marginBottom: 20,
          height: data.length === 0 ? 180 : 440,
          position: 'relative',
          boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
        }}>
          {compMapFullscreen && (
            <>
              <style>{`@keyframes mapFsIn { from { opacity:0; transform:scale(0.985); } to { opacity:1; transform:scale(1); } }`}</style>
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, zIndex: 9901,
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 16px',
                background: 'linear-gradient(to bottom, rgba(0,0,0,0.65) 0%, transparent 100%)',
                pointerEvents: 'none',
              }}>
                <button
                  onClick={() => { setCompMapFullscreen(false); setTimeout(() => { if (mapInstance.current) mapInstance.current.invalidateSize(); }, 200); }}
                  style={{ pointerEvents: 'all', height: 36, padding: '0 18px', background: 'rgba(255,255,255,0.95)', color: '#1e293b', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.3)' }}
                >
                  ← Back
                </button>
                {[{ label: '🗺 Default', val: false }, { label: '🛰 Satellite', val: true }].map(opt => (
                  <button
                    key={String(opt.val)}
                    onClick={() => { satelliteRef.current = opt.val; setSatellite(opt.val); }}
                    style={{ pointerEvents: 'all', height: 36, padding: '0 14px', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.3)', background: satellite === opt.val ? (opt.val ? '#1d4ed8' : '#0f766e') : 'rgba(255,255,255,0.85)', color: satellite === opt.val ? '#fff' : '#1e293b' }}
                  >
                    {opt.label}
                  </button>
                ))}
                <button
                  onClick={() => { try { downloadMapHtml(); } catch(e) { alert('Map export failed: ' + (e.message || e)); } }}
                  style={{ pointerEvents: 'all', height: 36, padding: '0 18px', background: 'rgba(99,102,241,0.95)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', boxShadow: '0 2px 10px rgba(99,102,241,0.4)' }}
                >
                  ⬇ Download Map
                </button>
                <span style={{ pointerEvents: 'none', background: 'rgba(0,0,0,0.5)', color: '#e2e8f0', padding: '6px 12px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600 }}>
                  Competitor Analysis · {data.length} shops
                </span>
              </div>
            </>
          )}
          {data.length === 0 && !loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: '0.875rem' }}>
              Apply filters to load map data
            </div>
          )}
          {!compMapFullscreen && data.length > 0 && (
            <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, display: 'flex', gap: 4 }}>
              {[{ label: '🗺 Default', val: false }, { label: '🛰 Satellite', val: true }].map(opt => (
                <button
                  key={String(opt.val)}
                  onClick={() => { satelliteRef.current = opt.val; setSatellite(opt.val); }}
                  style={{ height: 30, padding: '0 10px', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer', background: satellite === opt.val ? (opt.val ? '#1d4ed8' : '#0f766e') : 'rgba(255,255,255,0.9)', color: satellite === opt.val ? '#fff' : '#1e293b', boxShadow: '0 1px 5px rgba(0,0,0,0.2)' }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          <div ref={mapRef} style={{ width: '100%', height: '100%', borderRadius: compMapFullscreen ? 0 : 14 }} />
        </div>
      )}

      {/* ── Empty states ── */}
      {!loading && data.length === 0 && hasFilters && !showMap && (
        <div className={styles.emptyState} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '48px 20px' }}>
          <div className={styles.emptyIcon}>🏪</div>
          <p>No shops match the selected filters.</p>
        </div>
      )}
      {!loading && data.length === 0 && !hasFilters && (
        <div className={styles.emptyState} style={{ background: '#fff', border: '1px dashed #e2e8f0', borderRadius: 16, padding: '60px 20px' }}>
          <div className={styles.emptyIcon}>🔍</div>
          <p>Select filters and click <strong>Apply</strong> to load the competitor report.</p>
        </div>
      )}

      {/* ── Data table ── */}
      {!loading && data.length > 0 && (
        <div className={styles.targetsTableWrap}>
          <table className={styles.targetsTable}>
            <thead>
              <tr>
                <th style={{ width: 40, padding: '13px 8px 13px 20px' }}>#</th>
                <th>Shop / Customer</th>
                <th>Subregion</th>
                <th>Competitor Brands</th>
                <th className={styles.perfThNum}>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.slice(0, visibleCount).map((r, i) => (
                <tr key={i} className={styles.perfRow}>
                  <td className={styles.targetsIdx}>{i + 1}</td>
                  <td>
                    <div className={styles.targetsPersonCell}>
                      <div
                        className={styles.targetsAvatar}
                        style={{ background: '#dc2626', fontSize: '0.88rem' }}
                      >
                        {(r.shop_name || 'S').charAt(0).toUpperCase()}
                      </div>
                      <div className={styles.targetsPersonName}>{r.shop_name}</div>
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', color: '#475569', fontSize: '0.875rem' }}>
                    {r.subregion_name || <span style={{ color: '#cbd5e1' }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {Array.isArray(r.brands) && r.brands.length > 0
                        ? r.brands.map((b, bi) => (
                            <span
                              key={bi}
                              style={{
                                display: 'inline-block', padding: '3px 10px', borderRadius: 20,
                                fontSize: '0.73rem', fontWeight: 700,
                                background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca',
                              }}
                            >
                              {b}
                            </span>
                          ))
                        : <span style={{ color: '#cbd5e1', fontSize: '0.8rem' }}>—</span>}
                    </div>
                  </td>
                  <td className={styles.targetsNumCell} style={{ whiteSpace: 'nowrap', color: '#64748b', fontSize: '0.8rem' }}>
                    {r.last_seen ? new Date(r.last_seen).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length > 10 && (
            <div style={{ textAlign: 'center', marginTop: 16, marginBottom: 8 }}>
              <button
                onClick={() => setVisibleCount(v => v >= data.length ? 10 : data.length)}
                style={{
                  padding: '8px 28px', borderRadius: 20, border: `1.5px solid ${primary}`,
                  background: '#fff', color: primary, fontWeight: 700, fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
              >
                {visibleCount >= data.length
                  ? `▲ Show Less`
                  : `▼ Show More (${data.length - visibleCount} more)`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Preview modal ── */}
      <ReportPreviewModal
        open={compPreviewOpen}
        onClose={() => setCompPreviewOpen(false)}
        title="Competitor Analysis"
        subtitle={dateFrom || dateTo ? `${dateFrom || ''}${dateTo ? ' → ' + dateTo : ''}`.trim() : (month && year ? months[parseInt(month)] + ' ' + year : year || month || 'All time')}
        headers={['Shop', 'Subregion', 'Competitor Brands', 'Last Updated']}
        rows={(data || []).map(r => [
          r.shop_name,
          r.subregion_name || '',
          Array.isArray(r.brands) ? r.brands.join(', ') : '',
          r.last_seen ? new Date(r.last_seen).toLocaleDateString() : '—',
        ])}
        onExport={downloadExcel}
      />
    </div>
  );
}
