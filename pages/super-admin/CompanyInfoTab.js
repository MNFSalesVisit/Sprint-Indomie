import React from 'react';
import styles from '../../styles/superadmin.module.css';

function InfoRow({ icon, label, value, href }) {
  const display = value || '—';
  return (
    <div className={styles.infoRow}>
      <span className={styles.infoRowIcon}>{icon}</span>
      <div className={styles.infoRowBody}>
        <div className={styles.infoRowLabel}>{label}</div>
        {href && value
          ? <a href={href} className={styles.infoRowValue} target="_blank" rel="noopener noreferrer">{display}</a>
          : <div className={styles.infoRowValue}>{display}</div>
        }
      </div>
    </div>
  );
}

export default function CompanyInfoTab({ cfg = {}, onEditClick }) {
  const primary     = cfg.theme_color  || '#7c3aed';
  const accent      = cfg.accent_color || '#06b6d4';
  const logoSrc     = cfg.company_logo  || null;
  const companyName = cfg.company_name  || '';
  const systemName  = cfg.system_name   || 'Sales Visit System';

  const initial = (companyName || systemName || 'C')[0].toUpperCase();

  return (
    <div className={styles.infoRoot}>

      {/* ── Hero Banner ── */}
      <div
        className={styles.infoBanner}
        style={{ background: `linear-gradient(135deg, ${primary} 0%, ${accent} 100%)` }}
      >
        <div className={styles.infoBannerInner}>
          <div className={styles.infoBannerLogo}>
            {logoSrc
              ? <img src={logoSrc} alt="Company logo" className={styles.infoBannerLogoImg} />
              : <span className={styles.infoBannerLogoInitial}>{initial}</span>
            }
          </div>
          <div className={styles.infoBannerText}>
            <div className={styles.infoBannerCompanyName}>
              {companyName || 'Company Name Not Set'}
            </div>
            <div className={styles.infoBannerSystemName}>{systemName}</div>
          </div>
        </div>
        <div className={styles.infoBannerActions}>
          <div className={styles.infoBannerBadge}>● Active</div>
          {onEditClick && (
            <button className={styles.infoBannerEditBtn} onClick={onEditClick} type="button">
              ⚙️ Edit Config
            </button>
          )}
        </div>
      </div>

      {/* ── Cards ── */}
      <div className={styles.infoCards}>

        {/* Contact Details */}
        <div className={styles.infoCard}>
          <div className={styles.infoCardHeader}>
            <div className={styles.infoCardIconWrap} style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}>
              📧
            </div>
            <div className={styles.infoCardTitle}>Contact Details</div>
          </div>
          <div className={styles.infoRows}>
            <InfoRow
              icon="✉️"
              label="Email Address"
              value={cfg.contact_email}
              href={cfg.contact_email ? `mailto:${cfg.contact_email}` : null}
            />
            <InfoRow
              icon="📞"
              label="Phone Number"
              value={cfg.contact_phone}
              href={cfg.contact_phone ? `tel:${cfg.contact_phone}` : null}
            />
          </div>
        </div>

        {/* Business Address */}
        <div className={styles.infoCard}>
          <div className={styles.infoCardHeader}>
            <div className={styles.infoCardIconWrap} style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}>
              📍
            </div>
            <div className={styles.infoCardTitle}>Business Address</div>
          </div>
          <div className={styles.infoAddressBody}>
            {cfg.business_address
              ? <pre className={styles.infoAddress}>{cfg.business_address}</pre>
              : <span className={styles.infoEmpty}>No address configured</span>
            }
          </div>
        </div>

        {/* System Branding */}
        <div className={styles.infoCard}>
          <div className={styles.infoCardHeader}>
            <div className={styles.infoCardIconWrap} style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}>
              🎨
            </div>
            <div className={styles.infoCardTitle}>System Branding</div>
          </div>
          <div className={styles.infoRows}>
            <InfoRow icon="🏷️" label="System Name" value={systemName} />
          </div>
          <div className={styles.infoPalette}>
            <div className={styles.infoPaletteItem}>
              <div className={styles.infoPaletteDot} style={{ background: primary }} />
              <div>
                <div className={styles.infoPaletteLabel}>Primary</div>
                <code className={styles.infoPaletteHex}>{primary}</code>
              </div>
            </div>
            <div className={styles.infoPaletteItem}>
              <div className={styles.infoPaletteDot} style={{ background: accent }} />
              <div>
                <div className={styles.infoPaletteLabel}>Accent</div>
                <code className={styles.infoPaletteHex}>{accent}</code>
              </div>
            </div>
          </div>
          <div
            className={styles.infoPaletteBar}
            style={{ background: `linear-gradient(90deg, ${primary}, ${accent})` }}
          />
        </div>

      </div>
    </div>
  );
}
