import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  LockIcon,
  UnlockIcon,
  CopyIcon,
  CheckIcon,
  ArrowRightIcon,
  AlertIcon,
  SpinnerIcon,
  ReturnIcon,
  SparkIcon,
  PlayIcon,
  UploadIcon,
  DownloadIcon,
  FileIcon,
  BookmarkIcon,
  XIcon,
} from './icons.jsx';
import { parseCsv, toCsv, downloadFile } from './csv.js';

export const SAMPLES = {
  customers: {
    label: 'Customers',
    idField: 'id',
    fields: ['name', 'email', 'phone'],
    data: [
      { id: 'U100', name: 'Dana Levi', email: 'dana@example.com', phone: '+972501234567', city: 'Tel Aviv', plan: 'pro' },
      { id: 'U101', name: 'Avi Cohen', email: 'avi@example.com', phone: '+972527654321', city: 'Haifa', plan: 'free' },
    ],
  },
  patients: {
    label: 'Patients',
    idField: 'patientId',
    fields: ['fullName', 'ssn', 'address'],
    data: [
      { patientId: 'P-2041', fullName: 'Noa Mizrahi', ssn: '039482716', address: '12 Herzl St, Jerusalem', diagnosis: 'J45.909', age: 34 },
      { patientId: 'P-2042', fullName: 'Yossi Peretz', ssn: '028374615', address: '4 Rothschild Blvd, Tel Aviv', diagnosis: 'E11.9', age: 58 },
    ],
  },
  single: {
    label: 'Single record',
    idField: 'id',
    fields: ['name', 'email'],
    data: { id: 'A001', name: 'John Smith', email: 'john@example.com', country: 'US' },
  },
};

const CHUNK_SIZE = 500; // records per request when sending large batches
const PREVIEW_RECORDS = 20; // records shown in the result table
const JSON_PREVIEW = 50; // results shown in the JSON view
const MAX_FILE_MB = 50;
const PRESETS_KEY = 'pseudonym.presets.v1';

const TOKEN_RE = /^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*_[0-9A-F]{7}$/;
export const isToken = (v) => typeof v === 'string' && TOKEN_RE.test(v);

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlightJson(value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return escapeHtml(json ?? '').replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m, str, colon, bool, num) => {
      if (str) {
        if (colon) return `<span class="k">${str}</span>${colon}`;
        return `<span class="${isToken(str.slice(1, -1)) ? 't' : 's'}">${str}</span>`;
      }
      if (bool) return `<span class="b">${bool}</span>`;
      return `<span class="n">${num}</span>`;
    }
  );
}

function validateRecords(value) {
  const records = Array.isArray(value) ? value : [value];
  if (!records.length) return { ok: false, error: 'Array is empty' };
  if (records.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) {
    return { ok: false, error: 'Every record must be a JSON object' };
  }
  return { ok: true, value, records, isArray: Array.isArray(value) };
}

