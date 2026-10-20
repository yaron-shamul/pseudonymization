import React, { useCallback, useEffect, useRef, useState } from 'react';
import Playground, { CodeBlock } from './Playground.jsx';
import { highlightJson, escapeHtml } from './json.js';
import Lookup from './Lookup.jsx';
import Usage, { StackedBars, SERIES } from './Usage.jsx';
import {
  ShieldIcon,
  GridIcon,
  PlayIcon,
  KeyIcon,
  ListIcon,
  ToolIcon,
  RefreshIcon,
  UsersIcon,
  DatabaseIcon,
  GaugeIcon,
  AlertIcon,
  SpinnerIcon,
  ArrowRightIcon,
  LockIcon,
  UnlockIcon,
  SearchIcon,
  ChartIcon,
} from './icons.jsx';

const API_BASE = '/api';

const PAGES = [
  { id: 'overview', label: 'Overview', icon: GridIcon, desc: 'Health and usage of the pseudonymization service.' },
  { id: 'playground', label: 'API Playground', icon: PlayIcon, desc: 'Send real data to the API, choose which fields to protect, and inspect the response.' },
  { id: 'lookup', label: 'Token Lookup', icon: SearchIcon, desc: 'Paste tokens with their record ID to see the original values.' },
  { id: 'usage', label: 'Usage', icon: ChartIcon, desc: 'API traffic over time: records anonymized and deanonymized, and errors.' },
  { id: 'mappings', label: 'Token Mappings', icon: KeyIcon, desc: 'How sample records map to identity-scoped tokens.' },
  { id: 'activity', label: 'Activity', icon: ListIcon, desc: 'Every request to the API, from any client. Open a failed one to inspect or reproduce it.' },
  { id: 'admin', label: 'Admin', icon: ToolIcon, desc: 'Seed demo data and inspect raw service endpoints.' },
];

// Recent requests come from the API's activity log, so calls from any client show up.
const ACTIVITY_REFRESH_MS = 15_000;
const ACTIVITY_MAX = 200;

async function api(path, options) {
  const res = await fetch(`${API_BASE}${path}`, options);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message ? `${res.status}: ${body.message}` : `HTTP ${res.status}`);
  return body;
}

