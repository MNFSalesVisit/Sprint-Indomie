import 'bootstrap/dist/css/bootstrap.min.css'
import 'leaflet/dist/leaflet.css'
import '../styles/globals.css'
import { useEffect } from 'react';
import Head from 'next/head';
import { supabase } from '../lib/supabaseClient';
import { BrandingProvider, useBranding } from '../lib/brandingContext';
import OfflineProvider from '../components/OfflineProvider';

function safeHex(v) {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(v || '').trim()) ? v.trim() : null;
}

function darkenHex(hex, factor) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
}

function BrandingInjector() {
  const { setBranding } = useBranding();

  useEffect(() => {
    function applyVars(cfg) {
      const root = document.documentElement;
      const primary = safeHex(cfg.theme_color)  || '#7c3aed';
      const accent  = safeHex(cfg.accent_color) || '#06b6d4';
      root.style.setProperty('--sa-primary', primary);
      root.style.setProperty('--sa-accent',  accent);
      root.style.setProperty('--sa-sidebar-start', darkenHex(primary, 0.28));
      root.style.setProperty('--sa-sidebar-end',   darkenHex(primary, 0.45));
    }

    // Apply cached branding instantly (before first paint) to avoid flash
    try {
      const cached = localStorage.getItem('sprint_branding');
      if (cached) {
        const parsed = JSON.parse(cached);
        setBranding(parsed);
        applyVars(parsed);
      }
    } catch { /* ignore */ }

    async function loadBranding() {
      try {
        const res  = await fetch('/api/branding');
        const data = await res.json();
        setBranding(data);
        applyVars(data);
        // Cache for next load so there is no flash on refresh
        try { localStorage.setItem('sprint_branding', JSON.stringify(data)); } catch { /* ignore */ }
      } catch { /* keep cached/defaults */ }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        loadBranding();
      } else if (session) {
        loadBranding();
      }
    });

    // Always load branding on mount — login page needs it too
    loadBranding();

    return () => subscription?.unsubscribe?.();
  }, []);

  return null;
}

export default function App({ Component, pageProps }) {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      // Register existing service worker (public/sw.js) to enable offline + install prompt
      navigator.serviceWorker.register('/sw.js').catch(() => { /* ignore failures */ });
    }
  }, []);

  return (
    <BrandingProvider>
      <OfflineProvider>
      <Head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#7c3aed" />
        <link rel="icon" href="/AppIcons/icon-192.png" />
        <link rel="apple-touch-icon" href="/AppIcons/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Sales Visit App" />
        <meta name="mobile-web-app-capable" content="yes" />
      </Head>
      <BrandingInjector />
        <Component {...pageProps} />
      </OfflineProvider>
    </BrandingProvider>
  );
}
