import React, { useState } from 'react';

/**
 * ReportPreviewModal
 * 
 * Shared ERP-style report preview: Preview → Print → Export
 * 
 * Props:
 *   open         {bool}      — whether the modal is visible
 *   onClose      {fn}        — called when user closes the modal
 *   title        {string}    — report title shown in header
 *   subtitle     {string?}   — filter summary / period label
 *   headers      {string[]}  — column header labels
 *   rows         {any[][]}   — AOA (array of arrays) — one array per row
 *   onExport     {async fn}  — the original unchanged export function (generates + downloads XLSX)
 */
export default function ReportPreviewModal({
  open,
  onClose,
  title,
  subtitle,
  headers = [],
  rows    = [],
  onExport,
}) {
  const [isExporting, setIsExporting] = useState(false);

  if (!open) return null;

  // Cap preview at 500 rows to keep the browser responsive
  const MAX_ROWS    = 500;
  const displayRows = rows.slice(0, MAX_ROWS);
  const isTruncated = rows.length > MAX_ROWS;

  // ── Export to Excel ────────────────────────────────────────────
  const handleExport = async () => {
    setIsExporting(true);
    try   { await onExport(); }
    catch (e) { console.error('Report export failed', e); }
    finally   { setIsExporting(false); }
  };

  // ── Print ──────────────────────────────────────────────────────
  const handlePrint = () => {
    const thStyle = [
      'padding:8px 10px',
      'background:#1e3a5f',
      'color:#fff',
      'font-weight:700',
      'font-size:11px',
      'text-align:left',
      'white-space:nowrap',
      'border:1px solid #2d4f7a',
    ].join(';');

    const tdStyleBase = [
      'padding:6px 10px',
      'font-size:10px',
      'color:#334155',
      'border-bottom:1px solid #f1f5f9',
    ].join(';');

    const headHtml = headers.map(h => `<th style="${thStyle}">${h}</th>`).join('');
    const rowsHtml = displayRows.map((row, ri) => {
      const bg    = ri % 2 === 0 ? 'background:#f8fafc;' : '';
      const cells = row.map(cell => `<td style="${tdStyleBase}">${cell ?? '&mdash;'}</td>`).join('');
      return `<tr style="${bg}">${cells}</tr>`;
    }).join('');

    const now = new Date().toLocaleString();

    const html = [
      '<!DOCTYPE html>',
      '<html><head><meta charset="utf-8">',
      `<title>${title}</title>`,
      '<style>',
      '@page{margin:15mm 10mm}',
      "body{font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;margin:0;padding:0}",
      '.rpt-head{margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #1e3a5f}',
      'h1{font-size:15px;margin:0 0 3px;color:#1e3a5f}',
      '.sub{font-size:10px;color:#64748b;margin:1px 0}',
      'table{width:100%;border-collapse:collapse}',
      '@media print{button{display:none!important}}',
      '</style></head><body>',
      '<div class="rpt-head">',
      `<h1>${title}</h1>`,
      subtitle ? `<div class="sub">${subtitle}</div>` : '',
      `<div class="sub">Printed: ${now} &nbsp;&middot;&nbsp; ${rows.length.toLocaleString()} record${rows.length !== 1 ? 's' : ''}</div>`,
      '</div>',
      `<table><thead><tr>${headHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`,
      '</body></html>',
    ].join('');

    const pw = window.open('', '_blank');
    if (!pw) {
      alert('Pop-up blocked. Please allow pop-ups for this site to use Print.');
      return;
    }
    pw.document.write(html);
    pw.document.close();
    pw.focus();
    setTimeout(() => { pw.print(); }, 500);
  };

  // ── Styles (inline — no CSS module dependency) ─────────────────
  const overlay = {
    position: 'fixed', inset: 0, zIndex: 9000,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'stretch', justifyContent: 'center',
    padding: '24px 16px',
  };

  const dialog = {
    background: '#fff',
    borderRadius: 14,
    display: 'flex', flexDirection: 'column',
    width: '100%', maxWidth: 1180, maxHeight: '100%',
    boxShadow: '0 20px 60px rgba(0,0,0,0.28)',
    overflow: 'hidden',
  };

  const modalHeader = {
    padding: '14px 18px 12px',
    borderBottom: '1px solid #e2e8f0',
    display: 'flex', alignItems: 'flex-start', gap: 14,
    flexShrink: 0,
    background: '#f8fafc',
  };

  const btnBase = {
    padding: '7px 14px', borderRadius: 8,
    cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
    lineHeight: 1.4, whiteSpace: 'nowrap',
    display: 'inline-flex', alignItems: 'center', gap: 5,
  };

  const printBtn = {
    ...btnBase,
    border: '1px solid #e2e8f0', background: '#fff', color: '#475569',
  };

  const exportBtn = {
    ...btnBase,
    border: 'none',
    background: isExporting || rows.length === 0 ? '#e2e8f0' : '#16a34a',
    color:      isExporting || rows.length === 0 ? '#94a3b8' : '#fff',
    cursor:     isExporting || rows.length === 0 ? 'not-allowed' : 'pointer',
  };

  const closeBtn = {
    ...btnBase,
    border: '1px solid #e2e8f0', background: '#fff', color: '#64748b',
    padding: '7px 10px',
  };

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={dialog}>

        {/* ─── Header ─── */}
        <div style={modalHeader}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#0f172a' }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>{subtitle}</div>
            )}
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 4 }}>
              {rows.length === 0
                ? 'No data available for the selected filters'
                : isTruncated
                ? `Showing first ${MAX_ROWS.toLocaleString()} of ${rows.length.toLocaleString()} records — export for full data`
                : `${rows.length.toLocaleString()} record${rows.length !== 1 ? 's' : ''}`}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
            <button
              style={printBtn}
              onClick={handlePrint}
              disabled={rows.length === 0}
              title="Print report"
            >
              &#128424; Print
            </button>
            <button
              style={exportBtn}
              onClick={handleExport}
              disabled={isExporting || rows.length === 0}
              title="Export to Excel"
            >
              {isExporting ? '\u23F3 Exporting\u2026' : '\uD83D\uDCE5 Export to Excel'}
            </button>
            <button style={closeBtn} onClick={onClose} title="Close">&#10005;</button>
          </div>
        </div>

        {/* ─── Table ─── */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {rows.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', padding: '60px 20px', color: '#94a3b8',
            }}>
              <span style={{ fontSize: '2.5rem', marginBottom: 12 }}>&#128203;</span>
              <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#64748b' }}>
                No data available for the selected filters
              </span>
            </div>
          ) : (
            <table style={{
              width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem',
              minWidth: Math.max(600, headers.length * 110),
            }}>
              <thead>
                <tr>
                  {headers.map((h, i) => (
                    <th key={i} style={{
                      position: 'sticky', top: 0, zIndex: 2,
                      padding: '10px 12px',
                      background: '#1e3a5f', color: '#fff',
                      fontWeight: 700, fontSize: '0.77rem',
                      textAlign: 'left', whiteSpace: 'nowrap',
                      borderRight: '1px solid rgba(255,255,255,0.1)',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row, ri) => (
                  <tr key={ri} style={{ background: ri % 2 === 0 ? '#f8fafc' : '#fff' }}>
                    {row.map((cell, ci) => (
                      <td key={ci} style={{
                        padding: '7px 12px',
                        color: '#334155',
                        borderBottom: '1px solid #f1f5f9',
                        whiteSpace: 'nowrap',
                        maxWidth: 280,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {cell ?? '\u2014'}
                      </td>
                    ))}
                  </tr>
                ))}
                {isTruncated && (
                  <tr>
                    <td
                      colSpan={headers.length}
                      style={{
                        padding: '10px 12px', textAlign: 'center',
                        color: '#64748b', fontSize: '0.78rem',
                        fontStyle: 'italic', background: '#f1f5f9',
                      }}
                    >
                      Showing first {MAX_ROWS.toLocaleString()} rows &mdash; use &ldquo;Export to Excel&rdquo; to get all {rows.length.toLocaleString()} records.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