export default function App() {
  const [page, setPage] = useState(() => {
    const h = window.location.hash.slice(1);
    return PAGES.some((p) => p.id === h) ? h : 'overview';
  });
  const [health, setHealth] = useState(null);
  const [stats, setStats] = useState(null);
  const [demo, setDemo] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [history, setHistory] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState(null);
  const [prefill, setPrefill] = useState(null); // a failed request loaded into the playground
  const toastTimer = useRef();

  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const go = (id) => {
    setPage(id);
    window.history.pushState(null, '', `#${id}`);
  };

  // Back/forward buttons and links to #page switch pages too
  useEffect(() => {
    const onNav = () => {
      const h = window.location.hash.slice(1);
      if (PAGES.some((p) => p.id === h)) setPage(h);
    };
    window.addEventListener('popstate', onNav);
    window.addEventListener('hashchange', onNav);
    return () => {
      window.removeEventListener('popstate', onNav);
      window.removeEventListener('hashchange', onNav);
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setRefreshKey((k) => k + 1);
    try {
      const [h, s, d] = await Promise.all([api('/admin/health'), api('/admin/stats'), api('/admin/demo')]);
      setHealth(h);
      setStats(s);
      setDemo(d);
      setError(null);
    } catch (e) {
      setHealth(null);
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const refreshStats = useCallback(() => api('/admin/stats').then(setStats).catch(() => {}), []);

  const seed = async () => {
    setSeeding(true);
    try {
      const r = await api('/admin/demo-seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      notify(`Seeded ${r.length} demo records`);
      await refresh();
    } catch (e) {
      notify(`Seed failed — ${e.message}`);
    }
    setSeeding(false);
  };

  const loadActivity = useCallback(
    () => api(`/admin/activity?limit=${ACTIVITY_MAX}`).then((r) => setHistory(r.entries)).catch(() => {}),
    []
  );

  useEffect(() => {
    loadActivity();
    const t = setInterval(loadActivity, ACTIVITY_REFRESH_MS);
    return () => clearInterval(t);
  }, [loadActivity, refreshKey]);

  const onResult = useCallback(
    (entry) => {
      loadActivity();
      if (entry.ok) refreshStats();
    },
    [loadActivity, refreshStats]
  );

  const current = PAGES.find((p) => p.id === page);
  const online = !!health && !error;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <ShieldIcon size={18} />
          </div>
          <div>
            <div className="brand-name">Pseudonym</div>
            <div className="brand-sub">Data protection portal</div>
          </div>
        </div>
        <div className="nav-label">Workspace</div>
        {PAGES.map((p) => (
          <button key={p.id} className={`nav-item${page === p.id ? ' active' : ''}`} onClick={() => go(p.id)}>
            <p.icon size={16} />
            {p.label}
            {p.id === 'activity' && history.length > 0 && <span className="nav-badge">{history.length}</span>}
          </button>
        ))}
        <div className="sidebar-footer">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className={`pill ${online ? 'pill-success' : 'pill-danger'}`}>
              <span className={`dot${online ? ' dot-live' : ''}`} />
              {online ? 'API online' : 'API offline'}
            </span>
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            {health?.service ?? 'pseudonymization-admin'}
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="crumbs">
            Portal / <b>{current.label}</b>
          </div>
          <button className="btn btn-sm" onClick={refresh} disabled={loading}>
            {loading ? <SpinnerIcon size={14} /> : <RefreshIcon size={14} />} Refresh
          </button>
        </div>

        <div className="content">
          <div className="page-head">
            <div>
              <h1 className="page-title">{current.label}</h1>
              <p className="page-desc">{current.desc}</p>
            </div>
            {page === 'overview' && (
              <button className="btn btn-primary" onClick={() => go('playground')}>
                Try the API <ArrowRightIcon size={15} />
              </button>
            )}
          </div>

          {error && (
            <div className="banner banner-danger" style={{ marginBottom: 20 }}>
              <AlertIcon size={16} style={{ flex: 'none', marginTop: 1 }} />
              <div>
                <b>Can’t reach the API.</b> {error}. Check that the <span className="mono">api</span> container is running.
              </div>
            </div>
          )}

          {page === 'overview' && <Overview stats={stats} history={history} loading={loading && !stats} go={go} refreshKey={refreshKey} />}
          <div hidden={page !== 'playground'}>
            <Playground apiBase={API_BASE} onResult={onResult} notify={notify} prefill={prefill} />
          </div>
          {page === 'lookup' && <Lookup apiBase={API_BASE} onResult={onResult} notify={notify} />}
          {page === 'usage' && <Usage apiBase={API_BASE} />}
          {page === 'mappings' && <Mappings demo={demo} />}
          {page === 'activity' && (
            <Activity
              history={history}
              go={go}
              notify={notify}
              reproduce={(id, request) => {
                setPrefill({ id, request, nonce: Date.now() });
                go('playground');
              }}
            />
          )}
          {page === 'admin' && <Admin health={health} stats={stats} seed={seed} seeding={seeding} />}
        </div>
      </main>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ---------------- Overview ---------------- */

const OVERVIEW_REFRESH_MS = 15_000;
const STATE_LABEL = { up: 'Up', down: 'Down' };
const STATE_PILL = { up: 'pill-success', down: 'pill-danger' };

function formatUptime(sec) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}

function Overview({ stats, history, loading, go, refreshKey }) {
  const [status, setStatus] = useState(null);
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.allSettled([api('/admin/status'), api('/admin/usage?range=24h')]).then(([st, us]) => {
        if (!alive) return;
        setStatus(st.status === 'fulfilled' ? st.value : null);
        if (us.status === 'fulfilled') setUsage(us.value);
      });
    load();
    const t = setInterval(load, OVERVIEW_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [refreshKey]);

  const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : '—');
  const t = usage?.totals;
  const records24h = t ? t.anonymize + t.deanonymize : undefined;
  const errorRate = t?.requests ? (t.errors / t.requests) * 100 : 0;

  const components = [
    {
      name: 'API',
      state: status ? status.api.state : 'down',
      detail: status ? `Uptime ${formatUptime(status.api.uptimeSeconds)}` : 'Not reachable',
    },
    {
      name: 'Store',
      state: status?.store.state ?? 'down',
      detail: status ? `In memory · ${fmt(status.store.collisions)} collisions` : '—',
    },
  ];

  const kpis = [
    { label: 'Token mappings', value: fmt(stats?.totalMappings), foot: 'Stored field → token pairs', icon: DatabaseIcon },
    { label: 'Identities', value: fmt(stats?.totalIdentities), foot: 'Distinct record IDs', icon: UsersIcon },
    { label: 'Records · 24h', value: fmt(records24h), foot: t ? `${fmt(t.anonymize)} anonymized · ${fmt(t.deanonymize)} deanonymized` : '', icon: ChartIcon },
    {
      label: 'Error rate · 24h',
      value: t ? `${errorRate > 0 && errorRate < 10 ? errorRate.toFixed(1) : Math.round(errorRate)}%` : '—',
      foot: t ? `${fmt(t.errors)} of ${fmt(t.requests)} requests` : '',
      icon: GaugeIcon,
    },
  ];

  return (
    <div className="grid" style={{ gap: 20 }}>
      <div className="status-strip" aria-label="System status">
        {components.map((c) => (
          <div className="status-item" key={c.name}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="status-name">{c.name}</span>
              <span className={`pill ${STATE_PILL[c.state]}`}>
                <span className={`dot${c.state === 'up' ? ' dot-live' : ''}`} />
                {STATE_LABEL[c.state]}
              </span>
            </div>
            <div className="status-detail" title={c.detail}>
              {c.detail}
            </div>
          </div>
        ))}
      </div>

      <div className="stats">
        {kpis.map((c) => (
          <div className="card stat" key={c.label}>
            <div className="stat-top">
              {c.label}
              <span className="stat-icon">
                <c.icon size={16} />
              </span>
            </div>
            {loading ? (
              <div className="skeleton" style={{ height: 34, width: '60%', marginTop: 12 }} />
            ) : (
              <div className="stat-value">{c.value}</div>
            )}
            <div className="stat-foot">{c.foot}</div>
          </div>
        ))}
      </div>

      <div className="overview-split">
        <div className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">Last 24 hours</h3>
              <div className="card-sub">Records per 15 minutes</div>
            </div>
            <div className="row" style={{ gap: 14 }}>
              <div className="legend">
                {SERIES.map((s) => (
                  <span key={s.key} className="legend-item">
                    <span className="legend-swatch" style={{ background: s.color }} />
                    {s.label}
                  </span>
                ))}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => go('usage')}>
                Usage <ArrowRightIcon size={13} />
              </button>
            </div>
          </div>
          <div className="card-body">{usage ? <StackedBars data={usage} height={200} /> : <div className="skeleton" style={{ height: 200 }} />}</div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3 className="card-title">Recent activity</h3>
            {history.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={() => go('activity')}>
                View all <ArrowRightIcon size={13} />
              </button>
            )}
          </div>
          {history.length ? (
            history.slice(0, 6).map((h, i) => <HistoryRow key={i} h={h} compact />)
          ) : (
            <div className="empty" style={{ padding: 36 }}>
              <div>No requests yet.</div>
              <button className="btn btn-sm" onClick={() => go('playground')}>
                Open the playground
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3 className="card-title">How a request is processed</h3>
        </div>
        <div className="card-body">
          <div className="pipeline">
            {[
              ['Send data + fields', 'The caller posts records and names the fields to protect.'],
              ['Scope by identity', 'A SHA-256 hash of the record ID scopes every token to that record.'],
              ['Tokenize', 'HMAC-SHA256 yields a deterministic token like NAME_8FA4C91.'],
              ['Encrypt & store', 'Originals are sealed with AES-256-GCM for later restore.'],
            ].map(([title, d], i) => (
              <div className="step" key={title}>
                <div className="step-num">{i + 1}</div>
                <h4>{title}</h4>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Mappings ---------------- */

function Mappings({ demo }) {
  if (!demo) return <div className="card empty">Loading sample mappings…</div>;
  const rows = demo.anonymized.flatMap((r, i) =>
    Object.values(r.mappings).map((m) => ({ id: demo.source[i]?.id, ...m }))
  );
  return (
    <div className="grid" style={{ gap: 20 }}>
      <div className="stats">
        <div className="card stat">
          <div className="stat-top">Sample records</div>
          <div className="stat-value">{demo.summary.totalRecords}</div>
        </div>
        <div className="card stat">
          <div className="stat-top">Identities</div>
          <div className="stat-value">{demo.summary.totalIdentities}</div>
        </div>
        <div className="card stat">
          <div className="stat-top">Tokens issued</div>
          <div className="stat-value">{demo.summary.totalMappings}</div>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h3 className="card-title">Field → token</h3>
          <span className="card-sub">Same name under different IDs gets different tokens</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Record</th>
                <th>Field</th>
                <th>Original</th>
                <th>Token</th>
                <th>Identity hash</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m, i) => (
                <tr key={i}>
                  <td className="mono" style={{ fontWeight: 600 }}>{m.id}</td>
                  <td className="mono muted">{m.field_name}</td>
                  <td>{m.original_value}</td>
                  <td>
                    <span className="token">{m.token}</span>
                  </td>
                  <td className="mono muted" title={m.identity_hash}>
                    {m.identity_hash.slice(0, 12)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Activity ---------------- */

const SOURCE_LABEL = { portal: 'Portal', lookup: 'Token lookup', api: 'API' };
const relTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function when(iso) {
  const d = new Date(iso);
  const sec = Math.round((d.getTime() - Date.now()) / 1000);
  if (sec > -60) return 'just now';
  if (sec > -3600) return relTime.format(Math.round(sec / 60), 'minute');
  if (sec > -86400) return relTime.format(Math.round(sec / 3600), 'hour');
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function HistoryRow({ h, compact, open, onToggle, notify, reproduce }) {
  const known = h.action === 'anonymize' || h.action === 'deanonymize';
  // Token lookups carry placeholder field names; they mean nothing to the reader
  const fields = h.source === 'lookup' ? 'token lookup' : h.fields.length ? h.fields.join(', ') : '—';
  const row = (
    <div
      className={`history-item${onToggle ? ' clickable' : ''}${open ? ' open' : ''}`}
      {...(onToggle && {
        role: 'button',
        tabIndex: 0,
        'aria-expanded': open,
        onClick: onToggle,
        onKeyDown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle()),
      })}
    >
      <span className={`pill ${h.action === 'anonymize' ? 'pill-accent' : 'pill-neutral'}`}>
        {known && (h.action === 'anonymize' ? <LockIcon size={11} /> : <UnlockIcon size={11} />)}
        {h.action}
      </span>
      <span style={{ whiteSpace: 'nowrap' }}>
        {h.records.toLocaleString()} record{h.records === 1 ? '' : 's'}
      </span>
      {!compact && (
        <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          {SOURCE_LABEL[h.source] ?? h.source}
        </span>
      )}
      <span className="muted mono" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
        {fields}
      </span>
      <span className="spacer" />
      {!compact && (
        <span className="muted" style={{ fontSize: 12 }}>
          {h.ms} ms
        </span>
      )}
      <span className={`pill ${h.ok ? 'pill-success' : 'pill-danger'}`}>{h.status}</span>
      <span className="muted" style={{ fontSize: 12, minWidth: 72, textAlign: 'right', whiteSpace: 'nowrap' }} title={new Date(h.at).toLocaleString()}>
        {when(h.at)}
      </span>
      {onToggle && <span className={`chev${open ? ' up' : ''}`} aria-hidden="true">›</span>}
    </div>
  );
  if (!onToggle) return row;
  return (
    <>
      {row}
      {open && <HistoryDetails h={h} notify={notify} reproduce={reproduce} />}
    </>
  );
}

const STATUS_TEXT = { 200: 'OK', 400: 'Bad request', 413: 'Payload too large', 500: 'Server error' };

function HistoryDetails({ h, notify, reproduce }) {
  const [exchange, setExchange] = useState(null); // { request, response } of a failed request
  const [loadError, setLoadError] = useState(null);
  const [showExchange, setShowExchange] = useState(false);

  useEffect(() => {
    if (!h.captured) return;
    let live = true;
    api(`/admin/activity/${h.id}/exchange`)
      .then((x) => live && setExchange(x))
      .catch((e) => live && setLoadError(e.message));
    return () => {
      live = false;
    };
  }, [h.id, h.captured]);

  const items = [
    ['Time', new Date(h.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })],
    ['Status', `${h.status} ${STATUS_TEXT[h.status] ?? ''}`.trim()],
    ['Action', h.action],
    ['Endpoint', h.endpoint && `POST ${h.endpoint}`],
    ['Source', SOURCE_LABEL[h.source] ?? h.source],
    ['Records', h.records.toLocaleString()],
    ['Fields requested', h.fields.length ? h.fields.join(', ') : 'none'],
    ['ID field', h.idField],
    ['Values processed', h.values?.toLocaleString()],
    ['Not resolved', h.unresolved?.toLocaleString()],
    ['Duration', `${h.ms} ms`],
    ['Client', h.userAgent],
    ['Request #', h.id],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '');
  return (
    <div className="history-details">
      {!h.ok && (
        <div className="banner banner-danger" role="alert">
          <strong>Error:</strong> {h.error || 'No message recorded for this request.'}
        </div>
      )}
      {!h.ok && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" disabled={!exchange} onClick={() => reproduce(h.id, exchange.request)}>
            <PlayIcon size={13} /> Reproduce in playground
          </button>
          <button className="btn btn-sm" disabled={!exchange} onClick={() => setShowExchange((v) => !v)} aria-expanded={showExchange}>
            {showExchange ? 'Hide' : 'View'} request &amp; response
          </button>
          <span className="hint">
            {exchange
              ? 'Opens the playground with the same data, action and fields.'
              : loadError
                ? `Couldn’t load the request: ${loadError}`
                : h.captured
                  ? 'Loading the request…'
                  : h.capturedTooLarge
                    ? `The request body (${formatBytes(h.capturedTooLarge)}) was too large to keep.`
                    : 'The request wasn’t kept: only the last 50 failed requests are, and capture may be turned off.'}
          </span>
        </div>
      )}
      {showExchange && exchange && <ExchangeViewer id={h.id} exchange={exchange} notify={notify} />}
      {h.ok && h.unresolved > 0 && (
        <div className="banner banner-warn">
          {h.unresolved.toLocaleString()} value{h.unresolved === 1 ? '' : 's'} in the requested fields stayed as-is: not a token, or a
          token issued for a different record ID.
        </div>
      )}
      <dl className="kv">
        {items.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className={k === 'Client' || k === 'Endpoint' || k === 'Fields requested' ? 'mono' : undefined}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="hint">
        {h.ok
          ? 'Only metadata is logged for successful requests: their data and tokens are never stored.'
          : 'Failed requests keep their request and response (the last 50, in API memory) so they can be inspected and reproduced.'}
      </div>
    </div>
  );
}

function formatBytes(n) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

const HTTP_REASON = { 400: 'Bad Request', 404: 'Not Found', 413: 'Payload Too Large', 500: 'Internal Server Error' };

function ExchangeViewer({ id, exchange, notify }) {
  const [tab, setTab] = useState('request');
  const { request, response } = exchange;
  const reqJson = JSON.stringify(request.body, null, 2);
  const resJson = JSON.stringify(response.body, null, 2);
  const curl = [
    `curl -X ${request.method} ${window.location.origin}${API_BASE}${request.path}`,
    ...Object.entries(request.headers).map(([k, v]) => `  -H '${k}: ${v}'`),
    `  -d '${JSON.stringify(request.body).replace(/'/g, "'\\''")}'`,
  ].join(' \\\n');
  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(`${what} copied`);
    } catch {
      notify('Copy failed: clipboard not available');
    }
  };
  const tabs = {
    request: {
      meta: (
        <>
          <b>{request.method}</b> <span className="mono">{request.path}</span>
          {Object.entries(request.headers).map(([k, v]) => (
            <span key={k} className="mono">
              {k}: {v}
            </span>
          ))}
        </>
      ),
      html: highlightJson(request.body),
      onCopy: () => copy(reqJson, 'Request body'),
    },
    response: {
      meta: (
        <span className="pill pill-danger">
          {response.status} {HTTP_REASON[response.status] ?? ''}
        </span>
      ),
      html: highlightJson(response.body),
      onCopy: () => copy(resJson, 'Response body'),
    },
    curl: { meta: <span>Replay the request from a terminal</span>, html: escapeHtml(curl), onCopy: () => copy(curl, 'cURL command') },
  };
  const t = tabs[tab];
  return (
    <div className="exchange">
      <div className="seg" role="tablist" aria-label={`Request #${id}`}>
        {[
          ['request', 'Request'],
          ['response', 'Response'],
          ['curl', 'cURL'],
        ].map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="exchange-meta">{t.meta}</div>
      <CodeBlock key={tab} html={t.html} onCopy={t.onCopy} />
    </div>
  );
}

const PAGE_SIZE = 20;

function Activity({ history, go, notify, reproduce }) {
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const pages = Math.max(1, Math.ceil(history.length / PAGE_SIZE));
  const current = Math.min(page, pages); // the log can shrink after an API restart
  const start = (current - 1) * PAGE_SIZE;
  const rows = history.slice(start, start + PAGE_SIZE);

  if (!history.length) {
    return (
      <div className="card empty">
        <div className="empty-icon">
          <ListIcon size={22} />
        </div>
        <div style={{ color: 'var(--text)', fontWeight: 600 }}>Nothing here yet</div>
        <div>Requests to the API from any client show up here.</div>
        <button className="btn btn-primary btn-sm" onClick={() => go('playground')}>
          Open the playground
        </button>
      </div>
    );
  }
  const ok = history.filter((h) => h.ok).length;
  const avg = Math.round(history.reduce((a, h) => a + h.ms, 0) / history.length);
  return (
    <div className="grid" style={{ gap: 20 }}>
      <div className="stats">
        <div className="card stat">
          <div className="stat-top">Requests</div>
          <div className="stat-value">{history.length}</div>
        </div>
        <div className="card stat">
          <div className="stat-top">Success rate</div>
          <div className="stat-value">{Math.round((ok / history.length) * 100)}%</div>
        </div>
        <div className="card stat">
          <div className="stat-top">Avg latency</div>
          <div className="stat-value">{avg} ms</div>
        </div>
        <div className="card stat">
          <div className="stat-top">Records processed</div>
          <div className="stat-value">{history.filter((h) => h.ok).reduce((a, h) => a + h.records, 0).toLocaleString()}</div>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="card-title">Request log</h3>
            <div className="card-sub">Click a request for details · all clients · last {ACTIVITY_MAX} requests · failed requests keep their request &amp; response · resets when the API restarts</div>
          </div>
        </div>
        {rows.map((h, i) => {
          const key = h.id ?? `${h.at}-${start + i}`;
          return <HistoryRow
              key={key}
              h={h}
              open={openId === key}
              onToggle={() => setOpenId(openId === key ? null : key)}
              notify={notify}
              reproduce={reproduce}
            />;
        })}
        {pages > 1 && (
          <nav className="pager" aria-label="Request log pages">
            <span className="hint">
              Showing {start + 1}–{start + rows.length} of {history.length}
            </span>
            <div className="row" style={{ gap: 4 }}>
              <button className="btn btn-sm" onClick={() => setPage(current - 1)} disabled={current === 1} aria-label="Previous page">
                ‹ Prev
              </button>
              {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  className={`btn btn-sm pager-num${n === current ? ' on' : ''}`}
                  onClick={() => setPage(n)}
                  aria-current={n === current ? 'page' : undefined}
                >
                  {n}
                </button>
              ))}
              <button className="btn btn-sm" onClick={() => setPage(current + 1)} disabled={current === pages} aria-label="Next page">
                Next ›
              </button>
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}

/* ---------------- Admin ---------------- */

function Admin({ health, stats, seed, seeding }) {
  return (
    <div className="grid" style={{ gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', alignItems: 'start' }}>
      <div className="card">
        <div className="card-head">
          <h3 className="card-title">Demo data</h3>
        </div>
        <div className="card-body">
          <p style={{ marginTop: 0, color: 'var(--text-2)' }}>
            Anonymizes two sample records (<span className="mono">name</span>, <span className="mono">email</span>,{' '}
            <span className="mono">phone</span>) so the stats have something to show.
          </p>
          <button className="btn btn-primary" onClick={seed} disabled={seeding}>
            {seeding ? <SpinnerIcon size={15} /> : <DatabaseIcon size={15} />}
            {seeding ? 'Seeding…' : 'Seed demo data'}
          </button>
          <div className="hint mono" style={{ marginTop: 10 }}>
            POST /admin/demo-seed
          </div>
        </div>
      </div>
      <EndpointCard title="GET /admin/health" data={health} />
      <EndpointCard title="GET /admin/stats" data={stats} />
    </div>
  );
}

function EndpointCard({ title, data }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title mono" style={{ fontSize: 13 }}>
          {title}
        </h3>
        <span className={`pill ${data ? 'pill-success' : 'pill-neutral'}`}>{data ? '200' : '—'}</span>
      </div>
      <div className="card-body">
        <pre className="code" dangerouslySetInnerHTML={{ __html: data ? highlightJson(data) : 'No data' }} />
      </div>
    </div>
  );
}