function parseData(text) {
  try {
    return validateRecords(JSON.parse(text));
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const unionKeys = (records) => {
  const seen = new Set();
  records.forEach((r) => Object.keys(r).forEach((k) => seen.add(k)));
  return [...seen];
};

const pretty = (v) => JSON.stringify(v, null, 2);
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

function loadPresets() {
  try {
    const list = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function savePresets(list) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable (private mode) — presets just won't persist
  }
}

export default function Playground({ apiBase, onResult, notify }) {
  const [mode, setMode] = useState('anonymize');
  const [dataText, setDataText] = useState(pretty(SAMPLES.customers.data));
  const [file, setFile] = useState(null); // { name, format: 'csv' | 'json', columns, records }
  const [selected, setSelected] = useState(() => new Set(SAMPLES.customers.fields));
  const [prefixes, setPrefixes] = useState({});
  const [idField, setIdField] = useState('id');
  const [showPrefixes, setShowPrefixes] = useState(false);
  const [presets, setPresets] = useState(loadPresets);
  const [presetName, setPresetName] = useState(null); // null = not saving; string = name being typed
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState(null);
  const [view, setView] = useState('table');
  const sendRef = useRef(null);
  const fileInput = useRef(null);

  const parsed = useMemo(
    () => (file ? { ok: true, value: file.records, records: file.records, isArray: true } : parseData(dataText)),
    [file, dataText]
  );
  const keys = useMemo(() => (file ? file.columns : parsed.ok ? unionKeys(parsed.records) : []), [file, parsed]);

  const lineCount = file ? 0 : dataText.split('\n').length;
  const activeFields = keys.filter((k) => selected.has(k) && k !== idField);
  const batched = parsed.ok && parsed.isArray && parsed.records.length > CHUNK_SIZE;

  const loadSample = (key) => {
    const s = SAMPLES[key];
    setFile(null);
    setDataText(pretty(s.data));
    setSelected(new Set(s.fields));
    setIdField(s.idField);
    setPrefixes({});
    setMode('anonymize');
  };

  const toggle = (k) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  /* ---------- Files ---------- */

  const openFile = async (f) => {
    if (!f) return;
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      notify(`File is larger than ${MAX_FILE_MB} MB`);
      return;
    }
    try {
      const text = await f.text();
      const isCsv = /\.csv$/i.test(f.name) || f.type === 'text/csv';
      let columns;
      let records;
      if (isCsv) {
        ({ columns, records } = parseCsv(text));
      } else {
        const v = validateRecords(JSON.parse(text));
        if (!v.ok) throw new Error(v.error);
        records = v.records;
        columns = unionKeys(records);
      }
      setFile({ name: f.name, format: isCsv ? 'csv' : 'json', columns, records });
      if (!columns.includes(idField)) setIdField(columns.includes('id') ? 'id' : columns[0]);
      setResult(null);
      notify(`Loaded ${plural(records.length, 'record')} from ${f.name}`);
    } catch (e) {
      notify(`Couldn’t read ${f.name}: ${e.message}`);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    openFile(e.dataTransfer.files?.[0]);
  };

  /* ---------- Presets ---------- */

  const applyPreset = (p) => {
    setSelected(new Set(p.fields));
    setPrefixes(p.prefixes ?? {});
    if (p.idField) setIdField(p.idField);
    setShowPrefixes(Object.values(p.prefixes ?? {}).some(Boolean));
    const missing = p.fields.filter((f) => !keys.includes(f));
    notify(missing.length ? `“${p.name}” applied — not in this data: ${missing.join(', ')}` : `“${p.name}” applied`);
  };

  const saveCurrentPreset = () => {
    const name = presetName?.trim();
    if (!name || !activeFields.length) return;
    const usedPrefixes = Object.fromEntries(activeFields.filter((f) => prefixes[f]?.trim()).map((f) => [f, prefixes[f].trim()]));
    const preset = { name, fields: activeFields, prefixes: usedPrefixes, idField };
    const next = [...presets.filter((p) => p.name !== name), preset];
    setPresets(next);
    savePresets(next);
    setPresetName(null);
    notify(`Preset “${name}” saved`);
  };

  const deletePreset = (name) => {
    const next = presets.filter((p) => p.name !== name);
    setPresets(next);
    savePresets(next);
  };

  /* ---------- Send ---------- */

  const buildOptions = () => {
    const opts = {};
    if (activeFields.length) {
      const custom = activeFields.some((f) => prefixes[f]?.trim());
      opts.fields = custom
        ? Object.fromEntries(activeFields.map((f) => [f, prefixes[f]?.trim() ? { prefix: prefixes[f].trim() } : true]))
        : activeFields;
    }
    if (idField && idField !== 'id') opts.idField = idField;
    return opts;
  };

  const canSend = parsed.ok && !sending && (mode === 'deanonymize' || activeFields.length > 0);

  const post = async (path, body) => {
    const res = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
    return { status: res.status, ok: res.ok, payload };
  };

  const send = async () => {
    if (!canSend) return;
    const options = buildOptions();
    const path = `/pseudonymization/${mode}`;
    const records = parsed.records;
    setSending(true);
    const started = performance.now();
    let entry;
    try {
      if (!batched) {
        entry = await post(path, { ...options, data: parsed.value });
      } else {
        // Large data: send in chunks so each request stays small, and show progress
        const merged = [];
        entry = null;
        for (let i = 0; i < records.length; i += CHUNK_SIZE) {
          setProgress({ done: i, total: records.length });
          const r = await post(path, { ...options, data: records.slice(i, i + CHUNK_SIZE) });
          if (!r.ok) {
            const msg = r.payload?.message ?? 'Request failed';
            entry = { ...r, payload: { ...r.payload, message: `Records ${i + 1}–${Math.min(i + CHUNK_SIZE, records.length)}: ${msg}` } };
            break;
          }
          merged.push(...r.payload);
        }
        entry ??= { status: 201, ok: true, payload: merged };
      }
    } catch (e) {
      entry = { status: 'Network error', ok: false, payload: { message: e.message } };
    }
    const full = {
      ...entry,
      ms: Math.round(performance.now() - started),
      mode,
      path,
      body: { ...options, data: parsed.value },
      at: new Date(),
      records: records.length,
      chunks: batched ? Math.ceil(records.length / CHUNK_SIZE) : 1,
      sourceName: file?.name ?? null,
      sourceFormat: file?.format ?? 'json',
      columns: keys,
    };
    setResult(full);
    setSending(false);
    setProgress(null);
    if (!entry.ok) setView('json');
    else if (view !== 'table') setView('table');
    onResult?.(full);
  };
  sendRef.current = send;

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        sendRef.current?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---------- Output ---------- */

  const outputRecords = useMemo(() => {
    if (!result?.ok) return null;
    const list = Array.isArray(result.payload) ? result.payload : [result.payload];
    return list.map((r) => r?.anonymized_object ?? r?.deanonymized_object).filter(Boolean);
  }, [result]);

  const outputName = (ext) => {
    const base = (result.sourceName ?? 'records').replace(/\.(csv|json)$/i, '').replace(/\.(anonymized|restored)$/, '');
    return `${base}.${result.mode === 'anonymize' ? 'anonymized' : 'restored'}.${ext}`;
  };

  const download = (format) => {
    if (!outputRecords) return;
    if (format === 'csv') downloadFile(outputName('csv'), toCsv(outputRecords, result.columns), 'text/csv;charset=utf-8');
    else downloadFile(outputName('json'), pretty(Array.isArray(result.body.data) ? outputRecords : outputRecords[0]), 'application/json');
  };

  const reuseOutput = () => {
    if (!outputRecords) return;
    if (file) {
      setFile({ ...file, name: outputName(file.format), records: outputRecords });
    } else {
      setDataText(pretty(Array.isArray(result.body.data) ? outputRecords : outputRecords[0]));
    }
    setMode(result.mode === 'anonymize' ? 'deanonymize' : 'anonymize');
    notify(result.mode === 'anonymize' ? 'Tokens loaded — ready to deanonymize' : 'Originals loaded — ready to anonymize');
  };

  const curl = useMemo(() => {
    if (!result) return '';
    const data = result.body.data;
    const many = Array.isArray(data) && data.length > 3;
    const body = { ...result.body, data: many ? data.slice(0, 3) : data };
    const note = many ? `# Showing the first 3 of ${data.length.toLocaleString()} records\n` : '';
    return `${note}curl -X POST ${window.location.origin}${apiBase}${result.path} \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`;
  }, [result, apiBase]);

  const jsonPreview = useMemo(() => {
    if (!result) return null;
    const p = result.payload;
    const truncated = Array.isArray(p) && p.length > JSON_PREVIEW;
    return { html: highlightJson(truncated ? p.slice(0, JSON_PREVIEW) : p), truncated, total: Array.isArray(p) ? p.length : 1 };
  }, [result]);

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(`${what} copied`);
    } catch {
      notify('Clipboard not available');
    }
  };

  return (
    <div className="playground">
      {/* ---------- Request ---------- */}
      <div
        className={`card dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
        }}
        onDrop={onDrop}
      >
        {dragging && (
          <div className="drop-overlay">
            <UploadIcon size={28} />
            <div>Drop a .csv or .json file</div>
          </div>
        )}

        <div className="card-head">
          <div className="seg" role="tablist" aria-label="Operation">
            <button className={mode === 'anonymize' ? 'on' : ''} onClick={() => setMode('anonymize')}>
              <LockIcon size={14} /> Anonymize
            </button>
            <button className={mode === 'deanonymize' ? 'on' : ''} onClick={() => setMode('deanonymize')}>
              <UnlockIcon size={14} /> Deanonymize
            </button>
          </div>
          <select
            className="input"
            style={{ width: 'auto', height: 32 }}
            value=""
            onChange={(e) => e.target.value && loadSample(e.target.value)}
            aria-label="Load sample"
          >
            <option value="">Load sample…</option>
            {Object.entries(SAMPLES).map(([k, s]) => (
              <option key={k} value={k}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="section">
          <div className="section-title">
            <span>Data</span>
            <div className="row" style={{ gap: 4 }}>
              {!file && (
                <button className="btn btn-ghost btn-sm" disabled={!parsed.ok} onClick={() => setDataText(pretty(parsed.value))}>
                  <SparkIcon size={13} /> Format
                </button>
              )}
              <button className="btn btn-sm" onClick={() => fileInput.current?.click()}>
                <UploadIcon size={13} /> Upload CSV / JSON
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.json,text/csv,application/json"
                hidden
                onChange={(e) => {
                  openFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          {file ? (
            <FileCard file={file} onReplace={() => fileInput.current?.click()} onRemove={() => setFile(null)} />
          ) : (
            <>
              <div className={`editor${parsed.ok ? '' : ' invalid'}`}>
                <div className="gutter" aria-hidden="true">
                  {Array.from({ length: Math.min(lineCount, 2000) }, (_, i) => (
                    <div key={i}>{i + 1}</div>
                  ))}
                </div>
                <textarea
                  value={dataText}
                  onChange={(e) => setDataText(e.target.value)}
                  spellCheck={false}
                  rows={Math.min(Math.max(lineCount, 14), 26)}
                  aria-label="JSON data"
                />
              </div>
              <div className="editor-status">
                {parsed.ok ? (
                  <>
                    <span className="pill pill-success">
                      <CheckIcon size={12} /> Valid JSON
                    </span>
                    <span className="muted">
                      {plural(parsed.records.length, 'record')} · {plural(keys.length, 'field')}
                    </span>
                  </>
                ) : (
                  <span className="pill pill-danger" title={parsed.error}>
                    <AlertIcon size={12} /> {parsed.error}
                  </span>
                )}
                <span className="spacer" />
                <span className="hint">or drop a file here</span>
              </div>
            </>
          )}
        </div>

        <div className="section">
          <div className="section-title">
            <span>
              Fields to {mode === 'anonymize' ? 'pseudonymize' : 'restore'}
              <span className="muted" style={{ fontWeight: 500, marginLeft: 8 }}>
                {activeFields.length} selected
              </span>
            </span>
            <div className="row" style={{ gap: 4 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set(keys.filter((k) => k !== idField)))}>
                All
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
                None
              </button>
            </div>
          </div>
          {keys.length ? (
            <div className="chips">
              {keys.map((k) =>
                k === idField ? (
                  <span key={k} className="chip id" title="Identity field — tokens are scoped to its value">
                    <KeyGlyph /> {k}
                  </span>
                ) : (
                  <button key={k} className={`chip${selected.has(k) ? ' on' : ''}`} onClick={() => toggle(k)} aria-pressed={selected.has(k)}>
                    <span className="chip-check">{selected.has(k) ? <CheckIcon size={13} /> : <span style={{ fontSize: 15 }}>+</span>}</span>
                    {k}
                  </button>
                )
              )}
            </div>
          ) : (
            <div className="hint">Enter valid JSON to detect fields.</div>
          )}
          <div className="hint" style={{ marginTop: 10 }}>
            {mode === 'anonymize'
              ? 'Selected fields are replaced with deterministic, identity-scoped tokens.'
              : activeFields.length
                ? 'Only the selected fields will be restored.'
                : 'No fields selected — every token in the record will be restored.'}
          </div>

          <div className="presets">
            <span className="presets-label">
              <BookmarkIcon size={13} /> Presets
            </span>
            {presets.map((p) => (
              <span key={p.name} className="preset">
                <button className="preset-apply" onClick={() => applyPreset(p)} title={`${p.fields.join(', ')} · id: ${p.idField ?? 'id'}`}>
                  {p.name}
                </button>
                <button className="preset-del" onClick={() => deletePreset(p.name)} aria-label={`Delete preset ${p.name}`}>
                  <XIcon size={11} />
                </button>
              </span>
            ))}
            {presetName === null ? (
              <button className="btn btn-ghost btn-sm" disabled={!activeFields.length} onClick={() => setPresetName('')}>
                + Save current
              </button>
            ) : (
              <form
                className="row"
                style={{ gap: 6 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  saveCurrentPreset();
                }}
              >
                <input
                  autoFocus
                  className="input"
                  style={{ height: 30, width: 160 }}
                  placeholder="Preset name"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setPresetName(null)}
                />
                <button className="btn btn-sm btn-primary" type="submit" disabled={!presetName.trim()}>
                  Save
                </button>
                <button className="btn btn-sm btn-ghost" type="button" onClick={() => setPresetName(null)}>
                  Cancel
                </button>
              </form>
            )}
            {!presets.length && presetName === null && <span className="hint">Save a field selection to reuse it.</span>}
          </div>
        </div>

        <div className="section">
          <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 14 }}>
            <div style={{ minWidth: 160 }}>
              <label className="field-label" htmlFor="idField">
                Identity field
              </label>
              <select id="idField" className="input" value={idField} onChange={(e) => setIdField(e.target.value)}>
                {(keys.includes(idField) ? keys : [idField, ...keys]).map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            {mode === 'anonymize' && activeFields.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowPrefixes((v) => !v)}>
                {showPrefixes ? 'Hide' : 'Customize'} token prefixes
              </button>
            )}
          </div>
          {mode === 'anonymize' && showPrefixes && activeFields.length > 0 && (
            <div className="prefix-grid" style={{ marginTop: 14 }}>
              {activeFields.map((f) => (
                <div key={f} className="prefix-row">
                  <label htmlFor={`pfx-${f}`}>{f}</label>
                  <input
                    id={`pfx-${f}`}
                    className="input mono"
                    style={{ height: 32, fontSize: 12.5 }}
                    placeholder={`${f.toUpperCase()}_`}
                    value={prefixes[f] ?? ''}
                    onChange={(e) => setPrefixes((p) => ({ ...p, [f]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="section">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span className="hint mono">
              POST /pseudonymization/{mode}
              {batched && ` · ${Math.ceil(parsed.records.length / CHUNK_SIZE)} batches of ${CHUNK_SIZE}`}
            </span>
            <button className="btn btn-primary btn-lg" onClick={send} disabled={!canSend}>
              {sending ? <SpinnerIcon /> : mode === 'anonymize' ? <LockIcon /> : <UnlockIcon />}
              {sending ? 'Sending…' : mode === 'anonymize' ? 'Anonymize' : 'Deanonymize'}
              <span className="kbd">⌘↵</span>
            </button>
          </div>
          {progress && (
            <div style={{ marginTop: 14 }}>
              <div className="progress">
                <div className="progress-bar" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
              <div className="hint" style={{ marginTop: 6 }}>
                {progress.done.toLocaleString()} / {plural(progress.total, 'record')} sent
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---------- Response ---------- */}
      <div className="card" style={{ position: 'sticky', top: 76 }}>
        <div className="card-head">
          <div className="row">
            <h3 className="card-title">Response</h3>
            {result && (
              <>
                <span className={`pill ${result.ok ? 'pill-success' : 'pill-danger'}`}>
                  <span className="dot" /> {result.status}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {result.ms.toLocaleString()} ms{result.chunks > 1 ? ` · ${result.chunks} requests` : ''}
                </span>
              </>
            )}
          </div>
          {result && (
            <div className="seg">
              {result.ok && (
                <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>
                  Table
                </button>
              )}
              <button className={view === 'json' ? 'on' : ''} onClick={() => setView('json')}>
                JSON
              </button>
              <button className={view === 'curl' ? 'on' : ''} onClick={() => setView('curl')}>
                cURL
              </button>
            </div>
          )}
        </div>

        <div className="card-body">
          {!result && !sending && (
            <div className="empty">
              <div className="empty-icon">
                <PlayIcon size={22} />
              </div>
              <div style={{ color: 'var(--text)', fontWeight: 600 }}>No request sent yet</div>
              <div style={{ maxWidth: 320 }}>
                Choose the fields to protect and hit <b>{mode === 'anonymize' ? 'Anonymize' : 'Deanonymize'}</b>. The API
                response will appear here.
              </div>
            </div>
          )}

          {sending && !result && (
            <div className="grid" style={{ gap: 10 }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton" style={{ height: 34, opacity: 1 - i * 0.18 }} />
              ))}
            </div>
          )}

          {result && !result.ok && (
            <div className="banner banner-danger" style={{ marginBottom: 14 }}>
              <AlertIcon size={16} style={{ flex: 'none', marginTop: 1 }} />
              <div>
                <b>Request failed.</b> {String(result.payload?.message ?? result.payload?.error ?? 'Unknown error')}
              </div>
            </div>
          )}

          {result?.ok && outputRecords?.length > 0 && (
            <div className="result-actions">
              <span className="hint">
                {plural(outputRecords.length, 'record')} {result.mode === 'anonymize' ? 'anonymized' : 'restored'}
              </span>
              <span className="spacer" />
              <button className="btn btn-sm" onClick={() => download('csv')}>
                <DownloadIcon size={13} /> CSV
              </button>
              <button className="btn btn-sm" onClick={() => download('json')}>
                <DownloadIcon size={13} /> JSON
              </button>
              <button className="btn btn-sm" onClick={reuseOutput} title="Load the output as the new input">
                <ReturnIcon size={13} /> Use as input
              </button>
            </div>
          )}

          {result && view === 'table' && result.ok && <ResultTable result={result} />}

          {result && view === 'json' && (
            <>
              <CodeBlock html={jsonPreview.html} onCopy={() => copy(pretty(result.payload), 'Response')} />
              {jsonPreview.truncated && (
                <div className="hint" style={{ marginTop: 8 }}>
                  Showing the first {JSON_PREVIEW} of {jsonPreview.total.toLocaleString()} results. Copy or download for the full output.
                </div>
              )}
            </>
          )}

          {result && view === 'curl' && <CodeBlock html={escapeHtml(curl)} onCopy={() => copy(curl, 'cURL command')} />}
        </div>
      </div>
    </div>
  );
}

function FileCard({ file, onReplace, onRemove }) {
  const preview = file.records.slice(0, 5);
  return (
    <div className="file-card">
      <div className="file-head">
        <span className="file-icon">
          <FileIcon size={18} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="file-name">{file.name}</div>
          <div className="hint">
            {file.format.toUpperCase()} · {plural(file.records.length, 'record')} · {plural(file.columns.length, 'column')}
          </div>
        </div>
        <span className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={onReplace}>
          Replace
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onRemove} aria-label="Remove file">
          <XIcon size={14} />
        </button>
      </div>
      <div className="table-wrap">
        <table className="table compact">
          <thead>
            <tr>
              {file.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((r, i) => (
              <tr key={i}>
                {file.columns.map((c) => (
                  <td key={c}>
                    <Value v={r[c]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {file.records.length > preview.length && (
        <div className="hint" style={{ padding: '8px 12px' }}>
          Preview of the first {preview.length} rows
        </div>
      )}
    </div>
  );
}

function KeyGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M17 6l3 3" />
    </svg>
  );
}

function CodeBlock({ html, onCopy }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <pre className="code" dangerouslySetInnerHTML={{ __html: html }} />
      <button
        className="btn btn-sm"
        style={{ position: 'absolute', top: 8, right: 8 }}
        onClick={() => {
          onCopy();
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />} {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function ResultTable({ result }) {
  const inputs = Array.isArray(result.body.data) ? result.body.data : [result.body.data];
  const outputs = Array.isArray(result.payload) ? result.payload : [result.payload];
  const idField = result.body.idField ?? 'id';
  const shown = outputs.slice(0, PREVIEW_RECORDS);

  return (
    <div>
      {shown.map((out, i) => {
        const after = out.anonymized_object ?? out.deanonymized_object ?? {};
        const before = inputs[i] ?? {};
        const changed = Object.keys(after).filter((k) => after[k] !== before[k]).length;
        return (
          <div className="record" key={i}>
            <div className="record-head">
              <span>
                <span className="muted">Record {i + 1}</span>
                {before[idField] !== undefined && (
                  <span className="mono" style={{ marginLeft: 8, fontWeight: 600 }}>
                    {idField}: {String(before[idField])}
                  </span>
                )}
              </span>
              <span className={`pill ${changed ? 'pill-accent' : 'pill-neutral'}`}>
                {changed} field{changed === 1 ? '' : 's'} {result.mode === 'anonymize' ? 'tokenized' : 'restored'}
              </span>
            </div>
            <table className="diff">
              <tbody>
                {Object.keys(after).map((k) => {
                  const isChanged = after[k] !== before[k];
                  return (
                    <tr key={k} className={isChanged ? 'changed' : ''}>
                      <td>{k}</td>
                      <td>
                        <Value v={before[k]} dim={!isChanged} />
                      </td>
                      <td className="arrow">{isChanged ? <ArrowRightIcon size={14} /> : ''}</td>
                      <td>{isChanged ? <Value v={after[k]} /> : <span className="unchanged">unchanged</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      {outputs.length > shown.length && (
        <div className="hint" style={{ marginTop: 12, textAlign: 'center' }}>
          Showing {shown.length} of {outputs.length.toLocaleString()} records — download for the full result.
        </div>
      )}
    </div>
  );
}

function Value({ v, dim }) {
  if (isToken(v)) return <span className="token">{v}</span>;
  const text = v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return <span style={{ color: dim ? 'var(--text-3)' : 'var(--text)', wordBreak: 'break-word' }}>{text}</span>;
}
