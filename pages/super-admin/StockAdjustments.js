import React, { useEffect, useState, useCallback } from 'react';
import styles from '../../styles/superadmin.module.css';

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function UserAvatar({ user, size = 38 }) {
  if (user.avatar_url) {
    return (
      <img
        src={user.avatar_url}
        alt={user.full_name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }
  return (
    <div className={styles.avatar} style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {(user.full_name || user.email || '?')[0].toUpperCase()}
    </div>
  );
}

export default function StockAdjustments({ token }) {
  // ── Users list ──────────────────────────────────────────────────────────
  const [users,       setUsers]       = useState([]);
  const [regions,     setRegions]     = useState([]);
  const [regionFilter, setRegionFilter] = useState('');
  const [search,      setSearch]      = useState('');
  const [usersLoading, setUsersLoading] = useState(false);

  // ── Selected user panel ─────────────────────────────────────────────────
  const [selectedUser, setSelectedUser] = useState(null);
  const [stock,        setStock]        = useState([]);   // [{ product_id, sku, name, quantity, ... }]
  const [edits,        setEdits]        = useState({});   // { product_id: new_quantity_string }
  const [reason,       setReason]       = useState('');
  const [stockLoading, setStockLoading] = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [saveMsg,      setSaveMsg]      = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const auth = { Authorization: `Bearer ${token}` };

  // ── Load regions + users ────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    fetch('/api/admin/stock-adjustments?action=regions', { headers: auth })
      .then(r => r.json()).then(d => Array.isArray(d) && setRegions(d)).catch(() => {});
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const p = new URLSearchParams({ action: 'users' });
      if (regionFilter) p.set('region_id', regionFilter);
      const r = await fetch(`/api/admin/stock-adjustments?${p}`, { headers: auth });
      if (r.ok) setUsers(await r.json());
    } finally { setUsersLoading(false); }
  }, [token, regionFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadUsers(); }, [loadUsers]);

  // ── Load stock for selected user ────────────────────────────────────────
  async function selectUser(user) {
    setSelectedUser(user);
    setEdits({});
    setReason('');
    setSaveMsg('');
    setStockLoading(true);
    try {
      const r = await fetch(
        `/api/admin/stock-adjustments?action=stock&user_id=${user.id}`,
        { headers: auth },
      );
      if (r.ok) setStock(await r.json());
    } finally { setStockLoading(false); }
  }

  function closePanel() {
    setSelectedUser(null);
    setStock([]);
    setEdits({});
    setSaveMsg('');
  }

  // ── Track edits ─────────────────────────────────────────────────────────
  function handleEdit(product_id, value) {
    setSaveMsg('');
    setEdits(prev => ({ ...prev, [product_id]: value }));
  }

  function resetEdit(product_id) {
    setEdits(prev => {
      const next = { ...prev };
      delete next[product_id];
      return next;
    });
  }

  const dirtyIds = Object.keys(edits).filter(pid => {
    const orig = stock.find(s => String(s.product_id) === String(pid))?.quantity ?? 0;
    const newVal = parseInt(edits[pid], 10);
    return !isNaN(newVal) && newVal !== orig;
  });

  // ── Save adjustments ────────────────────────────────────────────────────
  async function handleSave() {
    if (dirtyIds.length === 0) return;
    setSaving(true); setSaveMsg('');
    try {
      const adjustments = dirtyIds.map(pid => {
        const orig = stock.find(s => String(s.product_id) === String(pid));
        return {
          product_id:   parseInt(pid),
          new_quantity: parseInt(edits[pid], 10),
          old_quantity: orig?.quantity ?? 0,
        };
      });
      const r = await fetch('/api/admin/stock-adjustments', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: selectedUser.id, adjustments, reason }),
      });
      const d = await r.json();
      if (!r.ok) { setSaveMsg(`❌ ${d.error || 'Save failed'}`); return; }
      setSaveMsg(
        `✅ ${d.applied} SKU${d.applied !== 1 ? 's' : ''} updated.${d.errors?.length ? ` ${d.errors.length} failed.` : ''}`
      );
      setEdits({});
      setReason('');
      // Reload stock + users list
      await selectUser(selectedUser);
      loadUsers();
    } finally { setSaving(false); }
  }

  // ── Filtered users ──────────────────────────────────────────────────────
  const filteredUsers = users.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (u.full_name || '').toLowerCase().includes(q) ||
           (u.email     || '').toLowerCase().includes(q);
  });

  const visibleStock = showInactive
    ? stock
    : stock.filter(s => s.is_active);

  const totalCartons = stock
    .filter(s => s.is_active)
    .reduce((sum, s) => {
      const v = edits[s.product_id] !== undefined ? parseInt(edits[s.product_id], 10) : s.quantity;
      return sum + (isNaN(v) ? s.quantity : v);
    }, 0);

  return (
    <div className={styles.saWrap}>

      {/* ── Page header ── */}
      <div className={styles.saHeader}>
        <div>
          <h2 className={styles.saTitle}>✏️ Manual Stock Adjustments</h2>
          <p className={styles.saSub}>Correct field input mistakes by editing salesperson stock balances per SKU. All changes are logged to the audit trail.</p>
        </div>
      </div>

      <div className={styles.saLayout}>

        {/* ── Left: user list ── */}
        <div className={styles.saUserPanel}>
          <div className={styles.saUserPanelHead}>
            <input
              className={styles.filterInput}
              placeholder="🔍 Search salesperson…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select
              className={styles.filterSelect}
              value={regionFilter}
              onChange={e => setRegionFilter(e.target.value)}
            >
              <option value="">All Regions</option>
              {regions.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>

          {usersLoading ? (
            <div className={styles.saEmptyState}>Loading salespersons…</div>
          ) : filteredUsers.length === 0 ? (
            <div className={styles.saEmptyState}>No salespersons found.</div>
          ) : (
            <div className={styles.saUserList}>
              {filteredUsers.map(user => (
                <button
                  key={user.id}
                  className={`${styles.saUserRow} ${selectedUser?.id === user.id ? styles.saUserRowActive : ''}`}
                  onClick={() => selectedUser?.id === user.id ? closePanel() : selectUser(user)}
                >
                  <UserAvatar user={user} size={40} />
                  <div className={styles.saUserInfo}>
                    <div className={styles.saUserName}>{user.full_name || '—'}</div>
                    <div className={styles.saUserEmail}>{user.email}</div>
                    <div className={styles.saUserMeta}>
                      {(user.user_regions || []).slice(0, 2).map((ur, i) => (
                        <span key={i} className={styles.saRegionPill}>
                          {ur.regions?.name || '—'}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className={styles.saUserStock}>
                    <span className={styles.saUserStockVal}>{user.total_stock.toLocaleString()}</span>
                    <span className={styles.saUserStockLabel}>ctns</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Right: stock editing panel ── */}
        {selectedUser ? (
          <div className={styles.saStockPanel}>

            {/* Panel header */}
            <div className={styles.saStockPanelHead}>
              <div className={styles.saStockPanelUser}>
                <UserAvatar user={selectedUser} size={44} />
                <div>
                  <div className={styles.saStockPanelName}>{selectedUser.full_name || '—'}</div>
                  <div className={styles.saStockPanelEmail}>{selectedUser.email}</div>
                </div>
              </div>
              <button className={styles.saCloseBtn} onClick={closePanel} title="Close">✕</button>
            </div>

            {/* Stock summary strip */}
            <div className={styles.saStockSummary}>
              <div className={styles.saStockSumItem}>
                <span className={styles.saStockSumVal}>{totalCartons.toLocaleString()}</span>
                <span className={styles.saStockSumLabel}>Total Cartons</span>
              </div>
              <div className={styles.saStockSumDivider} />
              <div className={styles.saStockSumItem}>
                <span className={styles.saStockSumVal}>{stock.filter(s => s.is_active && s.quantity > 0).length}</span>
                <span className={styles.saStockSumLabel}>SKUs with Stock</span>
              </div>
              <div className={styles.saStockSumDivider} />
              <div className={styles.saStockSumItem}>
                <span className={styles.saStockSumVal} style={{ color: dirtyIds.length > 0 ? '#d97706' : '#94a3b8' }}>
                  {dirtyIds.length}
                </span>
                <span className={styles.saStockSumLabel}>Pending Changes</span>
              </div>
            </div>

            {stockLoading ? (
              <div className={styles.saEmptyState} style={{ margin: '32px 0' }}>Loading stock balances…</div>
            ) : (
              <>
                {/* SKU table */}
                <div className={styles.saSkuTableWrap}>
                  <div className={styles.saSkuTableToolbar}>
                    <span className={styles.saSkuTableTitle}>Stock Balances per SKU</span>
                    <label className={styles.saToggleLabel}>
                      <input
                        type="checkbox"
                        checked={showInactive}
                        onChange={e => setShowInactive(e.target.checked)}
                        className={styles.brCheckbox}
                      />
                      Show inactive SKUs
                    </label>
                  </div>

                  <table className={styles.saSkuTable}>
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Product Name</th>
                        <th className={styles.saThCenter}>Current Qty</th>
                        <th className={styles.saThCenter}>New Qty</th>
                        <th className={styles.saThCenter}>Change</th>
                        <th>Last Updated</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleStock.map(row => {
                        const editVal  = edits[row.product_id];
                        const isDirty  = editVal !== undefined && parseInt(editVal, 10) !== row.quantity && !isNaN(parseInt(editVal, 10));
                        const newQty   = editVal !== undefined ? parseInt(editVal, 10) : row.quantity;
                        const delta    = isNaN(newQty) ? 0 : newQty - row.quantity;
                        const hasError = editVal !== undefined && (isNaN(parseInt(editVal, 10)) || parseInt(editVal, 10) < 0);

                        return (
                          <tr key={row.product_id} className={`${styles.saSkuRow} ${isDirty ? styles.saSkuRowDirty : ''} ${!row.is_active ? styles.saSkuRowInactive : ''}`}>
                            <td>
                              <span className={styles.saSkuPill}>{row.sku}</span>
                            </td>
                            <td className={styles.saSkuName}>
                              {row.name}
                              {!row.is_active && <span className={styles.saInactiveBadge}>Inactive</span>}
                            </td>
                            <td className={styles.saThCenter}>
                              <span className={styles.saQtyBadge}>{row.quantity.toLocaleString()}</span>
                            </td>
                            <td className={styles.saThCenter}>
                              <input
                                type="number"
                                min="0"
                                className={`${styles.saQtyInput} ${hasError ? styles.saQtyInputError : isDirty ? styles.saQtyInputDirty : ''}`}
                                value={editVal !== undefined ? editVal : row.quantity}
                                onChange={e => handleEdit(row.product_id, e.target.value)}
                                onFocus={e => e.target.select()}
                              />
                            </td>
                            <td className={styles.saThCenter}>
                              {isDirty && !isNaN(delta) ? (
                                <span className={`${styles.saDeltaBadge} ${delta > 0 ? styles.saDeltaPos : styles.saDeltaNeg}`}>
                                  {delta > 0 ? `+${delta}` : delta}
                                </span>
                              ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                            </td>
                            <td className={styles.saSkuDate}>{fmt(row.last_updated)}</td>
                            <td>
                              {isDirty && (
                                <button className={styles.saResetBtn} onClick={() => resetEdit(row.product_id)} title="Reset">↩</button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Save footer */}
                {dirtyIds.length > 0 && (
                  <div className={styles.saSaveBar}>
                    <div className={styles.saSaveBarLeft}>
                      <span className={styles.saSavePending}>
                        {dirtyIds.length} SKU{dirtyIds.length !== 1 ? 's' : ''} changed
                      </span>
                      <input
                        className={styles.saReasonInput}
                        placeholder="Reason for adjustment (optional but recommended)…"
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        maxLength={200}
                      />
                    </div>
                    <div className={styles.saSaveBarRight}>
                      <button
                        className={styles.btnSecondary}
                        onClick={() => { setEdits({}); setSaveMsg(''); }}
                        disabled={saving}
                      >
                        Discard
                      </button>
                      <button
                        className={styles.btnPrimary}
                        onClick={handleSave}
                        disabled={saving}
                      >
                        {saving ? '⏳ Saving…' : `💾 Save ${dirtyIds.length} Change${dirtyIds.length !== 1 ? 's' : ''}`}
                      </button>
                    </div>
                  </div>
                )}

                {saveMsg && (
                  <div className={`${styles.brMsg} ${saveMsg.startsWith('✅') ? styles.brMsgOk : styles.brMsgErr}`}>
                    {saveMsg}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className={styles.saNoSelection}>
            <div className={styles.saNoSelIcon}>👈</div>
            <div className={styles.saNoSelTitle}>Select a salesperson</div>
            <div className={styles.saNoSelSub}>Choose from the list to view and edit their stock balances per SKU.</div>
          </div>
        )}

      </div>
    </div>
  );
}
