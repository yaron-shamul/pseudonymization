// Minimal RFC 4180 CSV parsing/serialising (quoted fields, escaped quotes, CRLF, embedded newlines).

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, ''); // strip BOM (Excel exports)

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c !== ''));
  if (nonEmpty.length < 2) throw new Error('CSV needs a header row and at least one data row');
  const columns = nonEmpty[0].map((c, i) => c.trim() || `column_${i + 1}`);
  const records = nonEmpty.slice(1).map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ''])));
  return { columns, records };
}

const escapeCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(records, columns) {
  const cols = [...(columns ?? [])];
  for (const r of records) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  return [cols.map(escapeCell).join(','), ...records.map((r) => cols.map((c) => escapeCell(r[c])).join(','))].join('\r\n');
}

export function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
