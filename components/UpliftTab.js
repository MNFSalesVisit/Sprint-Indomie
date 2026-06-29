import React, { useEffect, useRef, useState, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { getAccuratePosition } from '../lib/geolocation';
import styles from '../styles/sales.module.css';

function clamp0(v) { return Math.max(0, parseInt(v, 10) || 0); }
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // metres
  const toRad = d => (d * Math.PI) / 180;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const dφ = toRad(lat2 - lat1), dλ = toRad(lon2 - lon1);
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Module-level shop list cache: persists across UpliftTab remounts (tab switches).
// Key: subregionId (string) → { shops: [], ts: number }
const _upliftShopsCache = new Map();
const UPLIFT_SHOPS_CACHE_TTL = 120_000; // 2 minutes

// Module-level meta cache: avoids repeated /api/sales/meta calls on tab switch
const _upliftMetaCache    = { data: null, ts: 0 };
const UPLIFT_META_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export default function UpliftTab({ primary, accent, onNavigate }) {
  const [step, setStep] = useState(1);

  const [region, setRegion] = useState(null);
  const [subregions, setSubregions] = useState([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState('');

  const [subregionId, setSubregionId] = useState('');
  const [shopMode, setShopMode] = useState('existing');
  const [shops, setShops] = useState([]);
  const [loadingShops, setLoadingShops] = useState(false);
  const [shopId, setShopId] = useState('');
  const [shopSearch, setShopSearch] = useState('');
  const [newShopName, setNewShopName] = useState('');
  const [newShopLoc, setNewShopLoc] = useState('');
  const [newShopLat, setNewShopLat] = useState(null);
  const [newShopLng, setNewShopLng] = useState(null);
  const [locCapturing, setLocCapturing] = useState(false);
  const [locError, setLocError] = useState('');
  const [dupMatches, setDupMatches] = useState([]);
  const [dupChecking, setDupChecking] = useState(false);
  const [dupDismissed, setDupDismissed] = useState(false);
  const [step1Error, setStep1Error] = useState('');

  const [nearbyShops, setNearbyShops] = useState([]);
  const [nearbyChecking, setNearbyChecking] = useState(false);
  const [nearbyConfirmNew, setNearbyConfirmNew] = useState(false);
  const [nearbyWarning, setNearbyWarning] = useState('');
  const [currentLat, setCurrentLat] = useState(null);
  const [currentLng, setCurrentLng] = useState(null);
  const [selectedShopDistance, setSelectedShopDistance] = useState(null);
  const hasFetchedOnMountRef = useRef(false);

  // Memoised filtered shop list — only recomputes when shops array or search text changes
  const filteredShops = useMemo(() => {
    const q = shopSearch.toLowerCase();
    return shops.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.location || '').toLowerCase().includes(q)
    );
  }, [shops, shopSearch]);

  const fetchNearbyFromCoordsUplift = async (lat, lng, mountedFlagRef) => {
    console.log('UpliftTab: fetching nearby shops...', { lat, lng });
    setNearbyChecking(true);
    setNearbyShops([]);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token;
      if (!tok) {
        console.log('UpliftTab: no auth token for nearby-shops call');
        return;
      }
      const url = `/api/sales/nearby-shops?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
      const data = await res.json();
      if (!res.ok) return;
      if (!mountedFlagRef.current) return;
      const unique = Array.from(new Map((data || []).map(s => [String(s.id), s])).values());
      setNearbyShops(unique);
      console.log('UpliftTab: nearbyShops set, count=', unique.length);
    } catch (e) {
      console.log('UpliftTab: nearby-shops fetch failed', e);
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
        console.log('UpliftTab: GPS error on mount', err);
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
    fetchNearbyFromCoordsUplift(currentLat, currentLng, mountedRef);
    return () => { mountedRef.current = false; };
  }, [shopMode, subregionId, currentLat, currentLng]); // eslint-disable-line react-hooks/exhaustive-deps

  // New shop GPS — triggers nearby fetch for duplicate detection
  useEffect(() => {
    if (newShopLat == null || newShopLng == null) return;
    const mountedRef = { current: true };
    setNearbyConfirmNew(false);
    fetchNearbyFromCoordsUplift(newShopLat, newShopLng, mountedRef);
    return () => { mountedRef.current = false; };
  }, [newShopLat, newShopLng]); // eslint-disable-line react-hooks/exhaustive-deps

  const [products, setProducts] = useState([]);
  const [loadingProds, setLoadingProds] = useState(false);
  const [prodsError, setProdsError] = useState('');
  const [upliftQty, setUpliftQty] = useState({});
  const [stockAfter, setStockAfter] = useState({});
  const [stockAfterUnit, setStockAfterUnit] = useState({});
  const [step2Error, setStep2Error] = useState('');

  const fetchProducts = () => {
    setLoadingProds(true);
    setProdsError('');
    supabase.auth.getSession().then(({ data: { session } }) => {
      const tok = session?.access_token;
      if (!tok) { setProdsError('Session expired.'); setLoadingProds(false); return; }
      fetch('/api/sales/products', { headers: { Authorization: `Bearer ${tok}` } })
        .then(r => r.json())
        .then(data => {
          if (!Array.isArray(data)) { setProdsError(data.error || 'Could not load products.'); return; }
          setProducts(data);
          const initUQ = {}, initSA = {}, initSAU = {};
          data.forEach(p => { initUQ[String(p.id)] = 0; initSA[String(p.id)] = 0; initSAU[String(p.id)] = 'cartons'; });
          setUpliftQty(initUQ); setStockAfter(initSA); setStockAfterUnit(initSAU);
        })
        .catch(() => setProdsError('Network error loading products.'))
        .finally(() => setLoadingProds(false));
    });
  };
  // Competitor presence — multi-select; empty array = none selected
  const [competitorSelected, setCompetitorSelected] = useState([]); // array of selected brand names
  const [competitorOther, setCompetitorOther] = useState('');
  const [competitorOptions, setCompetitorOptions] = useState([]);
  const [competitorLoading, setCompetitorLoading] = useState(false);
  const [competitorError, setCompetitorError] = useState('');

  

  const receiptInputRef = useRef(null);
  const pendingShopIdRef = useRef(null);
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptPreview, setReceiptPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitDone, setSubmitDone] = useState(false);

  // Storage settings — receipt max size (loaded once on mount)
  const [receiptMaxBytes, setReceiptMaxBytes] = useState(5242880); // 5 MB default

  useEffect(() => {
    async function load() {
      // Serve from module-level cache — avoids refetch every time user switches to Uplift tab
      if (_upliftMetaCache.data && (Date.now() - _upliftMetaCache.ts) < UPLIFT_META_CACHE_TTL) {
        const d = _upliftMetaCache.data;
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

        _upliftMetaCache.data = metaData;
        _upliftMetaCache.ts   = Date.now();
        setRegion({ id: metaData.region_id, name: metaData.region_name });
        setSubregions(metaData.subregions ?? []);
        setCompetitorOptions((metaData.competitor_products ?? []).map(x => x.name));

        // Fetch storage settings (receipt max size) — non-blocking
        try {
          const ssRes = await fetch('/api/sales/storage-settings', { headers: { Authorization: `Bearer ${tok}` } });
          if (ssRes.ok) {
            const ssData = await ssRes.json();
            if (ssData.receipt?.maxSizeBytes) setReceiptMaxBytes(ssData.receipt.maxSizeBytes);
          }
        } catch { /* use defaults silently */ }
      } catch {
        setMetaError('Network error. Please try again.');
      } finally {
        setLoadingMeta(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (!subregionId) { setShops([]); setShopId(''); setShopSearch(''); return; }
    async function loadShops() {
      // Check module-level cache first (survives tab switches)
      const cacheKey = String(subregionId);
      const cached = _upliftShopsCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < UPLIFT_SHOPS_CACHE_TTL) {
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
        const res = await fetch(`/api/sales/shops?subregion_id=${subregionId}`, { headers: { Authorization: `Bearer ${tok}` } });
        const data = await res.json();
        const loaded = res.ok ? data : [];
        // Populate module-level cache
        _upliftShopsCache.set(cacheKey, { shops: loaded, ts: Date.now() });
        setShops(loaded);
        if (pendingShopIdRef.current) {
          const target = String(pendingShopIdRef.current);
          if (loaded.some(s => String(s.id) === target)) {
            setShopId(target);
            const found = loaded.find(s => String(s.id) === target);
            try { validateSelectedShopUplift(found); } catch (e) { console.log('validateSelectedShopUplift error', e); }
          }
          pendingShopIdRef.current = null;
        }
      } catch { setShops([]); }
      finally { setLoadingShops(false); }
    }
    loadShops();
  }, [subregionId]);

  useEffect(() => {
    if (shopMode !== 'new') return;
    if (newShopLat != null) return;
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
  }, [shopMode]);

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
      pendingShopIdRef.current = match.id;
      setSubregionId(targetSubId);
    } else {
      setShopId(String(match.id));
      try { validateSelectedShopUplift(match); } catch (e) { console.log('validateSelectedShopUplift error', e); }
    }
  };

  useEffect(() => {
    if (shopMode !== 'new') { setDupMatches([]); return; }
    const name = newShopName.trim();
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
  }, [newShopName, newShopLat, newShopLng, shopMode]);

  const validateSelectedShopUplift = (shop) => {
    try {
      setStep1Error('');
      if (!shop || shop.latitude == null || shop.longitude == null) return;
      const shopLat = Number(shop.latitude), shopLon = Number(shop.longitude);
      if (!isFinite(shopLat) || !isFinite(shopLon)) { setStep1Error('Selected shop has invalid coordinates. Please choose another shop.'); return; }
      if (currentLat != null && currentLng != null) {
        const dist = haversineMeters(currentLat, currentLng, shopLat, shopLon);
        setSelectedShopDistance(dist);
        console.log('UpliftTab.validateSelectedShopUplift: reused coords -> distance (m)', dist);
        if (!isFinite(dist) || dist > 150) setStep1Error('You are too far from the selected shop. Please move closer (within 150 meters) or select another shop.');
        else setStep1Error('');
        return;
      }
      console.log('UpliftTab.validateSelectedShopUplift: requesting geolocation', { shopLat, shopLon });
      (async () => {
        try {
          const pos = await getAccuratePosition({ timeout: 10000 });
          setCurrentLat(pos.latitude); setCurrentLng(pos.longitude);
          console.log('UpliftTab.validateSelectedShopUplift: got coords', pos);
          const dist = haversineMeters(pos.latitude, pos.longitude, shopLat, shopLon);
          setSelectedShopDistance(dist);
          console.log('UpliftTab.validateSelectedShopUplift: distance (m)', dist);
          if (!isFinite(dist) || dist > 150) setStep1Error('You are too far from the selected shop. Please move closer (within 150 meters) or select another shop.');
          else setStep1Error('');
        } catch (err) {
          console.log('UpliftTab.validateSelectedShopUplift: geolocation error', err);
          if (err?.code === 1) setStep1Error('Location permission denied. Allow location access to confirm your presence at the selected shop.');
          else if (err?.code === 3) setStep1Error('Location request timed out. Try again or ensure GPS is available.');
          else if (err?.code === 2) setStep1Error('Location unavailable. Ensure device GPS is working.');
          else setStep1Error('Could not get GPS location — please enable location services to confirm you are at the selected shop.');
        }
      })();
    } catch (e) { console.log('UpliftTab.validateSelectedShopUplift: unexpected', e); }
  };

  const handleStep1Continue = () => {
    console.log('UpliftTab.handleStep1Continue: start', { shopMode, shopId });
    if (step1Error) return;
    if (!subregionId) { setStep1Error('Please select a sub-region.'); return; }
    if (shopMode === 'existing' && !shopId) { setStep1Error('Please select a shop.'); return; }
    if (shopMode === 'new' && !newShopName.trim()) { setStep1Error('Please enter the new shop name.'); return; }
    if (shopMode === 'new' && dupMatches.length > 0 && !dupDismissed) {
      setStep1Error('A potential duplicate shop was found nearby. Please Auto-select it, or click "Proceed anyway" if you are certain this is a different shop.');
      return;
    }
    if (shopMode === 'new' && nearbyShops.length > 0 && !nearbyConfirmNew) {
      setStep1Error('Nearby shops were found close to the location you captured. Review the suggestions, or click "Proceed and register new shop anyway".');
      return;
    }

    if (shopMode === 'existing') {
      try {
        const selected = shops.find(s => String(s.id) === String(shopId));
        if (selected && selected.latitude != null && selected.longitude != null) {
          const shopLat = Number(selected.latitude), shopLon = Number(selected.longitude);
          if (!isFinite(shopLat) || !isFinite(shopLon)) {
            setStep1Error('Selected shop has invalid coordinates. Please choose another shop.');
            return;
          }
          const doValidate = (lat, lon) => {
            const dist = haversineMeters(lat, lon, shopLat, shopLon);
            console.log('UpliftTab: distance (m)', dist);
            if (!isFinite(dist) || dist > 150) {
              setStep1Error('You are too far from the selected shop. Please move closer (within 150 meters) or select another shop.');
              return;
            }
            setStep(2);
          };
          const handleGpsError = (err) => {
            console.log('UpliftTab: geolocation error', err);
            if (err?.code === 1) setStep1Error('Location permission denied. Allow location access to confirm your presence at the selected shop.');
            else if (err?.code === 3) setStep1Error('Location request timed out. Try again or ensure GPS is available.');
            else if (err?.code === 2) setStep1Error('Location unavailable. Ensure device GPS is working.');
            else setStep1Error('Could not get GPS location — please enable location services to confirm you are at the selected shop.');
          };
          // Reuse already-captured GPS to avoid a second geolocation prompt
          if (currentLat != null && currentLng != null) {
            doValidate(currentLat, currentLng);
          } else {
            getAccuratePosition({ timeout: 10000 })
              .then(pos => { setCurrentLat(pos.latitude); setCurrentLng(pos.longitude); doValidate(pos.latitude, pos.longitude); })
              .catch(handleGpsError);
          }
          return;
        }
      } catch (e) {}
    }

    if (products.length === 0 && !loadingProds) {
      fetchProducts();
    }
    setStep(2);
  };

  const adjustUpliftQty = (id, delta) => setUpliftQty(prev => ({ ...prev, [String(id)]: Math.max(0, (prev[String(id)] || 0) + delta) }));
  const updateUpliftQty = (id, val) => setUpliftQty(prev => ({ ...prev, [String(id)]: clamp0(val) }));
  const adjustStockAfter = (id, delta) => setStockAfter(prev => ({ ...prev, [String(id)]: Math.max(0, (prev[String(id)] || 0) + delta) }));
  const updateStockAfter = (id, val) => setStockAfter(prev => ({ ...prev, [String(id)]: clamp0(val) }));
  const toggleStockAfterUnit = (id) => setStockAfterUnit(prev => ({ ...prev, [String(id)]: prev[String(id)] === 'pcs' ? 'cartons' : 'pcs' }));

  const handleStep2Continue = () => {
    setStep2Error('');
    const totalUplifted = products.reduce((s, p) => s + (upliftQty[String(p.id)] || 0), 0);
    if (totalUplifted === 0) { setStep2Error('Enter the number of cartons uplifted for at least one SKU.'); return; }
    setStep(3);
  };

  const handleReceiptChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Client-side size check
    if (file.size > receiptMaxBytes) {
      const maxMB = (receiptMaxBytes / 1048576).toFixed(1);
      setSubmitError(`Receipt is too large. Maximum allowed size is ${maxMB} MB. Please use a smaller file.`);
      e.target.value = '';
      return;
    }
    setSubmitError('');
    setReceiptFile(file);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = ev => setReceiptPreview(ev.target.result);
      reader.readAsDataURL(file);
    } else {
      setReceiptPreview(null);
    }
  };

  const shopLabel = shopMode === 'existing' ? shops.find(s => String(s.id) === shopId)?.name || '' : newShopName.trim();
  const subregionLabel = subregions.find(s => String(s.id) === subregionId)?.name || '';

  const handleSubmit = async () => {
    if (!receiptFile) { setSubmitError('Please attach the receipt or delivery note.'); return; }
    setSubmitError(''); setSubmitting(true);
    try {
      let latitude = null, longitude = null;
      if (currentLat != null && currentLng != null) {
        latitude = currentLat; longitude = currentLng;
      } else {
        try {
          const pos = await getAccuratePosition({ timeout: 10000 });
          latitude = pos.latitude; longitude = pos.longitude;
        } catch {}
      }

      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token;
      if (!tok) { setSubmitError('Session expired. Please sign in again.'); setSubmitting(false); return; }

      let resolvedShopId = shopMode === 'existing' ? Number(shopId) : null;
      if (shopMode === 'new') {
        const shopRes = await fetch('/api/sales/shops', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ name: newShopName.trim(), location: newShopLoc.trim() || null, subregion_id: Number(subregionId), latitude: newShopLat, longitude: newShopLng }) });
        const shopData = await shopRes.json();
        if (!shopRes.ok) { setSubmitError(shopRes.status === 409 ? `Duplicate shop blocked: ${shopData.error}` : shopData.error || 'Failed to register shop.'); setSubmitting(false); return; }
        resolvedShopId = shopData.id;
        // Invalidate cached shop list so the new shop appears on next subregion load
        _upliftShopsCache.delete(String(subregionId));
      }

      const receiptBase64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = ev => resolve(ev.target.result); reader.onerror = reject; reader.readAsDataURL(receiptFile); });

      const body = {
        shop_id:           resolvedShopId,
        subregion_id:      Number(subregionId),
        region_id:         region?.id,
        latitude,
        longitude,
        uplift_qty:        upliftQty,
        stock_after:       stockAfter,
        stock_after_unit:  stockAfterUnit,
        receipt_base64:    receiptBase64,
        products,
        // Competitor presence — array of selected brands (null if none)
        competitor_presence: (() => {
          if (competitorSelected.length === 0) return null;
          const arr = competitorSelected.filter(x => x !== 'other').concat(
            competitorSelected.includes('other') && competitorOther.trim() ? [competitorOther.trim()] : []
          );
          return arr.length > 0 ? arr : null;
        })(),
      };

      const _upliftBody = JSON.stringify(body);
      let res;
      for (let _attempt = 0; _attempt < 3; _attempt++) {
        try {
          res = await fetch('/api/sales/uplifts', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: _upliftBody });
          break;
        } catch (_netErr) {
          if (_attempt === 2) throw _netErr;
          await new Promise(r => setTimeout(r, 1200 * (_attempt + 1)));
        }
      }
      const data = await res.json();
      if (!res.ok) { setSubmitError(data.error || 'Submission failed. Please try again.'); setSubmitting(false); return; }

      setSubmitDone(true);
    } catch { setSubmitError('Network error. Please check your connection and try again.'); } finally { setSubmitting(false); }
  };

  if (submitDone) {
    return (
      <div className={styles.card} style={{ textAlign: 'center', padding: '48px 24px' }}>
        <div style={{ fontSize: '3rem', marginBottom: 16 }}>✅</div>
        <h2 style={{ color: '#065f46', marginBottom: 8 }}>Uplift Submitted!</h2>
        <p style={{ color: '#64748b', marginBottom: 24 }}>Your uplift request has been recorded and is pending admin approval.</p>
        <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => onNavigate('dashboard')}>← Back to Dashboard</button>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Request Uplift ⬆️</h1>
        <p className={styles.pageSubtitle}>Buy SKUs to add to your stock balance (used during Sale Visit).</p>
      </div>

      {/* Step progress */}
      <div className={styles.card}>
        <div className={styles.cardBody} style={{ paddingBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            {['Select Shop', 'Uplift & Stock', 'Receipt & Submit'].map((s, i) => (
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

      {/* ── Step 1 — Sub-region & Shop ── */}
      {step === 1 && (
        <div className={styles.card}>
          <div className={styles.cardHeader}><span className={styles.cardTitle}>Step 1 — Select Sub-region & Shop</span></div>
          <div className={styles.cardBody}>

            {/* Assigned region — read-only */}
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

            {/* Sub-region dropdown */}
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

            {/* Shop section */}
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
                          {nearbyChecking && nearbyShops.length === 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, background: 'linear-gradient(135deg, #f0f9ff, #e0f2fe)', border: '1px solid #bae6fd', marginBottom: 8 }}>
                              <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2.5px solid #bae6fd', borderTopColor: '#0284c7', animation: 'sprintSpin 0.7s linear infinite', flexShrink: 0 }} />
                              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0369a1' }}>Finding shops near you…</span>
                            </div>
                          )}
                          {nearbyShops.length > 0 && (
                            <div style={{ marginTop: 8, marginBottom: 8 }}>
                              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>Shops near you</div>
                              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
                                {nearbyShops.map(ns => {
                                  const dist = ns.distance_m != null
                                    ? Math.round(ns.distance_m)
                                    : (currentLat != null && currentLng != null && ns.latitude != null && ns.longitude != null)
                                      ? Math.round(haversineMeters(currentLat, currentLng, Number(ns.latitude), Number(ns.longitude)))
                                      : null;
                                  const isSel = String(ns.id) === String(shopId);
                                  return (
                                    <div key={ns.id} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', padding: '8px 12px', borderRadius: 10, minWidth: 160, marginRight: 8, background: isSel ? '#fefce8' : '#fff', border: isSel ? '1.5px solid #fde68a' : '1px solid #e2e8f0' }}>
                                      <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.88rem', marginBottom: 6 }}>{ns.name}</div>
                                      {dist != null && (
                                        <div style={{ fontSize: '0.72rem', color: dist <= 150 ? '#065f46' : '#b45309', marginBottom: 8 }}>
                                          {dist <= 150 ? '✅' : '⚠️'} {dist < 1000 ? `${dist}m` : `${(dist / 1000).toFixed(1)}km`}
                                        </div>
                                      )}
                                      <div style={{ marginTop: 'auto' }}>
                                        <button
                                          onClick={() => {
                                            setShopId(String(ns.id));
                                            setShopSearch('');
                                            setNearbyWarning('');
                                            try { if (dist != null) setSelectedShopDistance(dist); } catch (e) { setSelectedShopDistance(null); }
                                            validateSelectedShopUplift(ns);
                                          }}
                                          className={`${styles.btn} ${isSel ? styles.btnPrimary : styles.btnOutline}`}
                                          style={{ fontSize: '0.78rem', padding: '6px 10px' }}
                                          disabled={isSel}
                                        >{isSel ? 'Selected' : 'Select'}</button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

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
                          {nearbyChecking && (
                            <div style={{ marginTop: 8, fontSize: '0.75rem', color: '#94a3b8' }}>Checking for nearby shops…</div>
                          )}
                          {nearbyWarning && (
                            <div className={styles.alertWarning} style={{ marginTop: 8 }}>{nearbyWarning}</div>
                          )}
                          {!nearbyChecking && nearbyShops.length === 0 && !selected && (
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

                      <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                        <label className={styles.formLabel}>Location / Landmark</label>
                        <input
                          className={styles.formControl}
                          placeholder="E.g Guraya/VOK/Old town"
                          maxLength={30}
                          value={newShopLoc}
                          onChange={e => setNewShopLoc(e.target.value)}
                        />
                      </div>

                      {/* GPS status — auto-captured; shown as a passive read-only pill */}
                      <div style={{ marginTop: 4 }}>
                        {locCapturing && (
                          <div style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span>
                            Getting GPS location… (duplicate check will run once ready)
                          </div>
                        )}
                        {!locCapturing && newShopLat != null && (
                          <div style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            background: '#f0fdf4', border: '1px solid #bbf7d0',
                            borderRadius: 20, padding: '4px 12px',
                            fontSize: '0.7rem', color: '#065f46', fontWeight: 600,
                          }}>
                            📍 Location captured
                          </div>
                        )}
                        {!locCapturing && newShopLat == null && locError && (
                          <div style={{ fontSize: '0.75rem', color: '#ef4444' }}>
                            ⚠️ {locError}
                          </div>
                        )}
                      </div>

                        {/* Shop suggestions near captured new-shop location */}
                        {newShopLat != null && nearbyShops.length > 0 && (
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
                                    {nearbyShops.map(ns => {
                                      const dist = ns.distance_m != null
                                        ? Math.round(ns.distance_m)
                                        : (ns.latitude != null && ns.longitude != null)
                                          ? Math.round(haversineMeters(newShopLat, newShopLng, Number(ns.latitude), Number(ns.longitude)))
                                          : null;
                                      return (
                                        <div key={ns.id} style={{ minWidth: 190, border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                                          <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.88rem' }}>{ns.name}</div>
                                          {dist != null && (
                                            <div style={{ fontSize: '0.72rem', color: dist <= 150 ? '#065f46' : '#b45309', fontWeight: 600 }}>
                                              {dist <= 150 ? '✅' : '⚠️'} {dist < 1000 ? `${dist}m` : `${(dist / 1000).toFixed(1)}km`}
                                            </div>
                                          )}
                                          <button
                                            className={`${styles.btn} ${styles.btnPrimary}`}
                                            style={{ fontSize: '0.78rem', padding: '6px 10px', marginTop: 4 }}
                                            onClick={() => handleAutoSelectShop(ns)}
                                          >✓ Use this shop</button>
                                        </div>
                                      );
                                    })}
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
                disabled={loadingMeta || !!metaError || !!step1Error || (shopMode === 'new' && locCapturing)}
              >
                {shopMode === 'new' && locCapturing
                  ? <span style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span> Getting location…</span>
                  : 'Continue →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 2 — Uplift Quantities & Stock After Uplift ── */}
      {step === 2 && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>Step 2 — Uplift Quantities & Stock After</span>
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
              <div className={styles.alertWarning}>
                No active products found. Contact your administrator to add SKUs.
                <button
                  onClick={fetchProducts}
                  style={{ marginLeft: 12, padding: '2px 12px', border: 'none', borderRadius: 6, background: '#92400e', color: '#fff', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}
                >
                  ↺ Retry
                </button>
              </div>
            )}

            {!loadingProds && products.length > 0 && (
              <>
                {/* ── Cartons uplifted per SKU ── */}
                <div style={{
                  background: '#fffbeb', border: '1.5px solid #fde68a',
                  borderRadius: 12, padding: '16px', marginBottom: 20,
                }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#92400e', marginBottom: 14 }}>
                    ⬆️ Cartons Uplifted from Shop
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#78350f', marginBottom: 14, lineHeight: 1.5 }}>
                    Enter how many cartons of each SKU you are collecting back from this shop.
                  </div>

                  {products.map((p, idx) => {
                    const k      = String(p.id);
                    const isLast = idx === products.length - 1;
                    return (
                      <div key={p.id} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 12, flexWrap: 'wrap',
                        borderBottom: isLast ? 'none' : '1px solid #fde68a',
                        paddingBottom: isLast ? 0 : 12,
                        marginBottom:  isLast ? 0 : 12,
                      }}>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.9rem' }}>{p.name}</span>
                          <span style={{
                            marginLeft: 8, fontSize: '0.68rem', fontWeight: 700,
                            background: '#fde68a', color: '#92400e',
                            padding: '1px 7px', borderRadius: 5,
                          }}>{p.sku}</span>
                        </div>
                        <div className={styles.qtyControl}>
                          <button className={styles.qtyBtn} onClick={() => adjustUpliftQty(p.id, -1)}>−</button>
                          <input
                            className={styles.qtyInput}
                            value={upliftQty[k] ?? 0}
                            onChange={e => updateUpliftQty(p.id, e.target.value)}
                          />
                          <button className={styles.qtyBtn} onClick={() => adjustUpliftQty(p.id, 1)}>+</button>
                        </div>
                        <span style={{ fontSize: '0.75rem', color: '#d97706', minWidth: 48, textAlign: 'right' }}>cartons</span>
                      </div>
                    );
                  })}
                </div>

                {/* ── Stock remaining at shop AFTER uplift ── */}
                <div style={{
                  background: '#fafafa', border: '2px solid #e2e8f0',
                  borderRadius: 12, padding: '16px', marginBottom: 4,
                }}>
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#1e293b', marginBottom: 3 }}>
                      📦 Shop's Stock After Uplift
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', lineHeight: 1.5 }}>
                      How many units of each SKU are <strong>still left at this shop</strong> after you have collected the uplift?
                      Stock reduces — enter what remains. Select <strong>Cartons</strong> or <strong>Pcs</strong> per SKU.
                    </div>
                  </div>

                  {products.map((p, idx) => {
                    const k    = String(p.id);
                    const unit = stockAfterUnit[k] || 'cartons';
                    const isLast = idx === products.length - 1;
                    return (
                      <div key={p.id} style={{
                        borderBottom: isLast ? 'none' : '1px solid #e9eef5',
                        paddingBottom: isLast ? 0 : 14,
                        marginBottom:  isLast ? 0 : 14,
                      }}>
                        {/* SKU label + unit toggle */}
                        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                          <span style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.9rem' }}>{p.name}</span>
                          <span style={{
                            fontSize: '0.68rem', fontWeight: 700,
                            background: '#e2e8f0', color: '#475569',
                            padding: '1px 7px', borderRadius: 5,
                          }}>{p.sku}</span>

                          <div style={{
                            marginLeft: 'auto',
                            display: 'flex', borderRadius: 8, overflow: 'hidden',
                            border: '1.5px solid #e2e8f0',
                          }}>
                            {['cartons', 'pcs'].map(u => (
                              <button
                                key={u}
                                onClick={() => toggleStockAfterUnit(p.id)}
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

                        {/* Qty control */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div className={styles.qtyControl} style={{ flex: 1 }}>
                            <button className={styles.qtyBtn} onClick={() => adjustStockAfter(p.id, -1)}>−</button>
                            <input
                              className={styles.qtyInput}
                              style={{ flex: 1 }}
                              value={stockAfter[k] ?? 0}
                              onChange={e => updateStockAfter(p.id, e.target.value)}
                            />
                            <button className={styles.qtyBtn} onClick={() => adjustStockAfter(p.id, 1)}>+</button>
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

      {/* ── Step 3 — Receipt & Submit ── */}
      {step === 3 && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>Step 3 — Receipt & Submit</span>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
              {subregionLabel} › {shopLabel}
            </span>
          </div>
          <div className={styles.cardBody}>

            {/* Receipt upload */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                Receipt / Delivery Note <span style={{ color: '#ef4444' }}>*</span>
              </label>

              <input
                ref={receiptInputRef}
                type="file"
                accept="image/*,application/pdf"
                style={{ display: 'none' }}
                onChange={handleReceiptChange}
              />

              {receiptFile ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  {receiptPreview ? (
                    <img
                      src={receiptPreview}
                      alt="Receipt preview"
                      style={{
                        width: '100%', maxWidth: 400,
                        borderRadius: 12, border: '2px solid #bbf7d0',
                        objectFit: 'contain',
                      }}
                    />
                  ) : (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      background: '#f0fdf4', border: '1.5px solid #bbf7d0',
                      borderRadius: 10, padding: '14px 18px', width: '100%',
                    }}>
                      <span style={{ fontSize: '1.5rem' }}>📄</span>
                      <span style={{ fontSize: '0.85rem', color: '#065f46', fontWeight: 600, wordBreak: 'break-all' }}>
                        {receiptFile.name}
                      </span>
                    </div>
                  )}
                  <button
                    className={`${styles.btn} ${styles.btnOutline}`}
                    onClick={() => { setReceiptFile(null); setReceiptPreview(null); receiptInputRef.current?.click(); }}
                  >↺ Replace</button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => receiptInputRef.current?.click()}
                  className={styles.cameraBox}
                  style={{ minHeight: 120, cursor: 'pointer', width: '100%' }}
                >
                  <span className={styles.cameraIcon}>🧾</span>
                  <span className={styles.cameraLabel}>Tap to upload receipt</span>
                  <span className={styles.cameraSub}>Photo or file (JPG, PNG, PDF)</span>
                </button>
              )}
            </div>

            {/* Uplift summary */}
            <div style={{
              background: '#f8fafc', border: '1.5px solid #e2e8f0',
              borderRadius: 10, padding: '12px 16px', marginBottom: 16,
            }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151', marginBottom: 8 }}>Uplift Summary</div>
              {products.filter(p => (upliftQty[String(p.id)] || 0) > 0).map(p => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: 4 }}>
                  <span style={{ color: '#1e293b' }}>{p.name} <span style={{ color: '#94a3b8', fontSize: '0.7rem' }}>({p.sku})</span></span>
                  <span style={{ fontWeight: 700, color: '#d97706' }}>−{upliftQty[String(p.id)]} cartons</span>
                </div>
              ))}
              {products.every(p => (upliftQty[String(p.id)] || 0) === 0) && (
                <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>No items entered.</div>
              )}
            </div>

            {submitError && (
              <div className={styles.alertDanger} style={{ marginBottom: 12 }}>{submitError}</div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button className={`${styles.btn} ${styles.btnOutline}`} onClick={() => setStep(2)}>← Back</button>
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                style={{ flex: 1 }}
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? 'Submitting…' : 'Submit Uplift ⬆️'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
