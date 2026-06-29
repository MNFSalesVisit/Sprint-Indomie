import React, { useState, useEffect } from 'react';
import styles from '../../styles/superadmin.module.css';

function dstamp() {
  return new Date().toISOString().slice(0, 10);
}

const CUR_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => String(CUR_YEAR - i));

const MONTHS = [
  { v: '',   l: 'All Months' },
  { v: '1',  l: 'January'   }, { v: '2',  l: 'February' }, { v: '3',  l: 'March'     },
  { v: '4',  l: 'April'     }, { v: '5',  l: 'May'      }, { v: '6',  l: 'June'      },
  { v: '7',  l: 'July'      }, { v: '8',  l: 'August'   }, { v: '9',  l: 'September' },
  { v: '10', l: 'October'   }, { v: '11', l: 'November' }, { v: '12', l: 'December'  },
];

const COLUMNS = [
  'Record Type', 'Date', 'Time (EAT)', 'Salesperson',
  'Region', 'Subregion', 'Shop Name', 'Shop Location',
  'Sold', 'Not Sold Reason', 'SKU', 'Product Name',
  'Cartons Sold', 'Cartons Uplifted', 'Stock Position', 'Uplift Status',
  'Latitude', 'Longitude',
];

const PREVIEW_LIMIT = 100;

