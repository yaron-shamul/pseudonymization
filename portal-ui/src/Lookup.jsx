import React, { useState } from 'react';
import { isToken } from './json.js';
import { SearchIcon, SpinnerIcon, AlertIcon, CopyIcon } from './icons.jsx';

const SAMPLE = { id: 'U100', tokens: '' };

export default function Lookup({ apiBase, onResult, notify }) {
  const [idField, setIdField] = useState('id');
  const [recordId, setRecordId] = useState(SAMPLE.id);
  const [tokensText, setTokensText] = useState(SAMPLE.tokens);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  const tokens = [...new Set(tokensText.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean))];
  const canLookup = recordId.trim() && tokens.length > 0 && !busy;

  const lookup = async (e) => {
    e?.preventDefault();
    if (!canLookup) return;
    const valid = tokens.filter(isToken);
    // Each token goes into its own placeholder field; tokens resolve regardless of the field name they sit in
    const slots = valid.map((_, i) => `__t${i}`);
    const data = { [idField]: recordId.trim(), ...Object.fromEntries(valid.map((t, i) => [slots[i], t])) };
    const body = { action: 'deanonymize', data, fields: slots, ...(idField !== 'id' ? { idField } : {}) };

    setBusy(true);
    setError(null);
    const started = performance.now();
    let payload = null;
    let status = 0;
    let ok = false;
    if (valid.length) {
      try {
        const res = await fetch(`${apiBase}/pseudonymization`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client': 'lookup' },
          body: JSON.stringify(body),
        });
        status = res.status;
        ok = res.ok;
        payload = await res.json().catch(() => null);
        if (!ok) setError(payload?.message ?? `HTTP ${status}`);
      } catch (err) {
        setError(err.message);
      }
    }

    setRows(
      tokens.map((t) => {
        if (!isToken(t)) return { token: t, status: 'invalid' };
        const key = `__t${valid.indexOf(t)}`;
        const mapping = payload?.mappings_used?.[key];
        return mapping
          ? { token: t, status: 'found', field: mapping.field_name, value: payload.deanonymized_object[key] }
          : { token: t, status: ok ? 'missing' : 'error' };
      })
    );
    setBusy(false);
    if (valid.length) {
      onResult?.({ mode: 'deanonymize', path: '/pseudonymization', body: { ...body, fields: [] }, ok, status, payload, ms: Math.round(performance.now() - started), at: new Date(), records: 1, source: 'lookup' });
    }
  };

  const found = rows?.filter((r) => r.status === 'found').length ?? 0;

  return (
    <div className="grid" style={{ gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))', alignItems: 'start' }}>
      <form className="card" onSubmit={lookup}>
        <div className="card-head">
          <h3 className="card-title">Find the original value</h3>
        </div>
        <div className="card-body grid" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: 2 }}>
              <label className="field-label" htmlFor="lk-id">
                Record ID
              </label>
              <input id="lk-id" className="input mono" value={recordId} onChange={(e) => setRecordId(e.target.value)} placeholder="e.g. U100" />
            </div>
            <div style={{ flex: 1 }}>
              <label className="field-label" htmlFor="lk-idfield">
                ID field name
              </label>
              <input id="lk-idfield" className="input mono" value={idField} onChange={(e) => setIdField(e.target.value || 'id')} />
            </div>
          </div>
          <div>
            <label className="field-label" htmlFor="lk-tokens">
              Tokens
            </label>
            <textarea
              id="lk-tokens"
              className="input mono"
              style={{ height: 'auto', minHeight: 120, padding: 10, resize: 'vertical', lineHeight: 1.6 }}
              placeholder={'NAME_C68E821\nEMAIL_06FEE7A'}
              value={tokensText}
              onChange={(e) => setTokensText(e.target.value)}
              onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && lookup(e)}
            />
            <div className="hint" style={{ marginTop: 6 }}>
              One per line, or separated by commas. {tokens.length > 0 && `${tokens.length} token${tokens.length === 1 ? '' : 's'}.`}
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span className="hint">A token only resolves under the ID it was issued for.</span>
            <button className="btn btn-primary" type="submit" disabled={!canLookup}>
              {busy ? <SpinnerIcon size={15} /> : <SearchIcon size={15} />} Look up
            </button>
          </div>
        </div>
      </form>

      <div className="card">
        <div className="card-head">
          <h3 className="card-title">Results</h3>
          {rows && (
            <span className={`pill ${found === rows.length ? 'pill-success' : found ? 'pill-warn' : 'pill-neutral'}`}>
              {found} / {rows.length} found
            </span>
          )}
        </div>
        {error && (
          <div className="banner banner-danger" style={{ margin: 16 }}>
            <AlertIcon size={16} style={{ flex: 'none', marginTop: 1 }} />
            <div>{error}</div>
          </div>
        )}
        {rows ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Field</th>
                  <th>Original value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.token}>
                    <td>
                      <span className="token">{r.token}</span>
                    </td>
                    <td className="mono muted">{r.field ?? '—'}</td>
                    <td>
                      {r.status === 'found' ? (
                        <span className="row" style={{ gap: 8 }}>
                          <span style={{ fontWeight: 600 }}>{r.value}</span>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ height: 24, padding: '0 6px' }}
                            aria-label="Copy value"
                            onClick={() => navigator.clipboard?.writeText(r.value).then(() => notify('Value copied'), () => {})}
                          >
                            <CopyIcon size={12} />
                          </button>
                        </span>
                      ) : (
                        <span className={`pill ${r.status === 'invalid' ? 'pill-warn' : 'pill-neutral'}`}>
                          {r.status === 'invalid' ? 'Not a token' : r.status === 'missing' ? 'Not found for this ID' : 'Lookup failed'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <div className="empty-icon">
              <SearchIcon size={22} />
            </div>
            <div>Enter a record ID and one or more tokens.</div>
          </div>
        )}
      </div>
    </div>
  );
}
