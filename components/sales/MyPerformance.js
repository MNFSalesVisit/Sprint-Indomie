import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

// Module-level cache: keyed by 'YYYY-M', survives tab remounts
const _perfCache       = new Map();
const PERF_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function ProgressBar({ value = 0, target = 1, color }) {
  const safeTarget = target && target > 0 ? target : null;
  const pct = safeTarget ? Math.min(100, Math.round((value / safeTarget) * 100)) : 0;

  // Color thresholds
  const getColor = (p) => {
    if (p >= 80) return '#16a34a'; // green
    if (p >= 50) return '#f59e0b'; // yellow
    return '#ef4444'; // red
  };

  const barColor = color || getColor(pct);

  const title = safeTarget ? `${value} of ${safeTarget} cartons` : `${value} cartons (no target)`;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      title={title}
      style={{ background: '#eef2ff', borderRadius: 8, overflow: 'hidden', height: 18 }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          background: `linear-gradient(90deg, ${barColor}, ${barColor})`,
          transition: 'width 700ms ease, background-color 400ms ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: pct > 10 ? 'flex-end' : 'flex-start',
          paddingRight: 8,
          color: '#fff',
          fontWeight: 700,
          fontSize: '0.78rem',
        }}
      >
        {pct}%
      </div>
    </div>
  );
}

export default function MyPerformance({ primary = '#6366f1', accent = '#06b6d4' }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchData();
  }, [year, month]);

  function fmtLocalDate(date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  async function fetchData() {
    const cacheKey = `${year}-${month}`;
    const cached = _perfCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < PERF_CACHE_TTL_MS) {
      setData(cached.data);
      setLoading(false);
      return;
    }
    setLoading(true); setError('');
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setError('Offline — performance data unavailable.');
        setLoading(false);
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token;
      if (!tok) { setError('Session expired'); setLoading(false); return; }
      const res = await fetch(`/api/sales/performance?year=${year}&month=${month}`, { headers: { Authorization: `Bearer ${tok}` } });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Failed to load performance'); setLoading(false); return; }
      _perfCache.set(cacheKey, { data: d, ts: Date.now() });
      setData(d);
    } catch (e) {
      setError('Network error');
    } finally { setLoading(false); }
  }

  const years = Array.from({ length: 3 }).map((_,i) => now.getFullYear() - i);
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // compute reference based on local current date (always use today's date when in current month)
  const nowDate = new Date();
  const isCurrentMonth = year === nowDate.getFullYear() && month === (nowDate.getMonth() + 1);
  const todayIso = fmtLocalDate(nowDate);

  // daily entry for today (always present in API response; if not, default to 0)
  const dailyData = data ? (data.daily.find(d => d.date === todayIso) || { date: todayIso, cartons: 0, target: null }) : null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.02rem' }}>My Performance</h2>
          <div style={{ color: '#64748b', fontSize: '0.85rem' }}>Daily · Monthly</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e6e9f8' }}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e6e9f8' }}>
            {monthNames.map((m, idx) => <option key={m} value={idx+1}>{m}</option>)}
          </select>
        </div>
      </div>

      {loading && <div style={{ color: '#94a3b8' }}>Loading…</div>}
      {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 8 }}>{error}</div>}

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
          {/** Render two stacked performance cards: Daily and Monthly **/}
          {[
            { key: 'daily',   title: 'Daily',   meta: dailyData,      color: primary },
            { key: 'monthly', title: 'Monthly', meta: data.monthly,  color: accent  },
          ].map(card => {
            const val = card.meta?.cartons ?? 0;
            const tgt = card.meta?.target ?? null; // may be null if no target set
            const pct = (tgt && tgt > 0) ? Math.min(100, Math.round((val / tgt) * 100)) : null;

            if (card.key === 'daily') console.log('Daily:', { actual: val, target: tgt, progress: pct });
            if (card.key === 'monthly') console.log('Monthly:', { actual: val, target: tgt, progress: pct });
            const subLabel = card.key === 'daily'
              ? (card.meta ? new Date(card.meta.date).toLocaleDateString() : '—')
              : `${monthNames[month - 1]} ${year}`;

            return (
              <div key={card.key} style={{ padding: 16, borderRadius: 12, background: '#fff', boxShadow: '0 2px 8px rgba(2,6,23,0.04)', display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>{card.title}</div>
                  <div style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: 8 }}>{subLabel}</div>
                  <div style={{ marginBottom: 8 }}>
                    <ProgressBar value={val} target={tgt} color={card.color} />
                  </div>
                  <div style={{ color: '#475569', fontSize: '0.9rem' }}>
                    {tgt ? `${val} / ${tgt} cartons` : 'No target set'}
                  </div>
                </div>
                <div style={{ width: 84, textAlign: 'center' }}>
                  <div style={{ fontSize: '1.4rem', fontWeight: 900, color: card.color }}>{pct != null ? `${pct}%` : '—'}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