export default function MasterData({ token }) {
  const [filters, setFilters] = useState({
    year:        String(CUR_YEAR),
    month:       '',
    dateFrom:    '',
    dateTo:      '',
    userId:      '',
    regionId:    '',
    subregionId: '',
  });

  const [users,      setUsers]      = useState([]);
  const [regions,    setRegions]    = useState([]);
  const [subregions, setSubregions] = useState([]);

  const [rows,        setRows]        = useState([]);
  const [total,       setTotal]       = useState(null);
  const [previewing,  setPreviewing]  = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [msg,         setMsg]         = useState('');

  const auth = { Authorization: `Bearer ${token}` };

  // Load filter options on mount
  useEffect(() => {
    fetch('/api/admin/master-data?action=filters', { headers: auth })
      .then(r => r.ok ? r.json() : { users: [], regions: [] })
      .then(d => {
        setUsers(d.users   || []);
        setRegions(d.regions || []);
      });
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load subregions when region changes
  useEffect(() => {
    if (!filters.regionId) { setSubregions([]); return; }
    fetch(`/api/admin/master-data?action=subregions&region_id=${filters.regionId}`, { headers: auth })
      .then(r => r.ok ? r.json() : [])
      .then(d => setSubregions(d || []));
  }, [filters.regionId]); // eslint-disable-line react-hooks/exhaustive-deps

  function setF(key, val) {
    setFilters(f => {
      const next = { ...f, [key]: val };
      if (key === 'regionId')              next.subregionId = '';
      if (key === 'dateFrom' || key === 'dateTo') { next.year = ''; next.month = ''; }
      if (key === 'year'     || key === 'month')  { next.dateFrom = ''; next.dateTo = ''; }
      return next;
    });
  }

  function buildParams() {
    const p = new URLSearchParams();
    if (filters.year)        p.set('year',         filters.year);
    if (filters.month)       p.set('month',        filters.month);
    if (filters.dateFrom)    p.set('date_from',    filters.dateFrom);
    if (filters.dateTo)      p.set('date_to',      filters.dateTo);
    if (filters.userId)      p.set('user_id',      filters.userId);
    if (filters.regionId)    p.set('region_id',    filters.regionId);
    if (filters.subregionId) p.set('subregion_id', filters.subregionId);
    return p.toString();
  }

  async function loadPreview() {
    setPreviewing(true); setMsg(''); setRows([]); setTotal(null);
    try {
      const r = await fetch(`/api/admin/master-data?${buildParams()}`, { headers: auth });
      if (!r.ok) { setMsg('❌ Failed to load data.'); return; }
      const d = await r.json();
      setRows(d.rows  || []);
      setTotal(d.total ?? 0);
    } catch (e) {
      setMsg(`❌ ${e.message}`);
    } finally {
      setPreviewing(false);
    }
  }

  async function downloadExcel() {
    setDownloading(true); setMsg('');
    try {
      // Fetch data and branding in parallel
      const [dataRes, brandRes] = await Promise.all([
        fetch(`/api/admin/master-data?${buildParams()}`, { headers: auth }),
        fetch('/api/branding'),
      ]);
      if (!dataRes.ok) { setMsg('❌ Failed to fetch data.'); return; }
      const d = await dataRes.json();
      const allRows = d.rows || [];
      if (!allRows.length) { setMsg('⚠️ No records found for the selected filters.'); return; }

      const branding     = brandRes.ok ? await brandRes.json() : {};
      const companyName  = branding.company_name || branding.system_name || 'Sprint App';

      const ExcelJSMod = await import('exceljs');
      const ExcelJS    = ExcelJSMod.default || ExcelJSMod;
      const wb = new ExcelJS.Workbook();
      wb.creator  = 'Sprint App';
      wb.created  = new Date();
      const ws = wb.addWorksheet('Raw Data');

      let curRow = 1;

      // ── Header rows ───────────────────────────────────────────────────
      const nameCell = ws.getRow(curRow).getCell(1);
      nameCell.value = companyName;
      nameCell.font  = { bold: true, size: 14 };
      curRow++;

      const titleCell = ws.getRow(curRow).getCell(1);
      titleCell.value = 'Master Data Report';
      titleCell.font  = { bold: true, size: 11, color: { argb: 'FF6B7280' } };
      curRow++;

      const dateCell = ws.getRow(curRow).getCell(1);
      dateCell.value = `Generated: ${new Date().toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })} EAT`;
      dateCell.font = { size: 9, italic: true, color: { argb: 'FF9CA3AF' } };
      curRow += 2; // blank row after header block

      // ── Column header row ─────────────────────────────────────────────
      const headerRow = ws.getRow(curRow);
      COLUMNS.forEach((col, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value     = col;
        cell.font      = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
        cell.border    = {
          top: { style: 'thin', color: { argb: 'FF6D28D9' } },
          bottom: { style: 'thin', color: { argb: 'FF6D28D9' } },
          left:  { style: 'thin', color: { argb: 'FF6D28D9' } },
          right: { style: 'thin', color: { argb: 'FF6D28D9' } },
        };
      });
      headerRow.height = 22;
      curRow++;

      // ── Data rows ─────────────────────────────────────────────────────
      const altFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F3FF' } };
      const thinBorder = (argb = 'FFE2E8F0') => ({ style: 'thin', color: { argb } });
      allRows.forEach((row, ri) => {
        const dr = ws.getRow(curRow);
        const isAlt = ri % 2 === 1;
        COLUMNS.forEach((col, i) => {
          const cell   = dr.getCell(i + 1);
          cell.value   = row[col] ?? '';
          cell.font    = { size: 10 };
          if (isAlt) cell.fill = altFill;
          cell.border  = {
            top: thinBorder(), bottom: thinBorder(),
            left: thinBorder(), right: thinBorder(),
          };
          // Numeric columns — store as numbers
          if (['Cartons Sold', 'Cartons Uplifted', 'Stock Position', 'Latitude', 'Longitude'].includes(col)) {
            const n = parseFloat(row[col]);
            if (!isNaN(n)) cell.value = n;
          }
        });
        curRow++;
      });

      // ── Footer ────────────────────────────────────────────────────────
      curRow++; // blank row
      const footerRow = ws.getRow(curRow);
      const footerCell = footerRow.getCell(1);
      footerCell.value = '';
      footerCell.font  = { bold: true, size: 9, italic: true, color: { argb: 'FF9CA3AF' } };
      ws.mergeCells(curRow, 1, curRow, COLUMNS.length);
      footerCell.alignment = { horizontal: 'center' };

      // ── Column widths ─────────────────────────────────────────────────
      const sample = allRows.slice(0, 200);
      COLUMNS.forEach((col, i) => {
        ws.getColumn(i + 1).width = Math.min(50, Math.max(
          col.length + 2,
          ...sample.map(r => String(r[col] ?? '').length),
        ));
      });

      // ── Write & download ──────────────────────────────────────────────
      const buffer = await wb.xlsx.writeBuffer();
      const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url    = URL.createObjectURL(blob);
      const a      = document.createElement('a');
      a.href = url; a.download = `master-data-${dstamp()}.xlsx`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);

      setMsg(`✅ Downloaded ${allRows.length.toLocaleString()} rows.`);
    } catch (e) {
      setMsg(`❌ ${e.message}`);
    } finally {
      setDownloading(false);
    }
  }

  const previewRows = rows.slice(0, PREVIEW_LIMIT);

  return (
    <div>
      <h2 className={styles.tabHeading}>Master Data Management</h2>

      <div className={styles.card} style={{ marginBottom: 16 }}>

        {/* ── Filters row 1: Period ── */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={filterCol}>
            <label style={labelStyle}>Year</label>
            <select className={styles.filterSelect} value={filters.year} onChange={e => setF('year', e.target.value)}>
              <option value="">All Years</option>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div style={filterCol}>
            <label style={labelStyle}>Month</label>
            <select
              className={styles.filterSelect}
              value={filters.month}
              onChange={e => setF('month', e.target.value)}
              disabled={!!filters.dateFrom || !!filters.dateTo}
            >
              {MONTHS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
          </div>
          <div style={filterCol}>
            <label style={labelStyle}>Date From</label>
            <input
              type="date"
              className={styles.filterSelect}
              value={filters.dateFrom}
              onChange={e => setF('dateFrom', e.target.value)}
            />
          </div>
          <div style={filterCol}>
            <label style={labelStyle}>Date To</label>
            <input
              type="date"
              className={styles.filterSelect}
              value={filters.dateTo}
              onChange={e => setF('dateTo', e.target.value)}
            />
          </div>
        </div>

        {/* ── Filters row 2: People & Place ── */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={filterCol}>
            <label style={labelStyle}>Salesperson</label>
            <select className={styles.filterSelect} value={filters.userId} onChange={e => setF('userId', e.target.value)}>
              <option value="">All Salespersons</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>
          <div style={filterCol}>
            <label style={labelStyle}>Region</label>
            <select className={styles.filterSelect} value={filters.regionId} onChange={e => setF('regionId', e.target.value)}>
              <option value="">All Regions</option>
              {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div style={filterCol}>
            <label style={labelStyle}>Subregion</label>
            <select
              className={styles.filterSelect}
              value={filters.subregionId}
              onChange={e => setF('subregionId', e.target.value)}
              disabled={!filters.regionId}
            >
              <option value="">All Subregions</option>
              {subregions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        {/* ── Actions ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button className={styles.btnSecondary} onClick={loadPreview} disabled={previewing || downloading}>
            {previewing ? '⏳ Loading…' : '🔍 Preview'}
          </button>
          <button className={styles.btnPrimary} onClick={downloadExcel} disabled={downloading || previewing}>
            {downloading ? '⏳ Generating…' : '📥 Download Excel (.xlsx)'}
          </button>
          {msg && (
            <span style={{
              fontSize: 13,
              color: msg.startsWith('✅') ? '#059669' : msg.startsWith('⚠️') ? '#d97706' : '#dc2626',
            }}>
              {msg}
            </span>
          )}
          {total !== null && !previewing && (
            <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 'auto' }}>
              {total.toLocaleString()} row{total !== 1 ? 's' : ''} found
              {previewRows.length < total ? ` · showing first ${previewRows.length}` : ''}
            </span>
          )}
        </div>
      </div>

      {/* ── Preview table ── */}
      {previewRows.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.uaTable}>
            <thead>
              <tr>
                {COLUMNS.map(col => (
                  <th key={col} style={{ whiteSpace: 'nowrap', fontSize: 11, padding: '8px 12px' }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, i) => (
                <tr key={i}>
                  {COLUMNS.map(col => (
                    <td
                      key={col}
                      style={{
                        fontSize: 12,
                        whiteSpace: 'nowrap',
                        padding: '6px 12px',
                        color: col === 'Record Type'
                          ? (row[col] === 'Visit' ? '#7c3aed' : '#059669')
                          : col === 'Sold'
                            ? (row[col] === 'Yes' ? '#059669' : row[col] === 'No' ? '#dc2626' : undefined)
                            : undefined,
                        fontWeight: col === 'Record Type' ? 600 : undefined,
                      }}
                    >
                      {row[col] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total === 0 && !previewing && (
        <div className={styles.tableEmpty} style={{ marginTop: 24 }}>
          No records found for the selected filters.
        </div>
      )}
    </div>
  );
}

// Shared inline styles
const filterCol = { display: 'flex', flexDirection: 'column', gap: 4 };
const labelStyle = { fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' };
