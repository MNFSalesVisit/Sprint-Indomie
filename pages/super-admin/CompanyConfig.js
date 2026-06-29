import React, { useEffect, useState, useRef } from 'react';
import styles from '../../styles/superadmin.module.css';
import { useBranding } from '../../lib/brandingContext';
import CustomConfigurations from './CustomConfigurations';

const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
const MAX_LOGO_BYTES = 1.5 * 1024 * 1024; // 1.5 MB

const DEFAULT_CONFIG = {
  company_name: '',
  company_logo: '',
  contact_email: '',
  contact_phone: '',
  business_address: '',
  system_name: 'Sales Visit System',
  theme_color: '#7c3aed',
  accent_color: '#06b6d4',
};

const SETUP_SQL = `-- Run this in Supabase Dashboard → SQL Editor
create table if not exists system_config (
  key         text primary key,
  value       text not null default '',
  updated_at  timestamptz not null default now()
);

insert into system_config (key, value) values
  ('company_name',     ''),
  ('company_logo',     ''),
  ('contact_email',    ''),
  ('contact_phone',    ''),
  ('business_address', ''),
  ('system_name',      'Sales Visit System'),
  ('theme_color',      '#7c3aed'),
  ('accent_color',     '#06b6d4')
on conflict (key) do nothing;`;

