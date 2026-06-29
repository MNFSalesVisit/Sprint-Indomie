import React, { useEffect, useState, useCallback } from 'react';
import styles from '../../styles/superadmin.module.css';

// Deterministic colour per product id
const PALETTE = [
  '#7c3aed','#2563eb','#059669','#d97706',
  '#dc2626','#db2777','#0891b2','#65a30d',
  '#9333ea','#ea580c',
];
const productColor = (id) => PALETTE[(id - 1) % PALETTE.length];

function blankForm() {
  return { sku: '', name: '', is_active: true };
}

export default function ProductsSKUs({ token }) {
  const [products,   setProducts]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [activeSubTab, setActiveSubTab] = useState('products');

  // Panel (add / edit)
  const [panelOpen,  setPanelOpen]  = useState(false);
  const [editItem,   setEditItem]   = useState(null);
  const [form,       setForm]       = useState(blankForm());
  const [saving,     setSaving]     = useState(false);
  const [formErr,    setFormErr]    = useState('');

  // Delete confirm
  const [delTarget,  setDelTarget]  = useState(null);
  const [deleting,   setDeleting]   = useState(false);

  // Toast
  const [toast, setToast] = useState(null);

  // Competitor products per region
  const [regions, setRegions] = useState([]);
  const [selectedRegionId, setSelectedRegionId] = useState('');
  const [compProducts, setCompProducts] = useState([]);
  const [compLoading, setCompLoading] = useState(false);
  const [compPanelOpen, setCompPanelOpen] = useState(false);
  const [compForm, setCompForm] = useState({ name: '', note: '' });
  const [compEditItem, setCompEditItem] = useState(null);
  const [compSaving, setCompSaving] = useState(false);
  const [compErr, setCompErr] = useState('');
  const [compSearch, setCompSearch] = useState('');
  const [compDelTarget, setCompDelTarget] = useState(null);
  const [compDeleting, setCompDeleting] = useState(false);

  // ── helpers ────────────────────────────────────────────────────────────────
  const h = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  async function safeJson(res) {
    const text = await res.text();
    try { return JSON.parse(text); }
    catch { return { error: `Server error (HTTP ${res.status})` }; }
  }

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── data ───────────────────────────────────────────────────────────────────
  const loadProducts = useCallback(async () => {
    setLoading(true);
    const res  = await fetch('/api/admin/products', { headers: h() });
    const data = await safeJson(res);
    setProducts(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [h]);

  // Regions and competitor-products
  const loadRegions = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/map-regions', { headers: h() });
      const d = await safeJson(res);
      if (Array.isArray(d)) setRegions(d);
    } catch (e) {
      // ignore
    }
  }, [h]);

  const loadCompProducts = useCallback(async (regionId) => {
    if (!regionId) { setCompProducts([]); return; }
    setCompLoading(true);
    const res = await fetch(`/api/admin/competitor-products?region_id=${regionId}`, { headers: h() });
    const d = await safeJson(res);
    setCompProducts(Array.isArray(d) ? d : []);
    setCompLoading(false);
  }, [h]);

  useEffect(() => { loadProducts(); }, [loadProducts]);
  useEffect(() => { loadRegions(); }, [loadRegions]);

  // ── panel ──────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditItem(null);
    setForm(blankForm());
    setFormErr('');
    setPanelOpen(true);
  };

  const openCompPanel = () => {
    setCompEditItem(null);
    setCompForm({ name: '', note: '' });
    setCompErr('');
    loadRegions();
    setCompPanelOpen(true);
  };

  const openEdit = (p) => {
    setEditItem(p);
    setForm({ sku: p.sku, name: p.name, is_active: p.is_active });
    setFormErr('');
    setPanelOpen(true);
  };

  const handleSave = async () => {
    const trimSku  = form.sku.trim();
    const trimName = form.name.trim();
    if (!trimSku)  { setFormErr('SKU is required');          return; }
    if (!trimName) { setFormErr('Product name is required'); return; }
    setSaving(true);
    setFormErr('');

    const url    = editItem ? `/api/admin/products/${editItem.id}` : '/api/admin/products';
    const method = editItem ? 'PUT' : 'POST';
    const res    = await fetch(url, { method, headers: h(), body: JSON.stringify(form) });
    const body   = await safeJson(res);
    setSaving(false);

    if (!res.ok) { setFormErr(body.error || 'Failed to save'); return; }
    setPanelOpen(false);
    showToast(editItem ? `"${trimName}" updated` : `"${trimName}" added`);
    loadProducts();
  };

  // ── quick toggle ───────────────────────────────────────────────────────────
  const handleToggle = async (p) => {
    setProducts(prev => prev.map(x => x.id === p.id ? { ...x, is_active: !p.is_active } : x));
    const res = await fetch(`/api/admin/products/${p.id}`, {
      method: 'PUT', headers: h(),
      body: JSON.stringify({ sku: p.sku, name: p.name, is_active: !p.is_active }),
    });
    if (res.ok) {
      showToast(`"${p.name}" ${!p.is_active ? 'enabled' : 'disabled'}`);
    } else {
      setProducts(prev => prev.map(x => x.id === p.id ? { ...x, is_active: p.is_active } : x));
      showToast('Failed to update status', 'error');
    }
  };

  // ── move product up / down ─────────────────────────────────────────────────
  const handleMove = async (index, direction) => {
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= products.length) return;
    const a = products[index];
    const b = products[swapIndex];
    const updated = [...products];
    updated[index]     = { ...a, sort_order: b.sort_order };
    updated[swapIndex] = { ...b, sort_order: a.sort_order };
    updated.sort((x, y) => x.sort_order - y.sort_order || x.id - y.id);
    setProducts(updated);
    await Promise.all([
      fetch(`/api/admin/products/${a.id}`, { method: 'PUT', headers: h(), body: JSON.stringify({ sku: a.sku, name: a.name, is_active: a.is_active, sort_order: b.sort_order }) }),
      fetch(`/api/admin/products/${b.id}`, { method: 'PUT', headers: h(), body: JSON.stringify({ sku: b.sku, name: b.name, is_active: b.is_active, sort_order: a.sort_order }) }),
    ]);
  };

  // ── delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    setDeleting(true);
    const res = await fetch(`/api/admin/products/${delTarget.id}`, {
      method: 'DELETE', headers: h(),
    });
    setDeleting(false);
    setDelTarget(null);
    if (!res.ok) {
      const d = await safeJson(res);
      showToast(d.error || 'Delete failed', 'error');
    } else {
      showToast(`"${delTarget.name}" deleted`);
      loadProducts();
    }
  };

  // ── competitor products handlers ─────────────────────────────────────
  const openCompCreate = () => {
    setCompEditItem(null);
    setCompForm({ name: '', note: '' });
    setCompErr('');
  };

  const openCompEdit = (item) => {
    setCompEditItem(item);
    setCompForm({ name: item.name, note: item.note || '' });
    setCompErr('');
    setCompPanelOpen(true);
  };

  const handleCompSave = async () => {
    if (!selectedRegionId) { setCompErr('Select a region'); return; }
    if (!compForm.name.trim()) { setCompErr('Name is required'); return; }
    setCompSaving(true);
    setCompErr('');
    try {
      const url = compEditItem ? `/api/admin/competitor-products/${compEditItem.id}` : '/api/admin/competitor-products';
      const method = compEditItem ? 'PUT' : 'POST';
      const body = compEditItem ? { name: compForm.name.trim(), note: compForm.note } : { region_id: Number(selectedRegionId), name: compForm.name.trim(), note: compForm.note };
      const res = await fetch(url, { method, headers: h(), body: JSON.stringify(body) });
      const d = await safeJson(res);
      if (!res.ok) { setCompErr(d.error || 'Save failed'); setCompSaving(false); return; }
      showToast(compEditItem ? `"${compForm.name.trim()}" updated` : `"${compForm.name.trim()}" added`);
      setCompPanelOpen(false);
      await loadCompProducts(selectedRegionId);
      setCompForm({ name: '', note: '' });
      setCompEditItem(null);
      setCompSaving(false);
    } catch (e) { setCompErr('Network error'); setCompSaving(false); }
  };

  const handleCompDelete = async () => {
    setCompDeleting(true);
    const res = await fetch(`/api/admin/competitor-products/${compDelTarget.id}`, { method: 'DELETE', headers: h() });
    setCompDeleting(false);
    if (res.ok) {
      showToast(`"${compDelTarget.name}" deleted`);
      await loadCompProducts(selectedRegionId);
    } else {
      showToast('Delete failed', 'error');
    }
    setCompDelTarget(null);
  };

  const handleCompToggle = async (item) => {
    setCompProducts(prev => prev.map(x => x.id === item.id ? { ...x, is_active: !item.is_active } : x));
    const res = await fetch(`/api/admin/competitor-products/${item.id}`, {
      method: 'PUT', headers: h(),
      body: JSON.stringify({ name: item.name, note: item.note || null, is_active: !item.is_active }),
    });
    if (res.ok) {
      showToast(`"${item.name}" ${!item.is_active ? 'enabled' : 'disabled'}`);
    } else {
      setCompProducts(prev => prev.map(x => x.id === item.id ? { ...x, is_active: item.is_active } : x));
      showToast('Failed to update status', 'error');
    }
  };

  const handleCompMove = async (index, direction) => {
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= compProducts.length) return;
    const a = compProducts[index];
    const b = compProducts[swapIndex];
    const updated = [...compProducts];
    updated[index]     = { ...a, sort_order: b.sort_order };
    updated[swapIndex] = { ...b, sort_order: a.sort_order };
    updated.sort((x, y) => x.sort_order - y.sort_order || x.id - y.id);
    setCompProducts(updated);
    await Promise.all([
      fetch(`/api/admin/competitor-products/${a.id}`, { method: 'PUT', headers: h(), body: JSON.stringify({ name: a.name, sort_order: b.sort_order }) }),
      fetch(`/api/admin/competitor-products/${b.id}`, { method: 'PUT', headers: h(), body: JSON.stringify({ name: b.name, sort_order: a.sort_order }) }),
    ]);
  };

  // ── derived ────────────────────────────────────────────────────────────────
  const filtered = products.filter(p => {
    const q = search.toLowerCase();
    if (q && !p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
    if (filterStatus === 'active'   && !p.is_active) return false;
    if (filterStatus === 'inactive' &&  p.is_active) return false;
    return true;
  });

  const totalActive   = products.filter(p =>  p.is_active).length;
  const totalInactive = products.filter(p => !p.is_active).length;

  const filteredComp = compProducts.filter(c =>
    !compSearch || c.name.toLowerCase().includes(compSearch.toLowerCase())
  );

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className={styles.uaHeader} style={{ marginBottom: 16 }}>
        <div>
          <h2 className={styles.tabHeading} style={{ marginBottom: 4 }}>Products & SKUs</h2>
          <p className={styles.tabSubtitle}>Manage your product catalogue and competitor brands</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {activeSubTab === 'products' && (
            <button className={styles.btnPrimary} onClick={openCreate}>+ Add Product</button>
          )}
          {activeSubTab === 'competitor' && (
            <button className={styles.btnPrimary} onClick={openCompPanel}>+ Add Competitor</button>
          )}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className={styles.brTabBar}>
        <button
          className={`${styles.brTab} ${activeSubTab === 'products' ? styles.brTabActive : ''}`}
          onClick={() => setActiveSubTab('products')}
        >📦 My Products</button>
        <button
          className={`${styles.brTab} ${activeSubTab === 'competitor' ? styles.brTabActive : ''}`}
          onClick={() => setActiveSubTab('competitor')}
        >🏷️ Competitor Products</button>
      </div>

      {/* ── Products Tab ──────────────────────────────────────────────────── */}
      {activeSubTab === 'products' && (
        <>
          {/* Stats */}
          <div className={styles.statsGrid} style={{ marginBottom: 20 }}>
            {[
              { label: 'Total Products', value: loading ? '…' : products.length, color: 'var(--sa-primary, #7c3aed)' },
              { label: 'Active',         value: loading ? '…' : totalActive,     color: '#059669' },
              { label: 'Inactive',       value: loading ? '…' : totalInactive,   color: '#dc2626' },
            ].map(s => (
              <div key={s.label} className={styles.statCard}>
                <div className={styles.statLabel}>{s.label}</div>
                <div className={styles.statValue} style={{ color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className={styles.filterBar}>
            <input
              className={styles.filterInput}
              placeholder="Search by name or SKU…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select
              className={styles.filterSelect}
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          {/* Product grid */}
          {loading ? (
            <div className={styles.pkgEmptyState}>
              <div className={styles.regSpinner} />
              <span>Loading products…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className={styles.pkgEmptyState}>
              <span style={{ fontSize: '3rem' }}>📦</span>
              <span style={{ color: '#94a3b8', fontSize: '0.95rem' }}>
                {products.length === 0
                  ? 'No products yet. Click "+ Add Product" to get started.'
                  : 'No products match your search.'}
              </span>
            </div>
          ) : (
            <div className={styles.pkgGrid}>
              {filtered.map(p => {
                const color = productColor(p.id);
                const idx = products.findIndex(x => x.id === p.id);
                return (
                  <div key={p.id} className={`${styles.pkgCard} ${!p.is_active ? styles.pkgCardInactive : ''}`}>
                    {/* Colour accent stripe */}
                    <div className={styles.pkgStripe} style={{ background: color }} />

                    <div className={styles.pkgCardBody}>
                      {/* SKU badge */}
                      <div className={styles.pkgSkuRow}>
                        <span className={styles.pkgSkuBadge} style={{ background: `${color}18`, color }}>
                          {p.sku}
                        </span>
                        {/* Active / inactive dot */}
                        <span className={p.is_active ? styles.pkgDotActive : styles.pkgDotInactive}
                              title={p.is_active ? 'Active' : 'Inactive'} />
                      </div>

                      {/* Product name */}
                      <div className={styles.pkgName}>{p.name}</div>
                    </div>

                    {/* Action footer */}
                    <div className={styles.pkgFooter}>
                      <div className={styles.toggleRow}>
                        <span style={{ fontSize: '0.8rem', color: p.is_active ? '#059669' : '#94a3b8' }}>
                          {p.is_active ? 'Active' : 'Inactive'}
                        </span>
                        <button
                          type="button"
                          title={p.is_active ? 'Click to disable' : 'Click to enable'}
                          onClick={() => handleToggle(p)}
                          style={{
                            position: 'relative', width: 44, height: 24, borderRadius: 12,
                            border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0,
                            background: p.is_active ? '#16a34a' : '#cbd5e1',
                            transition: 'background 0.2s',
                          }}
                        >
                          <span style={{
                            position: 'absolute', top: 3,
                            left: p.is_active ? 23 : 3,
                            width: 18, height: 18, borderRadius: '50%',
                            background: '#fff', transition: 'left 0.2s', display: 'block',
                          }} />
                        </button>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <button className={styles.pkgIconBtn} title="Move up"   disabled={idx <= 0}                    onClick={() => handleMove(idx, -1)} style={{ fontSize: '0.65rem', padding: '2px 6px' }}>▲</button>
                          <button className={styles.pkgIconBtn} title="Move down" disabled={idx >= products.length - 1} onClick={() => handleMove(idx,  1)} style={{ fontSize: '0.65rem', padding: '2px 6px' }}>▼</button>
                        </div>
                        <button
                          className={styles.pkgIconBtn}
                          title="Edit product"
                          onClick={() => openEdit(p)}
                        >✏️</button>
                        <button
                          className={`${styles.pkgIconBtn} ${styles.pkgIconBtnRed}`}
                          title="Delete product"
                          onClick={() => setDelTarget(p)}
                        >🗑️</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Competitor Products Tab ──────────────────────────────────────── */}
      {activeSubTab === 'competitor' && (
        <>
          {/* Region + search bar */}
          <div className={styles.filterBar} style={{ marginBottom: 16 }}>
            <select
              className={styles.filterSelect}
              style={{ flex: '0 0 220px' }}
              value={selectedRegionId}
              onChange={e => { setSelectedRegionId(e.target.value); loadCompProducts(e.target.value); }}
            >
              <option value="">Select region…</option>
              {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <input
              className={styles.filterInput}
              placeholder="Search competitor products…"
              value={compSearch}
              onChange={e => setCompSearch(e.target.value)}
            />
          </div>

          {/* Stats (only when region selected) */}
          {selectedRegionId && (
            <div className={styles.statsGrid} style={{ marginBottom: 20 }}>
              {[
                { label: 'Total',    value: compLoading ? '…' : compProducts.length,                        color: 'var(--sa-primary, #7c3aed)' },
                { label: 'Active',   value: compLoading ? '…' : compProducts.filter(x => x.is_active).length,  color: '#059669' },
                { label: 'Inactive', value: compLoading ? '…' : compProducts.filter(x => !x.is_active).length, color: '#dc2626' },
              ].map(s => (
                <div key={s.label} className={styles.statCard}>
                  <div className={styles.statLabel}>{s.label}</div>
                  <div className={styles.statValue} style={{ color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Competitor grid */}
          {compLoading ? (
            <div className={styles.pkgEmptyState}>
              <div className={styles.regSpinner} />
              <span>Loading…</span>
            </div>
          ) : !selectedRegionId ? (
            <div className={styles.pkgEmptyState}>
              <span style={{ fontSize: '3rem' }}>🏷️</span>
              <span style={{ color: '#94a3b8', fontSize: '0.95rem' }}>Select a region to view competitor products.</span>
            </div>
          ) : filteredComp.length === 0 ? (
            <div className={styles.pkgEmptyState}>
              <span style={{ fontSize: '3rem' }}>🏷️</span>
              <span style={{ color: '#94a3b8', fontSize: '0.95rem' }}>
                {compProducts.length === 0
                  ? 'No competitor products for this region. Click "+ Add Competitor" to add one.'
                  : 'No results match your search.'}
              </span>
            </div>
          ) : (
            <div className={styles.pkgGrid}>
              {filteredComp.map(item => {
                const idx = compProducts.findIndex(x => x.id === item.id);
                return (
                <div key={item.id} className={`${styles.pkgCard} ${!item.is_active ? styles.pkgCardInactive : ''}`}>
                  <div className={styles.pkgCardBody}>
                    <div className={styles.pkgSkuRow}>
                      <span style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.95rem' }}>{item.name}</span>
                      <span className={item.is_active ? styles.pkgDotActive : styles.pkgDotInactive}
                            title={item.is_active ? 'Active' : 'Inactive'} />
                    </div>
                    {item.note && <div style={{ color: '#64748b', fontSize: '0.85rem', margin: '4px 0' }}>{item.note}</div>}
                    <div className={item.is_active ? styles.pkgStatusActive : styles.pkgStatusInactive}>
                      {item.is_active ? 'Active' : 'Inactive'}
                    </div>
                  </div>
                  <div className={styles.pkgFooter}>
                    <div className={styles.toggleRow}>
                      <span style={{ fontSize: '0.8rem', color: item.is_active ? '#059669' : '#94a3b8' }}>
                        {item.is_active ? 'Active' : 'Inactive'}
                      </span>
                      <button
                        type="button"
                        title={item.is_active ? 'Click to disable' : 'Click to enable'}
                        onClick={() => handleCompToggle(item)}
                        style={{
                          position: 'relative', width: 44, height: 24, borderRadius: 12,
                          border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0,
                          background: item.is_active ? '#16a34a' : '#cbd5e1',
                          transition: 'background 0.2s',
                        }}
                      >
                        <span style={{
                          position: 'absolute', top: 3,
                          left: item.is_active ? 23 : 3,
                          width: 18, height: 18, borderRadius: '50%',
                          background: '#fff', transition: 'left 0.2s', display: 'block',
                        }} />
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <button className={styles.pkgIconBtn} title="Move up"   disabled={idx <= 0}                          onClick={() => handleCompMove(idx, -1)} style={{ fontSize: '0.65rem', padding: '2px 6px' }}>▲</button>
                        <button className={styles.pkgIconBtn} title="Move down" disabled={idx >= compProducts.length - 1}   onClick={() => handleCompMove(idx,  1)} style={{ fontSize: '0.65rem', padding: '2px 6px' }}>▼</button>
                      </div>
                      <button className={styles.pkgIconBtn} title="Edit" onClick={() => openCompEdit(item)}>✏️</button>
                      <button className={`${styles.pkgIconBtn} ${styles.pkgIconBtnRed}`} title="Delete" onClick={() => setCompDelTarget(item)}>🗑️</button>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Add / Edit Product Panel ──────────────────────────────────────── */}
      {panelOpen && (
        <div className={styles.overlay} onClick={() => !saving && setPanelOpen(false)}>
          <div className={styles.panel} onClick={e => e.stopPropagation()}>
            <div className={styles.panelHeader}>
              <div>
                <h3 className={styles.panelTitle}>{editItem ? 'Edit Product' : 'Add New Product'}</h3>
                <p className={styles.panelSub}>
                  {editItem ? 'Update product details' : 'Create a new SKU in the catalogue'}
                </p>
              </div>
              <button className={styles.closeBtn} onClick={() => setPanelOpen(false)} disabled={saving}>✕</button>
            </div>

            <div className={styles.panelBody}>
              {formErr && <div className={styles.formError}>{formErr}</div>}

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>SKU Code *</label>
                <input
                  className="form-control"
                  placeholder=""
                  value={form.sku}
                  onChange={e => setForm(f => ({ ...f, sku: e.target.value }))}
                  style={{ textTransform: 'uppercase' }}
                  onKeyDown={e => { if (e.key === 'Enter' && !saving) handleSave(); }}
                />
                <span className={styles.formHint}>Unique identifier — auto-uppercased.</span>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Product Name *</label>
                <input
                  className="form-control"
                  placeholder=""
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter' && !saving) handleSave(); }}
                />
              </div>

              {editItem && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Status</label>
                  <div className={styles.toggleRow}>
                    <span style={{ fontSize: '0.875rem', color: '#374151' }}>
                      {form.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <button
                      type="button"
                      className={`${styles.toggle} ${form.is_active ? styles.toggleOn : ''}`}
                      onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className={styles.panelFooter}>
              <button className={styles.btnSecondary} onClick={() => setPanelOpen(false)} disabled={saving}>Cancel</button>
              <button className={styles.btnPrimary} onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : editItem ? 'Save Changes' : 'Add Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Product Confirm ──────────────────────────────────────────── */}
      {delTarget && (
        <div className={styles.overlay} onClick={() => !deleting && setDelTarget(null)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <div className={styles.panelHeader} style={{ borderRadius: '16px 16px 0 0' }}>
              <h3 className={styles.panelTitle} style={{ color: '#dc2626' }}>Delete Product</h3>
              <button className={styles.closeBtn} onClick={() => setDelTarget(null)} disabled={deleting}>✕</button>
            </div>
            <div className={styles.panelBody} style={{ padding: 24 }}>
              <div className={styles.deleteConfirmBox}>
                <span style={{ fontSize: '2.5rem' }}>⚠️</span>
                <div>
                  <p style={{ margin: 0, color: '#374151', fontSize: '0.95rem' }}>
                    Delete <strong>"{delTarget.name}"</strong> ({delTarget.sku})?
                  </p>
                  <p style={{ margin: '8px 0 0', color: '#dc2626', fontSize: '0.8rem', fontWeight: 600 }}>
                    This will remove the product from all future visit records.
                  </p>
                  <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: '0.78rem' }}>
                    This action cannot be undone.
                  </p>
                </div>
              </div>
            </div>
            <div className={styles.panelFooter}>
              <button className={styles.btnSecondary} onClick={() => setDelTarget(null)} disabled={deleting}>Cancel</button>
              <button className={styles.btnDanger} onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add / Edit Competitor Panel ──────────────────────────────────── */}
      {compPanelOpen && (
        <div className={styles.overlay} onClick={() => !compSaving && setCompPanelOpen(false)}>
          <div className={styles.panel} onClick={e => e.stopPropagation()}>
            <div className={styles.panelHeader}>
              <div>
                <h3 className={styles.panelTitle}>{compEditItem ? 'Edit Competitor Product' : 'Add Competitor Product'}</h3>
                <p className={styles.panelSub}>
                  {compEditItem ? 'Update competitor product details' : 'Add a competitor brand or product for a region'}
                </p>
              </div>
              <button className={styles.closeBtn} onClick={() => setCompPanelOpen(false)} disabled={compSaving}>✕</button>
            </div>

            <div className={styles.panelBody}>
              {compErr && <div className={styles.formError}>{compErr}</div>}

              {!compEditItem && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Region *</label>
                  <select
                    className="form-control"
                    value={selectedRegionId}
                    onChange={e => setSelectedRegionId(e.target.value)}
                  >
                    <option value="">Select region…</option>
                    {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
              )}

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Competitor Name *</label>
                <input
                  className="form-control"
                  placeholder="e.g. Nestle Milo"
                  value={compForm.name}
                  onChange={e => setCompForm(f => ({ ...f, name: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter' && !compSaving) handleCompSave(); }}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Note <span style={{ color: '#94a3b8' }}>(optional)</span></label>
                <input
                  className="form-control"
                  placeholder="e.g. Direct competitor in noodles"
                  value={compForm.note}
                  onChange={e => setCompForm(f => ({ ...f, note: e.target.value }))}
                />
              </div>
            </div>

            <div className={styles.panelFooter}>
              <button className={styles.btnSecondary} onClick={() => setCompPanelOpen(false)} disabled={compSaving}>Cancel</button>
              <button className={styles.btnPrimary} onClick={handleCompSave} disabled={compSaving}>
                {compSaving ? 'Saving…' : compEditItem ? 'Save Changes' : 'Add Competitor'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Competitor Confirm ───────────────────────────────────────── */}
      {compDelTarget && (
        <div className={styles.overlay} onClick={() => !compDeleting && setCompDelTarget(null)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <div className={styles.panelHeader} style={{ borderRadius: '16px 16px 0 0' }}>
              <h3 className={styles.panelTitle} style={{ color: '#dc2626' }}>Delete Competitor Product</h3>
              <button className={styles.closeBtn} onClick={() => setCompDelTarget(null)} disabled={compDeleting}>✕</button>
            </div>
            <div className={styles.panelBody} style={{ padding: 24 }}>
              <div className={styles.deleteConfirmBox}>
                <span style={{ fontSize: '2.5rem' }}>⚠️</span>
                <div>
                  <p style={{ margin: 0, color: '#374151', fontSize: '0.95rem' }}>
                    Delete <strong>"{compDelTarget.name}"</strong>?
                  </p>
                  <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: '0.78rem' }}>
                    This action cannot be undone.
                  </p>
                </div>
              </div>
            </div>
            <div className={styles.panelFooter}>
              <button className={styles.btnSecondary} onClick={() => setCompDelTarget(null)} disabled={compDeleting}>Cancel</button>
              <button className={styles.btnDanger} onClick={handleCompDelete} disabled={compDeleting}>
                {compDeleting ? 'Deleting…' : 'Yes, Delete'}
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
