import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

/**
 * MapFullscreenModal
 *
 * Full-screen map overlay for the Admin/Manager Map tab.
 * Receives already-fetched markers — NO additional API calls are made.
 *
 * Props:
 *   open         {bool}     — whether the modal is visible
 *   onClose      {fn}       — called when user clicks "← Back" or presses Escape
 *   markers      {array}    — same marker objects from MapTab state (no refetch)
 *   filterLabel  {string}   — human-readable filter summary shown in the header
 *   primary      {string}   — brand theme colour (hex)
 */
export default function MapFullscreenModal({ open, onClose, markers = [], filterLabel = '', primary = '#2563eb', hideLegend = false }) {
  const mapRef        = useRef(null);
  const leafletMapRef = useRef(null);
  const markersRef    = useRef([]);
  const tileLayerRef  = useRef(null);
  const labelLayerRef = useRef(null);
  const [mapReady,    setMapReady]    = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [satellite,   setSatellite]   = useState(false);

  // ── Keyboard shortcut: Escape closes the modal ──────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // ── Initialise / destroy Leaflet map when open state changes ────────────
  useEffect(() => {
    if (!open) {
      // Destroy map when modal is hidden to free resources
      if (leafletMapRef.current) {
        try { leafletMapRef.current.remove(); } catch { /* ignore */ }
        leafletMapRef.current = null;
      }
      setMapReady(false);
      return;
    }

    // Give React time to paint the container div before Leaflet queries it
    let mounted = true;
    const t = setTimeout(() => {
      if (!mounted || !mapRef.current || mapRef.current._leaflet_id) return;

      import('leaflet').then(L => {
        if (!mounted || !mapRef.current || mapRef.current._leaflet_id) return;

        // Fix default icon paths broken by webpack bundling
        delete L.Icon.Default.prototype._getIconUrl;
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
          iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
          shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        });

        const map = L.map(mapRef.current, {
          center: [-1.286389, 36.817223], // Nairobi default
          zoom: 11,
          zoomControl: true,
        });

        // CartoDB voyager tiles — clean, fast, no API key required
        tileLayerRef.current = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
          maxZoom: 19,
        });
        tileLayerRef.current.addTo(map);

        leafletMapRef.current = map;
        if (mounted) setMapReady(true);
      });
    }, 150);

    return () => {
      mounted = false;
      clearTimeout(t);
      if (leafletMapRef.current) {
        try { leafletMapRef.current.remove(); } catch { /* ignore */ }
        leafletMapRef.current = null;
      }
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Swap tile layer when satellite toggle changes ─────────────────────
  useEffect(() => {
    if (!mapReady || !leafletMapRef.current || !tileLayerRef.current) return;
    import('leaflet').then(L => {
      // Remove existing base + label layers
      tileLayerRef.current.remove();
      if (labelLayerRef.current) { labelLayerRef.current.remove(); labelLayerRef.current = null; }

      const url = satellite
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
      const attribution = satellite
        ? 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
        : '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>';
      tileLayerRef.current = L.tileLayer(url, { attribution, maxZoom: 19 });
      tileLayerRef.current.addTo(leafletMapRef.current);

      // Add label overlay on top of satellite (hybrid view)
      if (satellite) {
        labelLayerRef.current = L.tileLayer(
          'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
          { maxZoom: 19, opacity: 1, pane: 'overlayPane' }
        );
        labelLayerRef.current.addTo(leafletMapRef.current);
      }

      markersRef.current.forEach(m => { try { m.bringToFront(); } catch { /* ignore */ } });
    });
  }, [satellite, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Redraw markers whenever markers or mapReady changes ───────
  useEffect(() => {
    if (!mapReady || !leafletMapRef.current) return;

    import('leaflet').then(L => {
      // Remove previous markers
      markersRef.current.forEach(m => { try { m.remove(); } catch { /* ignore */ } });
      markersRef.current = [];

      if (!markers.length) return;

      const bounds = [];

      const fmtDate = iso => new Date(iso).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });

      const fmtDateShort = iso => {
        const d = new Date(iso);
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
      };

      markers.forEach(m => {
        const isUnvisited = m.type === 'unvisited';
        const color = isUnvisited ? '#374151'
          : m.type === 'sold'   ? '#16a34a'
          : m.type === 'uplift' ? '#d97706'
          : '#dc2626';
        const emoji = isUnvisited ? ''
          : m.type === 'sold'   ? '🟢'
          : m.type === 'uplift' ? '🟡'
          : '🔴';

        // Date label shown under each pin
        const dateLabel = isUnvisited
          ? ''
          : (m.visited_at ? `<div style="background:rgba(0,0,0,0.75);color:#fff;font-size:8px;padding:1px 5px;border-radius:8px;white-space:nowrap;font-weight:700;margin-top:2px;letter-spacing:0.02em">${fmtDateShort(m.visited_at)}</div>` : '');

        const icon = L.divIcon({
          className: '',
          html: isUnvisited
            ? `<div style="display:flex;flex-direction:column;align-items:center"><div style="width:26px;height:26px;border-radius:50%;background:#374151;border:2.5px solid rgba(255,255,255,0.9);box-shadow:0 1px 6px rgba(0,0,0,0.4);cursor:pointer;opacity:0.7;"></div>${dateLabel}</div>`
            : `<div style="display:flex;flex-direction:column;align-items:center"><div style="width:34px;height:34px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;font-size:14px;cursor:pointer;">${emoji}</div>${dateLabel}</div>`,
          iconSize:    isUnvisited ? [80, 46] : [80, 50],
          iconAnchor:  isUnvisited ? [40, 26] : [40, 34],
          popupAnchor: [0, -36],
        });

        if (isUnvisited) {
          const popupHtml = `<div style="width:230px;font-family:system-ui,sans-serif;font-size:0.82rem;padding:2px 0"><div style="font-weight:700;font-size:0.94rem;color:#1e293b;margin-bottom:3px">${m.shop_name}</div>${m.shop_location ? `<div style="font-size:0.7rem;color:#64748b;margin-bottom:6px">📍 ${m.shop_location}</div>` : ''}<div style="margin-bottom:8px"><span style="display:inline-flex;align-items:center;gap:5px;background:#374151;color:#f9fafb;padding:3px 11px;border-radius:20px;font-size:0.72rem;font-weight:700;letter-spacing:0.02em">● Not Yet Visited</span></div><div><a href="https://www.google.com/maps?q=&layer=c&cbll=${m.latitude},${m.longitude}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:4px 12px;background:#1a73e8;color:#fff;border-radius:6px;font-size:0.72rem;font-weight:700;text-decoration:none">🗣 Street View</a></div></div>`;
          const lMarker = L.marker([m.latitude, m.longitude], { icon }).addTo(leafletMapRef.current).bindPopup(popupHtml, { maxWidth: 240, className: 'sprint-popup' });
          markersRef.current.push(lMarker);
          bounds.push([m.latitude, m.longitude]);
          return;
        }

        const skuRows = (m.skus || [])
          .filter(s => {
            if (m.type === 'sold')     return s.sold > 0;
            if (m.type === 'uplift')   return s.cartons_uplifted > 0;
            if (m.type === 'not_sold') return false;
            return true;
          })
          .map(s => {
            if (m.type === 'uplift')
              return `<tr><td style="padding:2px 8px 2px 0;font-weight:600">${s.sku}</td><td>${s.name}</td><td style="text-align:right;color:#d97706;font-weight:700">${s.cartons_uplifted} ctn</td></tr>`;
            if (s.sold > 0)
              return `<tr><td style="padding:2px 8px 2px 0;font-weight:600">${s.sku}</td><td>${s.name}</td><td style="text-align:right;color:#16a34a;font-weight:700">${s.sold} ctn</td></tr>`;
            return `<tr><td style="padding:2px 8px 2px 0;font-weight:600">${s.sku}</td><td>${s.name}</td><td style="text-align:right;color:#dc2626;font-size:0.7rem">${s.not_sold_reason || 'Not sold'}</td></tr>`;
          }).join('');

        const statusLabel = m.type === 'sold'
          ? `<span style="background:#dcfce7;color:#166534;padding:2px 10px;border-radius:12px;font-size:0.72rem;font-weight:700">✅ Sold</span>`
          : m.type === 'uplift'
          ? `<span style="background:#fef3c7;color:#92400e;padding:2px 10px;border-radius:12px;font-size:0.72rem;font-weight:700">📦 Uplift${m.uplift_status ? ' · ' + m.uplift_status : ''}</span>`
          : `<span style="background:#fee2e2;color:#991b1b;padding:2px 10px;border-radius:12px;font-size:0.72rem;font-weight:700">❌ Not Sold</span>`;

        // Selfie: show a loading placeholder; actual image fetched on popup open
        const selfieMarkerId = `selfie-${String(m.id).replace(/[^a-z0-9]/gi, '')}`;
        const selfieHtml = m.selfie_path
          ? `<div id="${selfieMarkerId}" style="width:100%;min-height:60px;background:#f1f5f9;border-radius:8px;margin-bottom:8px;display:flex;align-items:center;justify-content:center;font-size:0.72rem;color:#94a3b8">📸 Loading photo…</div>`
          : '';

        const popupHtml = `
          <div style="width:260px;font-family:system-ui,sans-serif;font-size:0.82rem">
            ${selfieHtml}
            <div style="font-weight:700;font-size:0.95rem;color:#1e293b;margin-bottom:2px">${m.shop_name}</div>
            ${m.shop_location ? `<div style="font-size:0.7rem;color:#64748b;margin-bottom:6px">${m.shop_location}</div>` : ''}
            <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
              ${statusLabel}
              <span style="font-size:0.7rem;color:#94a3b8">${fmtDate(m.visited_at)}</span>
            </div>
            <div style="font-size:0.78rem;color:#475569;margin-bottom:8px">
              👤 <strong>${m.salesperson_name}</strong>
            </div>
            ${skuRows ? `<table style="width:100%;border-collapse:collapse;font-size:0.75rem">${skuRows}</table>` : ''}
            ${m.type === 'sold' ? `<div style="margin-top:6px;font-weight:700;color:#16a34a">Total sold: ${m.total_sold} cartons</div>` : ''}
            ${m.type === 'uplift' ? `<div style="margin-top:6px;font-weight:700;color:#d97706">Total uplifted: ${m.total_uplifted} cartons</div>` : ''}
            ${m.not_sold_reason ? `<div style="margin-top:8px;padding:6px 10px;background:#fee2e2;border-radius:8px;font-size:0.78rem;color:#991b1b;font-weight:600">📝 Reason: ${m.not_sold_reason}</div>` : ''}
            ${m.rejected_reason ? `<div style="margin-top:6px;font-size:0.72rem;color:#dc2626;font-weight:600;background:#fee2e2;padding:4px 8px;border-radius:6px">❌ Rejection reason: ${m.rejected_reason}</div>` : ''}
            <div style="margin-top:10px"><a href="https://www.google.com/maps?q=&layer=c&cbll=${m.latitude},${m.longitude}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:5px 14px;background:#1a73e8;color:#fff;border-radius:6px;font-size:0.75rem;font-weight:700;text-decoration:none">🗣 Street View</a></div>
          </div>`;

        const lMarker = L.marker([m.latitude, m.longitude], { icon })
          .addTo(leafletMapRef.current)
          .bindPopup(popupHtml, { maxWidth: 280, className: 'sprint-popup' });

        // Fetch selfie signed URL when the popup opens
        if (m.selfie_path) {
          lMarker.on('popupopen', async () => {
            const el = document.getElementById(selfieMarkerId);
            if (!el) return;
            try {
              const sb = supabase;
              if (!sb) return;
              const { data: { session } } = await sb.auth.getSession();
              const tok = session?.access_token;
              if (!tok) return;
              const res = await fetch(`/api/admin/signed-url?path=${encodeURIComponent(m.selfie_path)}`, {
                headers: { Authorization: `Bearer ${tok}` },
              });
              const data = await res.json();
              if (data.url && el) {
                el.innerHTML = `<img src="${data.url}" style="width:100%;max-height:200px;object-fit:contain;background:#f1f5f9;border-radius:8px;" />`;
              } else if (el) {
                el.style.display = 'none';
              }
            } catch (e) {
              if (el) el.style.display = 'none';
            }
          });
        }

        markersRef.current.push(lMarker);
        bounds.push([m.latitude, m.longitude]);
      });

      if (bounds.length > 0) {
        leafletMapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      }
    });
  }, [markers, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Download map as standalone HTML file ────────────────────────────────
  const downloadHtml = () => {
    if (!markers.length) return;
    setDownloading(true);
    try {
      const fmtDate = iso => new Date(iso).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });

      const markerJs = markers.map(m => {
        const isUnvisited = m.type === 'unvisited';
        const color = isUnvisited ? '#374151'
          : m.type === 'sold'   ? '#16a34a'
          : m.type === 'uplift' ? '#d97706'
          : '#dc2626';
        const label = isUnvisited ? '● Not Yet Visited'
          : m.type === 'sold' ? '✅ Sold'
          : m.type === 'uplift' ? `📦 Uplift${m.uplift_status ? ' · ' + m.uplift_status : ''}`
          : '❌ Not Sold';

        if (isUnvisited) {
          const popup = `<b>${m.shop_name}</b>${m.shop_location ? `<br><small style="color:#6b7280">📍 ${m.shop_location}</small>` : ''}<br><span style="background:#374151;color:#f9fafb;padding:1px 8px;border-radius:12px;font-size:11px;font-weight:700">● Not Yet Visited</span><br><a href="https://www.google.com/maps?q=&layer=c&cbll=${m.latitude},${m.longitude}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:6px;padding:4px 12px;background:#1a73e8;color:#fff;border-radius:6px;font-size:11px;font-weight:700;text-decoration:none">🗣 Street View</a>`.trim();
          const safeId = String(m.id).replace(/[^a-zA-Z0-9]/g, '');
          return `
            var icon${safeId} = L.divIcon({ className:'', html:'<div style="width:22px;height:22px;border-radius:50%;background:#374151;border:2.5px solid rgba(255,255,255,0.85);box-shadow:0 1px 5px rgba(0,0,0,0.45);opacity:0.72;"></div>', iconSize:[22,22], iconAnchor:[11,11] });
            L.marker([${m.latitude},${m.longitude}],{icon:icon${safeId}}).addTo(map).bindPopup(${JSON.stringify(popup)});
          `;
        }

        const skuText = (m.skus || [])
          .filter(s => {
            if (m.type === 'sold')     return s.sold > 0;
            if (m.type === 'uplift')   return s.cartons_uplifted > 0;
            if (m.type === 'not_sold') return s.sold === 0;
            return true;
          })
          .map(s =>
            m.type === 'uplift'
              ? `${s.sku}: ${s.cartons_uplifted} ctn uplifted`
              : s.sold > 0 ? `${s.sku}: ${s.sold} ctn sold` : `${s.sku}: not sold (${s.not_sold_reason || '—'})`
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
          ${m.not_sold_reason ? `<br><span style="color:#991b1b;font-weight:600;background:#fee2e2;padding:2px 8px;border-radius:6px">📝 Reason: ${m.not_sold_reason}</span>` : ''}
          ${m.rejected_reason ? `<br><span style="color:#dc2626;font-weight:600">❌ Rejection reason: ${m.rejected_reason}</span>` : ''}
          <br><a href="https://www.google.com/maps?q=&layer=c&cbll=${m.latitude},${m.longitude}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:8px;padding:5px 14px;background:#1a73e8;color:#fff;border-radius:6px;font-size:0.75rem;font-weight:700;text-decoration:none">🗣 Street View</a>
        `.trim();

        const safeId = String(m.id).replace(/[^a-zA-Z0-9]/g, '');
        return `
          var icon${safeId} = L.divIcon({
            className: '',
            html: '<div style="width:28px;height:28px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>',
            iconSize: [28, 28], iconAnchor: [14, 14]
          });
          L.marker([${m.latitude}, ${m.longitude}], { icon: icon${safeId} })
            .addTo(map)
            .bindPopup(${JSON.stringify(popup)});
        `;
      }).join('\n');

      const soldCount      = markers.filter(m => m.type === 'sold').length;
      const notSoldCount    = markers.filter(m => m.type === 'not_sold').length;
      const upliftCount     = markers.filter(m => m.type === 'uplift').length;
      const unvisitedCount  = markers.filter(m => m.type === 'unvisited').length;
      const centerLat    = markers[0]?.latitude  || -1.286389;
      const centerLng    = markers[0]?.longitude || 36.817223;

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Map Export</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; }
  #map { height: 100vh; width: 100%; }
  #legend { position: fixed; top: 16px; left: 60px; background: #fff; padding: 12px 16px; border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); z-index: 1000; font-size: 13px; }
  #legend h3 { margin: 0 0 8px; font-size: 14px; }
  .leg { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
  .dot { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.2); }
  #view-toggle { position: fixed; top: 16px; right: 16px; z-index: 1000; display: flex; background: rgba(30,41,59,0.85); border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
  #view-toggle button { border: none; padding: 7px 14px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.15s, color 0.15s; background: transparent; color: rgba(255,255,255,0.8); }
  #view-toggle button.active { background: rgba(255,255,255,0.95); color: #1e293b; }
</style>
</head>
<body>
<div id="map"></div>
<div id="view-toggle">
  <button id="btn-street" class="active" onclick="setLayer(false)">🗺 Default</button>
  <button id="btn-satellite" onclick="setLayer(true)">🛰 Satellite</button>
</div>
${!hideLegend ? `<div id="legend">
  <h3>🗺️ Map Export</h3>
  <div style="font-size:11px;color:#64748b;margin-bottom:8px">${filterLabel || ''}</div>
  <div class="leg"><div class="dot" style="background:#16a34a"></div> Sold (${soldCount})</div>
  <div class="leg"><div class="dot" style="background:#dc2626"></div> Not Sold (${notSoldCount})</div>
  <div class="leg"><div class="dot" style="background:#d97706"></div> Uplift (${upliftCount})</div>
  ${unvisitedCount > 0 ? `<div class="leg"><div class="dot" style="background:#374151;border:2px solid rgba(255,255,255,0.7);"></div> Unvisited (${unvisitedCount})</div>` : ''}
</div>` : ''}
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map = L.map('map').setView([${centerLat}, ${centerLng}], 12);
var streetUrl    = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
var satUrl       = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
var labelUrl     = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
var baseLayer    = L.tileLayer(streetUrl, { attribution: '© OpenStreetMap contributors © CARTO', maxZoom: 19 }).addTo(map);
var labelLayer   = null;
var isSatellite  = false;
function setLayer(sat) {
  isSatellite = sat;
  baseLayer.remove();
  if (labelLayer) { labelLayer.remove(); labelLayer = null; }
  if (sat) {
    baseLayer = L.tileLayer(satUrl, { attribution: 'Tiles © Esri', maxZoom: 19 }).addTo(map);
    labelLayer = L.tileLayer(labelUrl, { maxZoom: 19, opacity: 1 }).addTo(map);
  } else {
    baseLayer = L.tileLayer(streetUrl, { attribution: '© OpenStreetMap contributors © CARTO', maxZoom: 19 }).addTo(map);
  }
  document.getElementById('btn-street').className    = sat ? '' : 'active';
  document.getElementById('btn-satellite').className = sat ? 'active' : '';
}
${markerJs}
</script>
</body>
</html>`;

      const blob = new Blob([html], { type: 'text/html' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `map-export-${new Date().toISOString().slice(0, 10)}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Map HTML export failed:', err);
      alert('Export failed: ' + err.message);
    } finally {
      setDownloading(false);
    }
  };

  const soldCount    = markers.filter(m => m.type === 'sold').length;
  const notSoldCount = markers.filter(m => m.type === 'not_sold').length;
  const upliftCount  = markers.filter(m => m.type === 'uplift').length;

  return (
    <>
      {/* Inject fade-in keyframe once */}
      <style>{`
        @keyframes mapFsIn {
          from { opacity: 0; transform: scale(0.985); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>

      {/* Outer overlay — always in DOM so Leaflet ref is stable; shown/hidden via display */}
      <div
        style={{
          display: open ? 'flex' : 'none',
          position: 'fixed', inset: 0, zIndex: 10000,
          flexDirection: 'column',
          background: '#0f172a',
          animation: open ? 'mapFsIn 0.2s ease' : 'none',
        }}
      >
        {/* ── Floating controls (excluded from PNG capture) ─────────── */}
        <div
          data-map-overlay="1"
          style={{
            position:   'absolute', top: 0, left: 0, right: 0,
            zIndex:     10001,
            display:    'flex', alignItems: 'center', gap: 10,
            padding:    '12px 16px',
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.65) 0%, transparent 100%)',
            pointerEvents: 'none',
          }}
        >
          {/* ← Back */}
          <button
            onClick={onClose}
            style={{
              pointerEvents: 'all',
              height: 36, padding: '0 18px',
              background: 'rgba(255,255,255,0.95)', color: '#1e293b',
              border: 'none', borderRadius: 8,
              fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
              boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            ← Back
          </button>

          {/* Download PNG */}
          <button
            onClick={downloadHtml}
            disabled={downloading || !markers.length}
            style={{
              pointerEvents: 'all',
              height: 36, padding: '0 18px',
              background: downloading ? 'rgba(130,130,130,0.7)' : 'rgba(99,102,241,0.95)',
              color: '#fff',
              border: 'none', borderRadius: 8,
              fontWeight: 700, fontSize: '0.82rem',
              cursor: downloading ? 'default' : 'pointer',
              boxShadow: '0 2px 10px rgba(99,102,241,0.4)',
              display: 'flex', alignItems: 'center', gap: 6,
              opacity: (downloading || !markers.length) ? 0.65 : 1,
              transition: 'opacity .15s',
            }}
          >
            {downloading ? '\u23f3 Exporting\u2026' : '\u2b07 Download Map'}
          </button>
          {/* Satellite toggle */}
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.15)', borderRadius: 8, padding: 2, gap: 2, backdropFilter: 'blur(4px)', pointerEvents: 'all', flexShrink: 0 }}>
            {[{ label: '🗺 Default', val: false }, { label: '🛰 Satellite', val: true }].map(opt => (
              <button
                key={String(opt.val)}
                onClick={() => setSatellite(opt.val)}
                style={{
                  padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontSize: '0.75rem', fontWeight: 700, transition: 'background .15s',
                  background: satellite === opt.val ? 'rgba(255,255,255,0.95)' : 'transparent',
                  color:      satellite === opt.val ? '#1e293b' : 'rgba(255,255,255,0.85)',
                }}
              >{opt.label}</button>
            ))}
          </div>
          {/* Filter label chip */}
          {filterLabel && (
            <span
              style={{
                pointerEvents: 'none',
                background: 'rgba(0,0,0,0.5)', color: '#e2e8f0',
                padding: '6px 12px', borderRadius: 8,
                fontSize: '0.75rem', fontWeight: 600,
                backdropFilter: 'blur(4px)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                maxWidth: 320,
              }}
            >
              {filterLabel}
            </span>
          )}

          {/* Legend pills pushed to right */}
          {!hideLegend && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, pointerEvents: 'none', flexWrap: 'wrap' }}>
            <span style={{ background:'rgba(220,252,231,0.9)', color:'#166534', padding:'4px 10px', borderRadius:20, fontSize:'0.72rem', fontWeight:700 }}>🟢 Sold {soldCount}</span>
            <span style={{ background:'rgba(254,226,226,0.9)', color:'#991b1b', padding:'4px 10px', borderRadius:20, fontSize:'0.72rem', fontWeight:700 }}>🔴 Not Sold {notSoldCount}</span>
            <span style={{ background:'rgba(254,243,199,0.9)', color:'#92400e', padding:'4px 10px', borderRadius:20, fontSize:'0.72rem', fontWeight:700 }}>🟡 Uplift {upliftCount}</span>
            <span style={{ background:'rgba(241,245,249,0.9)', color:'#475569', padding:'4px 10px', borderRadius:20, fontSize:'0.72rem', fontWeight:700 }}>Total {markers.length}</span>
          </div>
          )}
        </div>

        {/* ── Map container ──────────────────────────────────────────── */}
        <div
          ref={mapRef}
          style={{ flex: 1, width: '100%', height: '100%' }}
        />

        {/* ── Loading state ───────────────────────────────────────────── */}
        {open && !mapReady && (
          <div
            data-map-overlay="1"
            style={{
              position: 'absolute', inset: 0, zIndex: 10002,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(15,23,42,0.85)', color: '#94a3b8', gap: 14,
            }}
          >
            <div style={{ fontSize: '2rem' }}>🗺️</div>
            <div style={{ fontSize: '1rem', fontWeight: 600, color: '#e2e8f0' }}>Loading map…</div>
          </div>
        )}

        {/* ── Empty state ─────────────────────────────────────────────── */}
        {open && mapReady && markers.length === 0 && (
          <div
            data-map-overlay="1"
            style={{
              position: 'absolute', inset: 0, zIndex: 10002,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(15,23,42,0.85)', color: '#94a3b8', gap: 14,
            }}
          >
            <div style={{ fontSize: '2.5rem' }}>🗺️</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>No map data available</div>
            <div style={{ fontSize: '0.85rem' }}>No data for the selected filters.</div>
            <button
              onClick={onClose}
              style={{
                marginTop: 8, padding: '8px 24px',
                background: primary, color: '#fff',
                border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700,
              }}
            >
              ← Go Back
            </button>
          </div>
        )}
      </div>
    </>
  );
}
