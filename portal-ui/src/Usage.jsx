import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChartIcon, SpinnerIcon } from './icons.jsx';

const RANGES = [
  { id: '1h', label: 'Last hour' },
  { id: '24h', label: 'Last 24 hours' },
  { id: '7d', label: 'Last 7 days' },
];

// Fixed series order -> fixed colors (validated categorical slots 1 and 2)
const SERIES = [
  { key: 'anonymize', label: 'Anonymized', color: 'var(--series-1)' },
  { key: 'deanonymize', label: 'Deanonymized', color: 'var(--series-2)' },
];

const REFRESH_MS = 15_000;
const fmt = (n) => n.toLocaleString();

export default function Usage({ apiBase }) {
  const [range, setRange] = useState('24h');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [view, setView] = useState('chart');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/admin/usage?range=${range}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [apiBase, range]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const t = data?.totals;
  const errorRate = t?.requests ? (t.errors / t.requests) * 100 : 0;
  const stale = loading && data && data.range !== range;

  return (
    <div className="grid" style={{ gap: 20 }}>
      {/* Filter row: scopes everything below */}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div className="seg" role="radiogroup" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r.id} role="radio" aria-checked={range === r.id} className={range === r.id ? 'on' : ''} onClick={() => setRange(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
        {loading && <SpinnerIcon size={14} style={{ color: 'var(--text-3)' }} />}
        <span className="spacer" />
        <span className="hint">Auto-refreshes every 15 s · counters reset when the API restarts</span>
      </div>

      {error && <div className="banner banner-danger">Couldn’t load usage: {error}</div>}

      <div className="stats" style={{ opacity: stale ? 0.55 : 1, transition: 'opacity 150ms' }}>
        <Kpi label="Records anonymized" value={t ? fmt(t.anonymize) : '—'} swatch="var(--series-1)" />
        <Kpi label="Records deanonymized" value={t ? fmt(t.deanonymize) : '—'} swatch="var(--series-2)" />
        <Kpi label="Field values processed" value={t ? fmt(t.fields) : '—'} />
        <Kpi
          label="Error rate"
          value={t ? `${errorRate < 10 && errorRate > 0 ? errorRate.toFixed(1) : Math.round(errorRate)}%` : '—'}
          foot={t ? `${fmt(t.errors)} of ${fmt(t.requests)} requests` : ''}
        />
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="card-title">Records processed over time</h3>
            <div className="card-sub">{data ? `Per ${bucketLabel(data.bucketMinutes)}` : ''}</div>
          </div>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
            <div className="legend" aria-label="Legend">
              {SERIES.map((s) => (
                <span key={s.key} className="legend-item">
                  <span className="legend-swatch" style={{ background: s.color }} />
                  {s.label}
                </span>
              ))}
            </div>
            <div className="seg">
              <button className={view === 'chart' ? 'on' : ''} onClick={() => setView('chart')}>
                Chart
              </button>
              <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>
                Table
              </button>
            </div>
          </div>
        </div>
        <div className="card-body" style={{ opacity: stale ? 0.55 : 1, transition: 'opacity 150ms' }}>
          {!data ? (
            <div className="skeleton" style={{ height: 260 }} />
          ) : view === 'chart' ? (
            <StackedBars data={data} />
          ) : (
            <UsageTable data={data} />
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, foot, swatch }) {
  return (
    <div className="card stat">
      <div className="stat-top">
        <span className="row" style={{ gap: 8 }}>
          {swatch && <span className="legend-swatch" style={{ background: swatch }} />}
          {label}
        </span>
      </div>
      <div className="stat-value">{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}

const bucketLabel = (m) => (m === 1 ? 'minute' : m < 60 ? `${m} minutes` : m === 60 ? 'hour' : `${m / 60} hours`);

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
function bucketText(iso, data, withEnd) {
  const start = new Date(iso);
  const end = new Date(start.getTime() + data.bucketMinutes * 60_000);
  const day = data.range === '7d' ? `${dayFmt.format(start)} ` : '';
  return withEnd ? `${day}${timeFmt.format(start)}–${timeFmt.format(end)}` : `${day}${timeFmt.format(start)}`;
}

function niceTicks(max) {
  if (max <= 0) return [0, 1, 2, 3, 4];
  const raw = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const unit = Math.max(1, step);
  const top = Math.ceil(max / unit) * unit;
  return Array.from({ length: Math.round(top / unit) + 1 }, (_, i) => i * unit);
}

// Bar path with only the top corners rounded (data-end anchored to the baseline)
function topRoundedRect(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  if (rr <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function StackedBars({ data }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const series = data.series;
  const n = series.length;
  const height = 260;
  const m = { top: 12, right: 8, bottom: 28, left: 44 };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;
  const totals = series.map((b) => b.anonymize + b.deanonymize);
  const ticks = niceTicks(Math.max(...totals));
  const yMax = ticks[ticks.length - 1];
  const y = (v) => m.top + ih - (v / yMax) * ih;
  const band = iw / n;
  const gap = band >= 6 ? Math.max(2, band * 0.25) : 1;
  const barW = Math.max(1, band - gap);
  const labelEvery = Math.ceil(n / Math.max(2, Math.floor(iw / 90)));
  const empty = totals.every((v) => v === 0);

  const indexFromEvent = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left - m.left) / band);
    return i >= 0 && i < n ? i : null;
  };

  const onKey = (e) => {
    if (e.key === 'ArrowRight') setHover((h) => Math.min(n - 1, (h ?? n - 2) + 1));
    else if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? n) - 1));
    else if (e.key === 'Escape') setHover(null);
    else return;
    e.preventDefault();
  };

  const hb = hover !== null ? series[hover] : null;
  // Tooltip sits beside the hovered column, inside the plot: right of it in the left half, left of it otherwise
  const tipOnLeft = hover !== null && m.left + hover * band > width / 2;
  const tipX = hover !== null ? (tipOnLeft ? m.left + hover * band - 10 : m.left + (hover + 1) * band + 10) : 0;

  return (
    <div ref={wrapRef} className="chart" style={{ position: 'relative' }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Stacked bar chart of records anonymized and restored, ${data.range}`}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerMove={(e) => setHover(indexFromEvent(e))}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        style={{ display: 'block', outline: 'none' }}
      >
        {/* grid + y axis */}
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={m.left} x2={width - m.right} y1={y(tv)} y2={y(tv)} className={tv === 0 ? 'axis-line' : 'grid-line'} />
            <text x={m.left - 8} y={y(tv)} dy="0.32em" textAnchor="end" className="axis-text">
              {tv.toLocaleString()}
            </text>
          </g>
        ))}

        {/* hovered column wash */}
        {hover !== null && <rect x={m.left + hover * band} y={m.top} width={band} height={ih} className="hover-wash" />}

        {/* bars: anonymize on the bottom, restored on top, 2px surface gap between segments */}
        {series.map((b, i) => {
          const x = m.left + i * band + (band - barW) / 2;
          const a = b.anonymize;
          const d = b.deanonymize;
          if (!a && !d) return null;
          const base = y(0);
          const aTop = y(a);
          const dTop = y(a + d);
          const aH = base - aTop;
          const segGap = a && d ? 2 : 0;
          const dH = Math.max(0, aTop - dTop - segGap);
          return (
            <g key={b.t} opacity={hover === null || hover === i ? 1 : 0.55}>
              {a > 0 && (
                <path d={d > 0 ? `M${x},${aTop}h${barW}v${aH}h${-barW}Z` : topRoundedRect(x, aTop, barW, Math.max(aH, 1), 4)} fill="var(--series-1)" />
              )}
              {d > 0 && <path d={topRoundedRect(x, dTop, barW, Math.max(dH, 1), 4)} fill="var(--series-2)" />}
            </g>
          );
        })}

        {/* x labels */}
        {series.map((b, i) =>
          i % labelEvery === 0 ? (
            <text key={b.t} x={m.left + i * band + band / 2} y={height - 8} textAnchor="middle" className="axis-text">
              {bucketText(b.t, data, false)}
            </text>
          ) : null
        )}
      </svg>

      {empty && (
        <div className="chart-empty">
          <ChartIcon size={20} />
          No traffic in this range yet — send a request from the playground.
        </div>
      )}

      {hb && (
        <div
          className="chart-tip"
          style={{ left: tipX, top: m.top + 8, transform: tipOnLeft ? 'translateX(-100%)' : 'none' }}
          role="status"
        >
          <div className="tip-title">{bucketText(hb.t, data, true)}</div>
          {SERIES.map((s) => (
            <div key={s.key} className="tip-row">
              <span className="tip-key" style={{ background: s.color }} />
              <b>{fmt(hb[s.key])}</b>
              <span>{s.label}</span>
            </div>
          ))}
          {hb.errors > 0 && (
            <div className="tip-row">
              <span className="tip-key" style={{ background: 'var(--danger)' }} />
              <b>{fmt(hb.errors)}</b>
              <span>Errors</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UsageTable({ data }) {
  const rows = data.series.filter((b) => b.requests > 0).reverse();
  if (!rows.length) return <div className="empty" style={{ padding: 40 }}>No traffic in this range yet.</div>;
  return (
    <div className="table-wrap" style={{ maxHeight: 360 }}>
      <table className="table">
        <thead>
          <tr>
            <th>Time</th>
            <th style={{ textAlign: 'right' }}>Anonymized</th>
            <th style={{ textAlign: 'right' }}>Deanonymized</th>
            <th style={{ textAlign: 'right' }}>Fields</th>
            <th style={{ textAlign: 'right' }}>Requests</th>
            <th style={{ textAlign: 'right' }}>Errors</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.t}>
              <td className="mono">{bucketText(b.t, data, true)}</td>
              {['anonymize', 'deanonymize', 'fields', 'requests', 'errors'].map((k) => (
                <td key={k} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(b[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
