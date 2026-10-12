import React, { useCallback, useEffect, useRef, useState } from 'react';
import Playground, { highlightJson } from './Playground.jsx';
import Lookup from './Lookup.jsx';
import Usage from './Usage.jsx';
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
  { id: 'activity', label: 'Activity', icon: ListIcon, desc: 'Requests sent from this browser session.' },
  { id: 'admin', label: 'Admin', icon: ToolIcon, desc: 'Seed demo data and inspect raw service endpoints.' },
];

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
  const [toast, setToast] = useState(null);
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

  const onResult = useCallback(
    (entry) => {
      setHistory((h) => [entry, ...h].slice(0, 50));
      if (entry.ok) refreshStats();
    },
    [refreshStats]
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

          {page === 'overview' && <Overview stats={stats} history={history} loading={loading && !stats} go={go} />}
          <div hidden={page !== 'playground'}>
            <Playground apiBase={API_BASE} onResult={onResult} notify={notify} />
          </div>
          {page === 'lookup' && <Lookup apiBase={API_BASE} onResult={onResult} notify={notify} />}
          {page === 'usage' && <Usage apiBase={API_BASE} />}
          {page === 'mappings' && <Mappings demo={demo} />}
          {page === 'activity' && <Activity history={history} go={go} />}
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

function Overview({ stats, history, loading, go }) {
  const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : '—');
  const cards = [
    { label: 'Token mappings', value: fmt(stats?.totalMappings), foot: 'Stored field → token pairs', icon: DatabaseIcon },
    { label: 'Identities', value: fmt(stats?.totalIdentities), foot: 'Distinct record IDs', icon: UsersIcon },
    { label: 'Token length', value: stats ? `${stats.tokenLength} hex` : '—', foot: 'Per-field suffix', icon: KeyIcon },
    {
      label: 'Token collisions',
      value: fmt(stats?.collisionCount),
      foot: 'Tokens are scoped per ID — no cap on users',
      icon: GaugeIcon,
    },
  ];

  return (
    <div className="grid" style={{ gap: 20 }}>
      <div className="stats">
        {cards.map((c) => (
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
            ].map(([t, d], i) => (
              <div className="step" key={t}>
                <div className="step-num">{i + 1}</div>
                <h4>{t}</h4>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </div>
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
          history.slice(0, 5).map((h, i) => <HistoryRow key={i} h={h} />)
        ) : (
          <div className="empty" style={{ padding: 36 }}>
            <div>No requests yet in this session.</div>
            <button className="btn btn-sm" onClick={() => go('playground')}>
              Open the playground
            </button>
          </div>
        )}
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

function HistoryRow({ h }) {
  const fields = Array.isArray(h.body.fields) ? h.body.fields : Object.keys(h.body.fields ?? {});
  return (
    <div className="history-item">
      <span className={`pill ${h.mode === 'anonymize' ? 'pill-accent' : 'pill-neutral'}`}>
        {h.mode === 'anonymize' ? <LockIcon size={11} /> : <UnlockIcon size={11} />}
        {h.mode}
      </span>
      <span>
        {h.records} record{h.records === 1 ? '' : 's'}
      </span>
      <span className="muted mono" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {fields.length ? fields.join(', ') : 'all tokens'}
      </span>
      <span className="spacer" />
      <span className="muted" style={{ fontSize: 12 }}>
        {h.ms} ms
      </span>
      <span className={`pill ${h.ok ? 'pill-success' : 'pill-danger'}`}>{h.status}</span>
      <span className="muted" style={{ fontSize: 12, minWidth: 64, textAlign: 'right' }}>
        {h.at.toLocaleTimeString()}
      </span>
    </div>
  );
}

function Activity({ history, go }) {
  if (!history.length) {
    return (
      <div className="card empty">
        <div className="empty-icon">
          <ListIcon size={22} />
        </div>
        <div style={{ color: 'var(--text)', fontWeight: 600 }}>Nothing here yet</div>
        <div>Requests you send from the playground show up here.</div>
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
          <div className="stat-value">{history.filter((h) => h.ok).reduce((a, h) => a + h.records, 0)}</div>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h3 className="card-title">Request log</h3>
          <span className="card-sub">Kept in memory for this tab only</span>
        </div>
        {history.map((h, i) => (
          <HistoryRow key={i} h={h} />
        ))}
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