export default function CompanyConfig({ token, onConfigSave }) {
  const { mergeBranding } = useBranding();
  const [cfg,            setCfg]            = useState(DEFAULT_CONFIG);
  const [loading,        setLoading]        = useState(true);
  const [setupRequired,  setSetupRequired]  = useState(false);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [savingBranding, setSavingBranding] = useState(false);
  const [toast,          setToast]          = useState(null);
  const [sqlCopied,      setSqlCopied]      = useState(false);
  const [activeSubTab,   setActiveSubTab]   = useState('branding');
  const fileRef = useRef(null);

  const authHdr = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Load ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res  = await fetch('/api/admin/config', { headers: authHdr() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load config');
        if (data.setup_required) {
          setSetupRequired(true);
        }
        const { setup_required: _, ...rest } = data;
        setCfg({ ...DEFAULT_CONFIG, ...rest });
      } catch (e) {
        showToast(e.message, 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function saveKeys(keys, setSaving) {
    setSaving(true);
    try {
      const payload = {};
      for (const k of keys) payload[k] = cfg[k] ?? '';
      const res  = await fetch('/api/admin/config', {
        method: 'POST',
        headers: authHdr(),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.status === 503 || data.error === 'setup_required') {
        setSetupRequired(true);
        showToast('Run the setup SQL first — see the banner above.', 'error');
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Save failed');
      showToast('Saved successfully!');
      // Update global branding context so all pages reflect changes immediately
      mergeBranding(cfg);
      onConfigSave?.(cfg);
      // Update localStorage cache so next page load has no flash
      try {
        const cached = JSON.parse(localStorage.getItem('sprint_branding') || '{}');
        localStorage.setItem('sprint_branding', JSON.stringify({ ...cached, ...cfg }));
      } catch { /* ignore */ }
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  function copySql() {
    navigator.clipboard.writeText(SETUP_SQL).then(() => {
      setSqlCopied(true);
      setTimeout(() => setSqlCopied(false), 2500);
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const set = (key, value) => setCfg(c => ({ ...c, [key]: value }));

  function handleLogoFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      showToast('Unsupported file type. Use PNG, JPG, SVG or WebP.', 'error');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      showToast('Logo must be under 1.5 MB', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => set('company_logo', ev.target.result);
    reader.readAsDataURL(file);
    // reset so the same file can be re-selected after removal
    e.target.value = '';
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={styles.cfgLoading}>
        <div className={styles.regSpinner} />
        <span>Loading configuration…</span>
      </div>
    );
  }

  const logoSrc = cfg.company_logo || null;

  return (
    <div className={styles.cfgRoot}>

      {/* ── Toast ── */}
      {toast && (
        <div className={`${styles.toast} ${toast.type === 'error' ? styles.toastError : styles.toastSuccess}`}>
          {toast.type === 'success' ? '✓ ' : '✗ '}{toast.msg}
        </div>
      )}

      {/* ── Setup required banner ── */}
      {setupRequired && (
        <div className={styles.cfgSetupBanner}>
          <div className={styles.cfgSetupBannerHeader}>
            <span className={styles.cfgSetupBannerIcon}>⚠️</span>
            <div>
              <div className={styles.cfgSetupBannerTitle}>Database table not found</div>
              <div className={styles.cfgSetupBannerSub}>
                Run the SQL below in your&nbsp;
                <strong>Supabase Dashboard → SQL Editor</strong>,
                then refresh this page.
              </div>
            </div>
            <button
              className={styles.cfgSetupCopyBtn}
              onClick={copySql}
              type="button"
            >
              {sqlCopied ? '✓ Copied!' : '📋 Copy SQL'}
            </button>
          </div>
          <pre className={styles.cfgSetupSql}>{SETUP_SQL}</pre>
        </div>
      )}

      {/* ── Page header ── */}
      <div className={styles.cfgPageHeader}>
        <div>
          <h2 className={styles.cfgPageTitle}>Company &amp; System Configuration</h2>
          <p className={styles.cfgPageSub}>
            Manage your organisation's identity, contact details and system branding
          </p>
        </div>
      </div>

      {/* ── Sub-tab bar ── */}
      <div className={styles.brTabBar}>
        <button
          className={`${styles.brTab} ${activeSubTab === 'branding' ? styles.brTabActive : ''}`}
          onClick={() => setActiveSubTab('branding')}
        >
          🎨 Branding &amp; Identity
        </button>
        <button
          className={`${styles.brTab} ${activeSubTab === 'custom' ? styles.brTabActive : ''}`}
          onClick={() => setActiveSubTab('custom')}
        >
          ⚙️ Custom Configurations
        </button>
      </div>

      {/* ── Custom Configurations sub-tab ── */}
      {activeSubTab === 'custom' && (
        <CustomConfigurations token={token} />
      )}

      {/* ── Branding & Identity sub-tab ── */}
      {activeSubTab === 'branding' && (
      <div className={styles.cfgGrid}>

        {/* ════════════ CARD 1 — Company Identity ════════════ */}
        <div className={styles.cfgCard}>
          <div className={styles.cfgCardHeader}>
            <div className={styles.cfgIconBadge} style={{ background: 'linear-gradient(135deg, var(--sa-primary, #7c3aed), var(--sa-accent, #06b6d4))' }}>
              🏢
            </div>
            <div>
              <div className={styles.cfgCardTitle}>Company Identity</div>
              <div className={styles.cfgCardSub}>Name, logo and contact information</div>
            </div>
          </div>

          {/* Logo upload zone */}
          <div
            className={styles.cfgLogoZone}
            onClick={() => fileRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && fileRef.current?.click()}
            title="Click to upload a logo"
          >
            <div className={styles.cfgLogoThumb}>
              {logoSrc
                ? <img src={logoSrc} alt="Company logo" className={styles.cfgLogoImg} />
                : <span className={styles.cfgLogoPlaceholderIcon}>🏢</span>
              }
            </div>
            <div className={styles.cfgLogoMeta}>
              <div className={styles.cfgLogoTitle}>Company Logo</div>
              <div className={styles.cfgLogoHint}>PNG · JPG · SVG · WebP · max&nbsp;1.5&nbsp;MB</div>
              <div className={styles.cfgLogoBtnRow}>
                <button
                  className={styles.btnOutline}
                  onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}
                  type="button"
                >
                  {logoSrc ? '↺ Change' : '↑ Upload'}
                </button>
                {logoSrc && (
                  <button
                    className={styles.cfgRemoveBtn}
                    onClick={e => { e.stopPropagation(); set('company_logo', ''); }}
                    type="button"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            style={{ display: 'none' }}
            onChange={handleLogoFile}
          />

          {/* Fields — 2 col */}
          <div className={styles.cfgFieldGrid}>
            <div className={styles.cfgField}>
              <label className={styles.cfgLabel}>Company Name</label>
              <input
                className={styles.cfgInput}
                value={cfg.company_name}
                onChange={e => set('company_name', e.target.value)}
                placeholder="e.g. Acme Distribution Ltd."
              />
            </div>
            <div className={styles.cfgField}>
              <label className={styles.cfgLabel}>Contact Email</label>
              <input
                type="email"
                className={styles.cfgInput}
                value={cfg.contact_email}
                onChange={e => set('contact_email', e.target.value)}
                placeholder="info@company.com"
              />
            </div>
            <div className={styles.cfgField}>
              <label className={styles.cfgLabel}>Contact Phone</label>
              <input
                type="tel"
                className={styles.cfgInput}
                value={cfg.contact_phone}
                onChange={e => set('contact_phone', e.target.value)}
                placeholder="+1 555 000 0000"
              />
            </div>
          </div>

          {/* Full-width address */}
          <div className={styles.cfgField}>
            <label className={styles.cfgLabel}>Business Address</label>
            <textarea
              className={`${styles.cfgInput} ${styles.cfgTextarea}`}
              value={cfg.business_address}
              onChange={e => set('business_address', e.target.value)}
              placeholder="123 Main Street, City, Country"
              rows={3}
            />
          </div>

          <div className={styles.cfgCardFooter}>
            <button
              className={styles.btnPrimary}
              onClick={() => saveKeys(
                ['company_name', 'company_logo', 'contact_email', 'contact_phone', 'business_address'],
                setSavingIdentity
              )}
              disabled={savingIdentity}
            >
              {savingIdentity ? '…Saving' : '💾 Save Company Info'}
            </button>
          </div>
        </div>

        {/* ════════════ CARD 2 — System Branding ════════════ */}
        <div className={styles.cfgCard}>
          <div className={styles.cfgCardHeader}>
            <div className={styles.cfgIconBadge} style={{ background: 'linear-gradient(135deg,#06b6d4,#0ea5e9)' }}>
              🎨
            </div>
            <div>
              <div className={styles.cfgCardTitle}>System Branding</div>
              <div className={styles.cfgCardSub}>Application name and colour theme</div>
            </div>
          </div>

          {/* System name */}
          <div className={styles.cfgField}>
            <label className={styles.cfgLabel}>System Name</label>
            <input
              className={styles.cfgInput}
              value={cfg.system_name}
              onChange={e => set('system_name', e.target.value)}
              placeholder="Sales Visit System"
            />
            <div className={styles.cfgHintText}>Shown in the browser tab and navigation header</div>
          </div>

          {/* Colour pickers */}
          <div className={styles.cfgColorRow}>
            <div className={styles.cfgField}>
              <label className={styles.cfgLabel}>Primary / Theme Colour</label>
              <div className={styles.cfgColorControl}>
                <input
                  type="color"
                  className={styles.cfgColorSwatch}
                  value={cfg.theme_color}
                  onChange={e => set('theme_color', e.target.value)}
                  title="Pick theme colour"
                />
                <input
                  className={`${styles.cfgInput} ${styles.cfgColorHex}`}
                  value={cfg.theme_color}
                  onChange={e => set('theme_color', e.target.value)}
                  maxLength={7}
                  placeholder="#7c3aed"
                />
              </div>
            </div>
            <div className={styles.cfgField}>
              <label className={styles.cfgLabel}>Accent Colour</label>
              <div className={styles.cfgColorControl}>
                <input
                  type="color"
                  className={styles.cfgColorSwatch}
                  value={cfg.accent_color}
                  onChange={e => set('accent_color', e.target.value)}
                  title="Pick accent colour"
                />
                <input
                  className={`${styles.cfgInput} ${styles.cfgColorHex}`}
                  value={cfg.accent_color}
                  onChange={e => set('accent_color', e.target.value)}
                  maxLength={7}
                  placeholder="#06b6d4"
                />
              </div>
            </div>
          </div>

          {/* Live preview banner */}
          <div className={styles.cfgPreviewWrap}>
            <div className={styles.cfgPreviewHeading}>Live Preview</div>
            <div
              className={styles.cfgPreviewBar}
              style={{ background: `linear-gradient(135deg, ${cfg.theme_color || '#7c3aed'}, ${cfg.accent_color || '#06b6d4'})` }}
            >
              <div className={styles.cfgPreviewLeft}>
                {logoSrc && (
                  <img src={logoSrc} alt="logo" className={styles.cfgPreviewLogo} />
                )}
                {!logoSrc && (
                  <div className={styles.cfgPreviewLogoBlank} />
                )}
                <span className={styles.cfgPreviewSysName}>
                  {cfg.system_name || 'System Name'}
                </span>
              </div>
              <div className={styles.cfgPreviewRight}>
                <span
                  className={styles.cfgPreviewChip}
                  style={{ background: 'rgba(255,255,255,0.22)' }}
                >
                  Dashboard
                </span>
                <span
                  className={styles.cfgPreviewChip}
                  style={{
                    background: cfg.accent_color || '#06b6d4',
                    color: '#fff',
                  }}
                >
                  Action
                </span>
              </div>
            </div>
            <div className={styles.cfgPreviewSwatches}>
              <div className={styles.cfgPreviewSwatch}>
                <div className={styles.cfgPreviewSwatchDot} style={{ background: cfg.theme_color }} />
                <span>Primary</span>
                <code>{cfg.theme_color}</code>
              </div>
              <div className={styles.cfgPreviewSwatch}>
                <div className={styles.cfgPreviewSwatchDot} style={{ background: cfg.accent_color }} />
                <span>Accent</span>
                <code>{cfg.accent_color}</code>
              </div>
            </div>
          </div>

          <div className={styles.cfgCardFooter}>
            <button
              className={styles.btnPrimary}
              onClick={() => saveKeys(
                ['system_name', 'theme_color', 'accent_color'],
                setSavingBranding
              )}
              disabled={savingBranding}
            >
              {savingBranding ? '…Saving' : '🎨 Save Branding'}
            </button>
          </div>
        </div>

      </div>
      )} {/* end branding sub-tab */}
    </div>
  );
}
