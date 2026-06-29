import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabaseClient';
import { useBranding } from '../../lib/brandingContext';
import styles from '../../styles/superadmin.module.css';
import UserAccess from './UserAccess';
import RegionsTerritories from './RegionsTerritories';
import ProductsSKUs from './ProductsSKUs';
import CompanyConfig from './CompanyConfig';
import CompanyInfoTab from './CompanyInfoTab';
import BackupRecovery from './BackupRecovery';
import StockAdjustments from './StockAdjustments';
import AuditTrail from './AuditTrail';
import MasterData from './MasterData';
import FeatureManagement from './FeatureManagement';
import ApiUsageMonitor from './ApiUsageMonitor';
import StorageManager from './StorageManager';

const TABS = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'users', label: 'User & Access', icon: '👥' },
  { id: 'regions', label: 'Regions & Territories', icon: '🗺️' },
  { id: 'products', label: 'Products & SKUs', icon: '📦' },
  { id: 'masterdata', label: 'Master Data', icon: '🗃️' },
  { id: 'adjustments', label: 'Manual Adjustments', icon: '✏️' },
  { id: 'audit', label: 'Audit Trail', icon: '📋' },
  { id: 'company', label: 'Company & Config', icon: '🏢' },
  { id: 'info',  label: 'Company Details', icon: '📇' },
  { id: 'backup',   label: 'Backup & Recovery',   icon: '💾' },
  { id: 'features', label: 'Feature Management', icon: '🎛️' },
  { id: 'monitor',  label: 'API Usage Monitor',   icon: '📡' },
  { id: 'storage',  label: 'Storage',              icon: '🗄️' },
];

function StatCard({ label, value, color }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue} style={{ color }}>{value ?? '—'}</div>
    </div>
  );
}

function PlaceholderTab({ title, description }) {
  return (
    <div className={styles.placeholder}>
      <div className={styles.placeholderIcon}>🚧</div>
      <h3>{title}</h3>
      <p>{description}</p>
      <span className={styles.badge}>Coming soon</span>
    </div>
  );
}

export default function SuperAdminPage() {
  const router = useRouter();
  const [role,        setRole]        = useState(null);
  const [token,       setToken]       = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [stats,       setStats]       = useState(null);
  const [activeTab,   setActiveTab]   = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { branding: appCfg, mergeBranding } = useBranding();

  useEffect(() => {
    async function check() {
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token;
      if (!tok) { setRole(null); setLoading(false); return; }
      setToken(tok);
      const res = await fetch('/api/admin/check', { headers: { Authorization: `Bearer ${tok}` } });
      const body = await res.json();
      setRole(body.role || null);
      setCurrentUser({ full_name: body.full_name || null, avatar_url: body.avatar_url || null });
      if (body.role === 'Super Admin') {
        const s = await fetch('/api/admin/stats').then(r => r.json());
        setStats(s);
      }
      setLoading(false);
    }
    check();
  }, []);

  const handleConfigSave = (savedCfg) => {
    mergeBranding(savedCfg);
    // Also update CSS vars immediately for instant feedback
    const root = document.documentElement;
    if (savedCfg.theme_color)  root.style.setProperty('--sa-primary', savedCfg.theme_color);
    if (savedCfg.accent_color) root.style.setProperty('--sa-accent',  savedCfg.accent_color);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  if (loading) return <div className={styles.splash}>Verifying access…</div>;
  if (!role) return <div className={styles.splash}>Not authenticated. <a href="/login">Sign in</a></div>;
  if (role !== 'Super Admin') return <div className={styles.splash}>Access denied. Requires Super Admin.</div>;

  const renderTab = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <div>
            <h2 className={styles.tabHeading}>System Overview</h2>
            <div className={styles.statsGrid}>
              <StatCard label="Visits (MTD)" value={stats?.visitsMTD} color="var(--sa-primary, #7c3aed)" />
              <StatCard label="Active Salespersons" value={stats?.activeSales} color="#059669" />
              <StatCard label="Inactive Salespersons" value={stats?.inactiveSales} color="#dc2626" />
            </div>
            <div className={styles.card}>
              <h5 className={styles.cardTitle}>Users by Role</h5>
              <div className={styles.roleChips}>
                {stats?.totalByRole?.map(r => (
                  <div key={r.role} className={styles.roleChip}>
                    <span className={styles.roleChipName}>{r.role}</span>
                    <span className={styles.roleChipCount}>{r.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      case 'users':
        return <UserAccess token={token} />;
      case 'company':
        return <CompanyConfig token={token} onConfigSave={handleConfigSave} />;
      case 'info':
        return <CompanyInfoTab cfg={appCfg} onEditClick={() => setActiveTab('company')} />;
      case 'regions':
        return <RegionsTerritories token={token} />;
      case 'products':
        return <ProductsSKUs token={token} />;
      case 'backup':
        return <BackupRecovery token={token} />;
      case 'masterdata':
        return <MasterData token={token} />;
      case 'adjustments':
        return <StockAdjustments token={token} />;
      case 'audit':
        return <AuditTrail token={token} />;
      case 'features':
        return <FeatureManagement token={token} />;
      case 'monitor':
        return <ApiUsageMonitor token={token} />;
      case 'storage':
        return <StorageManager token={token} />;
      default:
        return null;
    }
  };

  return (
    <div className={styles.layout}>
      {/* Sidebar */}
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : styles.sidebarClosed}`}>
        <div className={styles.sidebarHeader}>
          <div className={styles.logoMark}>
            {appCfg.company_logo
              ? <img src={appCfg.company_logo} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="logo" />
              : (appCfg.company_name || appCfg.system_name || 'S')[0].toUpperCase()
            }
          </div>
          {sidebarOpen && (
            <div>
              <div className={styles.sidebarTitle}>
                {appCfg.system_name || 'Sales Visit'}
              </div>
              {appCfg.company_name && (
                <div className={styles.sidebarCompanyName}>{appCfg.company_name}</div>
              )}
            </div>
          )}
        </div>
        <nav className={styles.nav}>
          {TABS.map(t => (
            <button
              key={t.id}
              className={`${styles.navItem} ${activeTab === t.id ? styles.navItemActive : ''}`}
              onClick={() => setActiveTab(t.id)}
              title={t.label}
            >
              <span className={styles.navIcon}>{t.icon}</span>
              {sidebarOpen && <span className={styles.navLabel}>{t.label}</span>}
            </button>
          ))}
        </nav>
        <button className={styles.logoutBtn} onClick={handleLogout}>
          <span className={styles.navIcon}>🚪</span>
          {sidebarOpen && <span>Logout</span>}
        </button>
      </aside>

      {/* Main */}
      <div className={styles.main}>
        <header className={styles.topbar}>
          <button className={styles.toggleBtn} onClick={() => setSidebarOpen(o => !o)}>☰</button>
          <h1 className={styles.topbarTitle}>{TABS.find(t => t.id === activeTab)?.label}</h1>
          <div className={styles.topbarRight}>
            <div className={styles.topbarUserChip}>
              {currentUser?.avatar_url ? (
                <img src={currentUser.avatar_url} className={styles.topbarAvatar} alt="profile" />
              ) : (
                <div className={styles.topbarAvatarInitial}>
                  {(currentUser?.full_name || 'S')[0].toUpperCase()}
                </div>
              )}
              <span className={styles.topbarUserName}>{currentUser?.full_name || 'Super Admin'}</span>
            </div>
          </div>
        </header>
        <main className={styles.content}>
          {renderTab()}
        </main>
        <footer className={styles.portalCopyright}>
          Powered By Indomie
        </footer>
      </div>
    </div>
  );
}
