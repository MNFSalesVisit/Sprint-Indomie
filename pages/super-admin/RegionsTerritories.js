import React, { useEffect, useState, useCallback } from 'react';
import styles from '../../styles/superadmin.module.css';

// Rotating palette for region colour accents
const PALETTE = [
  '#7c3aed', '#2563eb', '#059669', '#d97706',
  '#dc2626', '#db2777', '#0891b2', '#65a30d',
  '#9333ea', '#ea580c',
];
const regionColor = (id) => PALETTE[(id - 1) % PALETTE.length];

// ── Tiny icon component ───────────────────────────────────────────────────────
function RegionIcon({ color }) {
  return (
    <div
      style={{
        width: 34, height: 34, borderRadius: 10,
        background: `${color}18`,
        border: `2px solid ${color}40`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1rem', flexShrink: 0,
      }}
    >
      🗺️
    </div>
  );
}

export default function RegionsTerritories({ token }) {
  const [regions,        setRegions]        = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [subregions,     setSubregions]     = useState([]);
  const [subLoading,     setSubLoading]     = useState(false);
  const [regionSearch,   setRegionSearch]   = useState('');

  // Shared add/rename modal
  const [modal,       setModal]       = useState(null); // { type, target? }
  const [modalValue,  setModalValue]  = useState('');
  const [modalErr,    setModalErr]    = useState('');
  const [modalSaving, setModalSaving] = useState(false);

  // Delete confirm
  const [delConfirm, setDelConfirm] = useState(null); // { type, target, subCount? }
  const [deleting,   setDeleting]   = useState(false);

  // Toast
  const [toast, setToast] = useState(null);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const h = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  const safeJson = async (res) => {
    const text = await res.text();
    try { return JSON.parse(text); }
    catch { return { error: `Server error (HTTP ${res.status})` }; }
  };

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Data loaders ─────────────────────────────────────────────────────────────
  const loadRegions = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/regions', { headers: h() });
    const data = await safeJson(res);
    setRegions(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [h]);  // eslint-disable-line react-hooks/exhaustive-deps

  const loadSubregions = useCallback(async (regionId) => {
    setSubLoading(true);
    const res = await fetch(`/api/admin/regions/${regionId}/subregions`, { headers: h() });
    const data = await safeJson(res);
    setSubregions(Array.isArray(data) ? data : []);
    setSubLoading(false);
  }, [h]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadRegions(); }, [loadRegions]);

  const selectRegion = (r) => {
    setSelectedRegion(r);
    loadSubregions(r.id);
  };

  // ── Modal ────────────────────────────────────────────────────────────────────
  const MODAL_META = {
    addRegion:    { title: 'Create New Region',    label: 'Region name',    placeholder: '' },
    renameRegion: { title: 'Rename Region',        label: 'New name',       placeholder: '' },
    addSub:       { title: 'Add Subregion',        label: 'Subregion name', placeholder: '' },
    renameSub:    { title: 'Rename Subregion',     label: 'New name',       placeholder: '' },
  };

  const openModal = (type, target = null) => {
    setModal({ type, target });
    setModalValue(target?.name || '');
    setModalErr('');
    setModalSaving(false);
  };

  const handleModalSave = async () => {
    const v = modalValue.trim();
    if (!v) { setModalErr('Name cannot be empty'); return; }
    setModalSaving(true);
    setModalErr('');

    const routeMap = {
      addRegion:    () => ({ url: '/api/admin/regions',                                          method: 'POST' }),
      renameRegion: () => ({ url: `/api/admin/regions/${modal.target?.id}`,                      method: 'PUT'  }),
      addSub:       () => ({ url: `/api/admin/regions/${selectedRegion?.id}/subregions`,          method: 'POST' }),
      renameSub:    () => ({ url: `/api/admin/subregions/${modal.target?.id}`,                   method: 'PUT'  }),
    };

    const { url, method } = routeMap[modal.type]();
    const res = await fetch(url, {
      method, headers: h(), body: JSON.stringify({ name: v }),
    });
    const data = await safeJson(res);
    setModalSaving(false);

    if (!res.ok) { setModalErr(data.error || 'Something went wrong'); return; }

    setModal(null);

    const isRegionOp = modal.type === 'addRegion' || modal.type === 'renameRegion';
    await loadRegions();
    if (!isRegionOp && selectedRegion) await loadSubregions(selectedRegion.id);

    // Auto-select a newly created region so the subregion panel opens immediately
    if (modal.type === 'addRegion') {
      const newRegion = { id: data.id, name: v, subregion_count: 0 };
      setSelectedRegion(newRegion);
      await loadSubregions(newRegion.id);
    }

    // Keep selected region name in sync after rename
    if (modal.type === 'renameRegion' && selectedRegion?.id === modal.target.id) {
      setSelectedRegion(prev => ({ ...prev, name: v }));
    }

    const messages = {
      addRegion:    `Region "${v}" created`,
      renameRegion: `Region renamed to "${v}"`,
      addSub:       `Subregion "${v}" added to ${selectedRegion?.name}`,
      renameSub:    `Subregion renamed to "${v}"`,
    };
    showToast(messages[modal.type]);
  };

  // ── Delete ───────────────────────────────────────────────────────────────────
  const openDelete = (type, target) => {
    const subCount = type === 'region' ? (target.subregion_count || 0) : 0;
    setDelConfirm({ type, target, subCount });
    setDeleting(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    const { type, target } = delConfirm;
    const url = type === 'region'
      ? `/api/admin/regions/${target.id}`
      : `/api/admin/subregions/${target.id}`;

    const res = await fetch(url, { method: 'DELETE', headers: h() });
    setDeleting(false);
    setDelConfirm(null);

    if (!res.ok) {
      const d = await safeJson(res);
      showToast(d.error || 'Delete failed', 'error');
      return;
    }

    await loadRegions();
    if (type === 'region') {
      if (selectedRegion?.id === target.id) { setSelectedRegion(null); setSubregions([]); }
      showToast(`Region "${target.name}" deleted`);
    } else {
      if (selectedRegion) await loadSubregions(selectedRegion.id);
      showToast(`Subregion "${target.name}" deleted`);
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────────
  const filteredRegions = regions.filter(r =>
    r.name.toLowerCase().includes(regionSearch.toLowerCase())
  );
  const totalSubregions = regions.reduce((a, r) => a + (r.subregion_count || 0), 0);
  const mm = modal ? (MODAL_META[modal.type] || {}) : {};

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Page header */}
      <div className={styles.uaHeader} style={{ marginBottom: 16 }}>
        <div>
          <h2 className={styles.tabHeading} style={{ marginBottom: 4 }}>Regions & Territories</h2>
          <p className={styles.tabSubtitle}>Organise your country into regions and sub-regions</p>
        </div>
        <button className={styles.btnPrimary} onClick={() => openModal('addRegion')}>
          + Add Region
        </button>
      </div>

      {/* Stats */}
      <div className={styles.statsGrid} style={{ marginBottom: 20 }}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Total Regions</div>
          <div className={styles.statValue} style={{ color: 'var(--sa-primary, #7c3aed)' }}>{loading ? '…' : regions.length}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Total Subregions</div>
          <div className={styles.statValue} style={{ color: '#059669' }}>{loading ? '…' : totalSubregions}</div>
        </div>
      </div>

      {/* Two-pane layout */}
      <div className={styles.regLayout}>

        {/* ── Left: Regions list ── */}
        <div className={styles.regPanel}>
          <div className={styles.regPanelHeader}>
            <span className={styles.regPanelTitle}>All Regions</span>
            <span className={styles.regPanelCount}>{filteredRegions.length}</span>
          </div>

          <div className={styles.regSearch}>
            <input
              className={styles.filterInput}
              style={{ width: '100%', margin: 0 }}
              placeholder="Search regions…"
              value={regionSearch}
              onChange={e => setRegionSearch(e.target.value)}
            />
          </div>

          <div className={styles.regionList}>
            {loading ? (
              <div className={styles.regEmptyState}>
                <div className={styles.regSpinner} />
                <span>Loading regions…</span>
              </div>
            ) : filteredRegions.length === 0 ? (
              <div className={styles.regEmptyState}>
                <span style={{ fontSize: '2rem' }}>🗺️</span>
                <span>{regions.length === 0
                  ? 'No regions yet.\nClick "+ Add Region" to create one.'
                  : 'No regions match your search.'
                }</span>
              </div>
            ) : (
              filteredRegions.map(r => {
                const color = regionColor(r.id);
                const isSelected = selectedRegion?.id === r.id;
                return (
                  <div
                    key={r.id}
                    className={`${styles.regionCard} ${isSelected ? styles.regionCardSelected : ''}`}
                    onClick={() => selectRegion(r)}
                  >
                    <div className={styles.regionAccentBar} style={{ background: color }} />
                    <RegionIcon color={color} />
                    <div className={styles.regionCardBody}>
                      <div className={styles.regionName}>{r.name}</div>
                      <div className={styles.regionSubCount}>
                        <span className={styles.regionSubBadge} style={{ background: `${color}18`, color }}>
                          {r.subregion_count || 0}
                        </span>
                        subregion{r.subregion_count !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <div className={styles.regionActions} onClick={e => e.stopPropagation()}>
                      <button
                        className={styles.actionBtn}
                        title="Add subregion"
                        onClick={() => { setSelectedRegion(r); loadSubregions(r.id); openModal('addSub'); }}
                      >➕</button>
                      <button
                        className={styles.actionBtn}
                        title="Rename region"
                        onClick={() => openModal('renameRegion', r)}
                      >✏️</button>
                      <button
                        className={`${styles.actionBtn} ${styles.actionBtnWarn}`}
                        title="Delete region"
                        onClick={() => openDelete('region', r)}
                      >🗑️</button>
                    </div>
                    {isSelected && <div className={styles.regionSelectedChevron}>›</div>}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Right: Subregions ── */}
        <div className={styles.regPanelRight}>
          {!selectedRegion ? (
            <div className={styles.regSelectPrompt}>
              <div style={{ fontSize: '4rem', marginBottom: 12, opacity: 0.4 }}>🗺️</div>
              <h3 style={{ color: '#374151', fontWeight: 600, marginBottom: 8 }}>Select a Region</h3>
              <p style={{ color: '#94a3b8', maxWidth: 300, margin: 0, fontSize: '0.9rem', textAlign: 'center' }}>
                Choose a region from the left panel to view and manage its subregions
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* Right panel header */}
              <div className={styles.regPanelHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: regionColor(selectedRegion.id), flexShrink: 0,
                    }}
                  />
                  <span className={styles.regPanelTitle}>{selectedRegion.name}</span>
                  <span className={styles.regBreadcrumbSep}>›</span>
                  <span style={{ fontSize: '0.875rem', color: '#64748b' }}>Subregions</span>
                  <span className={styles.regPanelCount}>{subregions.length}</span>
                </div>
                <button
                  className={styles.btnPrimary}
                  style={{ fontSize: '0.8rem', padding: '7px 16px' }}
                  onClick={() => openModal('addSub')}
                >
                  + Add Subregion
                </button>
              </div>

              {/* Subregion list */}
              <div className={styles.subList}>
                {subLoading ? (
                  <div className={styles.regEmptyState}>
                    <div className={styles.regSpinner} />
                    <span>Loading subregions…</span>
                  </div>
                ) : subregions.length === 0 ? (
                  <div className={styles.regEmptyState}>
                    <span style={{ fontSize: '2rem' }}>📍</span>
                    <span>No subregions in {selectedRegion.name} yet.<br />Click "+ Add Subregion" to get started.</span>
                  </div>
                ) : (
                  subregions.map((s, idx) => (
                    <div key={s.id} className={styles.subItem}>
                      <div
                        className={styles.subItemNumber}
                        style={{ background: `${regionColor(selectedRegion.id)}18`, color: regionColor(selectedRegion.id) }}
                      >
                        {idx + 1}
                      </div>
                      <div className={styles.subItemName}>{s.name}</div>
                      <div className={styles.regionActions}>
                        <button
                          className={styles.actionBtn}
                          title="Rename subregion"
                          onClick={() => openModal('renameSub', s)}
                        >✏️</button>
                        <button
                          className={`${styles.actionBtn} ${styles.actionBtnWarn}`}
                          title="Delete subregion"
                          onClick={() => openDelete('subregion', s)}
                        >🗑️</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Add / Rename Modal ───────────────────────────────────────────────── */}
      {modal && (
        <div className={styles.overlay} onClick={() => !modalSaving && setModal(null)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <div className={styles.panelHeader} style={{ borderRadius: '16px 16px 0 0' }}>
              <div>
                <h3 className={styles.panelTitle}>{mm.title}</h3>
                {(modal.type === 'addSub' || modal.type === 'renameSub') && selectedRegion && (
                  <p className={styles.panelSub}>in {selectedRegion.name}</p>
                )}
              </div>
              <button className={styles.closeBtn} onClick={() => setModal(null)} disabled={modalSaving}>✕</button>
            </div>

            <div className={styles.panelBody} style={{ padding: 24 }}>
              {modalErr && <div className={styles.formError}>{modalErr}</div>}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>{mm.label}</label>
                <input
                  className="form-control"
                  placeholder={mm.placeholder}
                  value={modalValue}
                  onChange={e => setModalValue(e.target.value)}
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter' && !modalSaving) handleModalSave(); }}
                />
                {modal.type === 'addRegion' && null}
              </div>
            </div>

            <div className={styles.panelFooter}>
              <button className={styles.btnSecondary} onClick={() => setModal(null)} disabled={modalSaving}>Cancel</button>
              <button className={styles.btnPrimary} onClick={handleModalSave} disabled={modalSaving}>
                {modalSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Dialog ────────────────────────────────────────────── */}
      {delConfirm && (
        <div className={styles.overlay} onClick={() => !deleting && setDelConfirm(null)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <div className={styles.panelHeader} style={{ borderRadius: '16px 16px 0 0' }}>
              <h3 className={styles.panelTitle} style={{ color: '#dc2626' }}>
                Delete {delConfirm.type === 'region' ? 'Region' : 'Subregion'}
              </h3>
              <button className={styles.closeBtn} onClick={() => setDelConfirm(null)} disabled={deleting}>✕</button>
            </div>

            <div className={styles.panelBody} style={{ padding: 24 }}>
              <div className={styles.deleteConfirmBox}>
                <span style={{ fontSize: '2.5rem' }}>⚠️</span>
                <div>
                  <p style={{ margin: 0, color: '#374151', fontSize: '0.95rem' }}>
                    Are you sure you want to delete <strong>&quot;{delConfirm.target.name}&quot;</strong>?
                  </p>
                  {delConfirm.type === 'region' && delConfirm.subCount > 0 && (
                    <p style={{ margin: '10px 0 0', color: '#dc2626', fontSize: '0.875rem', fontWeight: 600 }}>
                      ⚠️ This will also permanently delete {delConfirm.subCount} subregion{delConfirm.subCount !== 1 ? 's' : ''}.
                    </p>
                  )}
                  <p style={{ margin: '8px 0 0', color: '#94a3b8', fontSize: '0.8rem' }}>
                    This action cannot be undone.
                  </p>
                </div>
              </div>
            </div>

            <div className={styles.panelFooter}>
              <button className={styles.btnSecondary} onClick={() => setDelConfirm(null)} disabled={deleting}>Cancel</button>
              <button className={styles.btnDanger} onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ─────────────────────────────────────────────────────────────── */}
      {toast && (
        <div className={`${styles.toast} ${toast.type === 'error' ? styles.toastError : styles.toastSuccess}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
