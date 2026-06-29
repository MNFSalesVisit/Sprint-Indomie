// Reusable accurate geolocation helper
// Returns: { latitude, longitude, accuracy, readings: [{latitude,longitude,accuracy,timestamp}], source }
export async function getAccuratePosition(opts = {}) {
  const {
    timeout = 7000,          // hard overall timeout (ms)
    desiredAccuracy = 20,    // meters — accept readings <= this
    minSamples = 1,          // optional early-exit when >= this many good samples
    maxSamples = 20,         // safety cap
  } = opts || {};

  if (!('geolocation' in navigator)) {
    const err = new Error('Geolocation not supported'); err.code = 0; throw err;
  }

  return new Promise((resolve, reject) => {
    const readings = [];
    let best = null;
    let settled = false;

    const onSuccess = (pos) => {
      try {
        const r = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : Infinity,
          timestamp: pos.timestamp || Date.now(),
        };
        readings.push(r);
        if (!best || r.accuracy < best.accuracy) best = r;

        // If we have enough good samples, resolve early
        const good = readings.filter(x => Number.isFinite(x.accuracy) && x.accuracy <= desiredAccuracy);
        if (good.length >= Math.max(1, minSamples)) {
          finish('average', good);
        }

        // Safety: cap total stored readings
        if (readings.length > maxSamples) readings.shift();
      } catch (e) { /* ignore individual read errors */ }
    };

    const onError = (err) => {
      // If permission denied or permanent error, stop immediately
      if (err && err.code === 1) {
        cleanup();
        const e = new Error('Permission denied'); e.code = 1; reject(e); return;
      }
      // Otherwise keep trying until timeout
    };

    const geoOpts = { enableHighAccuracy: true, maximumAge: 0 };
    let watchId = null;

    const finish = (source, items) => {
      if (settled) return; settled = true;
      cleanup();
      if (source === 'average' && items && items.length > 0) {
        const lat = items.reduce((s, it) => s + it.latitude, 0) / items.length;
        const lon = items.reduce((s, it) => s + it.longitude, 0) / items.length;
        const acc = Math.round(items.reduce((s, it) => s + it.accuracy, 0) / items.length);
        resolve({ latitude: lat, longitude: lon, accuracy: acc, readings: readings.slice(), source: 'average' });
        return;
      }
      // fallback: if we collected any readings pick best (lowest accuracy)
      if (best) {
        resolve({ latitude: best.latitude, longitude: best.longitude, accuracy: best.accuracy, readings: readings.slice(), source: 'best' });
        return;
      }
      const e = new Error('Could not determine position'); e.code = 2; reject(e);
    };

    const cleanup = () => {
      if (watchId != null && navigator.geolocation.clearWatch) navigator.geolocation.clearWatch(watchId);
      if (timeoutId) clearTimeout(timeoutId);
    };

    // Start overall timeout
    const timeoutId = setTimeout(() => {
      // time's up — accept good readings if any, else best
      const good = readings.filter(x => Number.isFinite(x.accuracy) && x.accuracy <= desiredAccuracy);
      if (good.length > 0) finish('average', good);
      else finish('best');
    }, timeout);

    try {
      watchId = navigator.geolocation.watchPosition(onSuccess, onError, geoOpts);
      // Also seed with a single immediate getCurrentPosition to prompt quicker permission flow
      navigator.geolocation.getCurrentPosition(onSuccess, onError, { ...geoOpts, timeout: Math.min(2000, timeout) });
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}
