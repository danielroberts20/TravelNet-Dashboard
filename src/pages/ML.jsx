import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { apiJson } from '../api'

// ── Static data ───────────────────────────────────────────────────────────────

const PHASES = [
  { label: 'Pre-departure' },
  { label: 'Australia baseline' },
  { label: 'First transition' },
  { label: 'Mid-trip' },
  { label: 'Post-trip' },
]

const MODEL_REGISTRY = [
  { model: 'Transport Mode Classifier',        phase: 1, requirement: '60+ days GPS',              status: 'Planned',             eta: 'Australia (month 2)' },
  { model: 'Spend Anomaly Detection',          phase: 1, requirement: '60 days spend',             status: 'Planned',             eta: 'Australia (month 2)' },
  { model: 'Movement Novelty Score',           phase: 1, requirement: 'Day 1+',                    status: 'Planned',             eta: 'Australia (month 1)' },
  { model: 'ATL/CTL Fitness Load',             phase: 1, requirement: 'Day 1+',                    status: 'Active — populating', eta: 'Now' },
  { model: 'Sleep Quality Regression',         phase: 1, requirement: '90 days',                   status: 'Planned',             eta: 'Australia (month 3)' },
  { model: 'HMM Travel Phase Segmentation',    phase: 2, requirement: '100+ days',                 status: 'Planned',             eta: 'Post-Australia' },
  { model: 'Settling-In Curve',                phase: 2, requirement: 'First transition',          status: 'Planned',             eta: 'Post-Australia' },
  { model: 'Circadian Rhythm / Jet Lag',       phase: 2, requirement: 'First timezone crossing',   status: 'Planned',             eta: 'Post-Australia' },
  { model: 'Budget Trajectory (GP)',           phase: 2, requirement: '60 days spend',             status: 'Planned',             eta: 'Post-Australia' },
  { model: 'Day Embeddings Autoencoder',       phase: 3, requirement: '200+ days',                 status: 'Planned',             eta: 'Mid-trip' },
  { model: 'Destination Behavioural Signature',phase: 3, requirement: '3+ countries',              status: 'Planned',             eta: 'Mid-trip' },
  { model: 'Causal Wellbeing Graph',           phase: 3, requirement: '200+ days',                 status: 'Planned',             eta: 'Mid-trip' },
  { model: 'Social Pattern Detection',         phase: 3, requirement: '200+ days',                 status: 'Planned',             eta: 'Mid-trip' },
  { model: 'Purchasing Power Model',           phase: 4, requirement: 'Full trip',                 status: 'Planned',             eta: 'Post-trip' },
]

const DOMAIN_STYLE = {
  location: { background: 'var(--accent-lo)', color: 'var(--accent)' },
  health:   { background: 'var(--green-lo)',  color: 'var(--green)'  },
  ml:       { background: 'var(--orange-lo)', color: 'var(--orange)' },
}

const STATUS_STYLE = {
  'Planned':             { background: 'var(--border)',    color: 'var(--text-dim)' },
  'Active — populating': { background: 'var(--green-lo)', color: 'var(--green)'   },
  'Training':            { background: 'var(--yellow-lo)',color: 'var(--yellow)'  },
  'Deployed':            { background: 'var(--green-lo)', color: 'var(--green)'   },
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DOW_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const DOMAINS_LIST = ['location', 'health', 'ml']
const DOMAIN_LABEL = { location: 'Location', health: 'Health', ml: 'ML Outputs' }

// ── Helpers ───────────────────────────────────────────────────────────────────

function heatColor(score) {
  if (score === 0) return '#1a1f2e'
  if (score <= 2)  return 'rgba(240,184,61,0.35)'
  if (score <= 4)  return 'rgba(52,196,124,0.50)'
  return 'rgba(52,196,124,0.88)'
}

// Build a week-row calendar from sorted day data (last 90 days max)
function buildCalendar(days) {
  const slice = days.slice(-90)
  if (!slice.length) return []
  const dayMap = {}
  slice.forEach(d => { dayMap[d.date] = d })

  const [fy, fm, fd] = slice[0].date.split('-').map(Number)
  const [ly, lm, ld] = slice[slice.length - 1].date.split('-').map(Number)
  const first = new Date(Date.UTC(fy, fm - 1, fd))
  const last  = new Date(Date.UTC(ly, lm - 1, ld))

  const startDow = (first.getUTCDay() + 6) % 7   // Mon=0 … Sun=6
  const gridStart = new Date(first)
  gridStart.setUTCDate(gridStart.getUTCDate() - startDow)

  const endDow = (last.getUTCDay() + 6) % 7
  const gridEnd = new Date(last)
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - endDow))

  const weeks = []
  const cur = new Date(gridStart)
  let prevMonth = -1

  while (cur <= gridEnd) {
    const weekMonth = cur.getUTCMonth()
    const monthLabel = weekMonth !== prevMonth ? MONTHS[weekMonth] : null
    if (weekMonth !== prevMonth) prevMonth = weekMonth

    const cells = []
    for (let d = 0; d < 7; d++) {
      const dateStr = [
        cur.getUTCFullYear(),
        String(cur.getUTCMonth() + 1).padStart(2, '0'),
        String(cur.getUTCDate()).padStart(2, '0'),
      ].join('-')
      cells.push({ date: dateStr, data: dayMap[dateStr] || null })
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
    weeks.push({ cells, monthLabel })
  }
  return weeks
}

// ── Phase stepper ─────────────────────────────────────────────────────────────

function PhaseIndicator({ current = 0 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', marginTop: '20px', gap: 0 }}>
      {PHASES.map((phase, i) => {
        const done   = i < current
        const active = i === current
        const future = i > current
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
              <div style={{
                width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 600,
                background: done || active ? 'var(--accent)' : 'var(--border)',
                border: active ? '2px solid var(--accent)' : '2px solid transparent',
                color: done || active ? '#fff' : 'var(--text-dim)',
                opacity: future ? 0.4 : 1,
                boxShadow: active ? '0 0 10px rgba(61,142,240,.4)' : 'none',
              }}>
                {done ? '✓' : i}
              </div>
              <div style={{
                fontSize: '10px', fontFamily: 'var(--mono)', textAlign: 'center',
                maxWidth: '72px', lineHeight: 1.35,
                color: active ? 'var(--accent)' : done ? 'var(--text)' : 'var(--text-dim)',
                opacity: future ? 0.4 : 1,
              }}>
                {phase.label}
              </div>
            </div>
            {i < PHASES.length - 1 && (
              <div style={{
                width: '36px', height: '2px', flexShrink: 0, marginTop: '13px',
                background: done ? 'var(--accent)' : 'var(--border2)',
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Sparkline (inline SVG, no library) ───────────────────────────────────────

function Sparkline({ values = [] }) {
  const nums = values.filter(v => v !== null && v !== undefined)
  if (!nums.length) {
    return <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>No data yet</span>
  }
  const W = 60, H = 20, PAD = 2
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const range = max - min || 1
  const iw = W - PAD * 2
  const ih = H - PAD * 2
  const step = values.length > 1 ? iw / (values.length - 1) : iw

  const toXY = (v, i) => [PAD + i * step, PAD + ih - ((v - min) / range) * ih]

  // Collect contiguous non-null segments
  const segments = []
  let cur = []
  values.forEach((v, i) => {
    if (v === null || v === undefined) {
      if (cur.length) { segments.push(cur); cur = [] }
    } else {
      cur.push([...toXY(v, i), v])
    }
  })
  if (cur.length) segments.push(cur)

  return (
    <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
      {segments.map((seg, si) => {
        if (seg.length === 1)
          return <circle key={si} cx={seg[0][0]} cy={seg[0][1]} r={1.5} fill="var(--accent)" />
        const d = seg.map((p, pi) => `${pi === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
        return <path key={si} d={d} stroke="var(--accent)" strokeWidth={1.5} fill="none" strokeLinejoin="round" />
      })}
      {values.map((v, i) => {
        if (v === null || v === undefined) return null
        const [x, y] = toXY(v, i)
        return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r={1.5} fill="var(--accent)" />
      })}
    </svg>
  )
}

// ── Coverage bar ──────────────────────────────────────────────────────────────

function CoverageBar({ pct }) {
  const color = pct === 0 ? 'var(--text-dim)' : pct < 50 ? 'var(--yellow)' : 'var(--green)'
  const fill  = pct === 0 ? 'var(--border)'   : pct < 50 ? 'var(--yellow)' : 'var(--green)'
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
        <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>coverage</span>
        <span style={{ fontSize: '10px', color, fontFamily: 'var(--mono)', fontWeight: 600 }}>{pct}%</span>
      </div>
      <div style={{ height: '3px', background: 'var(--border2)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: fill, borderRadius: '2px' }} />
      </div>
    </div>
  )
}

// ── Feature card ──────────────────────────────────────────────────────────────

function FeatureCard({ feature }) {
  const ds     = DOMAIN_STYLE[feature.domain] || DOMAIN_STYLE.ml
  const isText = 'top_values' in feature
  const dim    = feature.coverage_pct === 0

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: '12px 14px',
      opacity: dim ? 0.55 : 1, display: 'flex', flexDirection: 'column', gap: '6px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '6px' }}>
        <code style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-hi)', fontWeight: 600, wordBreak: 'break-all' }}>
          {feature.column}
        </code>
        <span style={{ ...ds, fontSize: '10px', fontFamily: 'var(--mono)', padding: '1px 6px', borderRadius: '3px', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {feature.domain}
        </span>
      </div>

      <CoverageBar pct={feature.coverage_pct} />

      {isText ? (
        feature.top_values && feature.top_values.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {feature.top_values.map(tv => (
              <span key={tv.value} style={{
                background: 'var(--border)', color: 'var(--text-dim)',
                fontSize: '10px', fontFamily: 'var(--mono)', padding: '1px 5px', borderRadius: '3px',
              }}>
                {tv.value} <span style={{ opacity: 0.6 }}>×{tv.count}</span>
              </span>
            ))}
          </div>
        ) : (
          <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>No values yet</span>
        )
      ) : (
        feature.mean !== null ? (
          <div style={{ display: 'flex', gap: '10px' }}>
            {[['min', feature.min], ['avg', feature.mean], ['max', feature.max]].map(([lbl, val]) => (
              <div key={lbl}>
                <div style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{lbl}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-hi)', fontFamily: 'var(--mono)' }}>{val ?? '—'}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ height: '24px' }} />
        )
      )}

      <Sparkline values={feature.recent || []} />
    </div>
  )
}

// ── Section 2: Completeness heatmap ──────────────────────────────────────────

function CompletenessHeatmap({ heatmap, loading, error }) {
  const [tooltip, setTooltip] = useState(null)

  if (error) {
    return (
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-title">Data Collection Coverage</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--red)' }}>{error}</div>
      </div>
    )
  }

  const days   = heatmap?.days ?? []
  const full   = days.filter(d => d.score === 5).length
  const anyData = days.filter(d => d.score > 0).length
  const weeks  = buildCalendar(days)

  return (
    <div className="card" style={{ marginBottom: '24px' }}>
      <div style={{ marginBottom: '16px' }}>
        <div className="card-title" style={{ marginBottom: '4px' }}>Data Collection Coverage</div>
        {loading ? (
          <span style={{ fontSize: '12px', color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>Loading…</span>
        ) : (
          <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
            {full} fully-complete {full === 1 ? 'day' : 'days'} of {anyData} {anyData === 1 ? 'day' : 'days'} with any data
          </span>
        )}
      </div>

      {!loading && weeks.length === 0 && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-dim)' }}>
          No daily_summary rows yet.
        </div>
      )}

      {weeks.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          {/* Day-of-week column headers */}
          <div style={{ display: 'flex', marginBottom: '4px', marginLeft: '38px' }}>
            {DOW_LABELS.map(d => (
              <div key={d} style={{
                width: '16px', height: '16px', marginRight: '3px', flexShrink: 0,
                fontSize: '9px', fontFamily: 'var(--mono)', color: 'var(--text-dim)',
                textAlign: 'center', lineHeight: '16px',
              }}>{d[0]}</div>
            ))}
          </div>

          {/* Calendar rows (week = row) */}
          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: 'flex', alignItems: 'center', marginBottom: '3px' }}>
              {/* Month label column */}
              <div style={{
                width: '34px', flexShrink: 0,
                fontSize: '9px', fontFamily: 'var(--mono)', color: 'var(--text-dim)',
                textAlign: 'right', paddingRight: '6px',
              }}>
                {week.monthLabel ?? ''}
              </div>

              {/* Day cells */}
              {week.cells.map((cell, ci) => (
                <div
                  key={ci}
                  style={{
                    width: '16px', height: '16px', marginRight: '3px', flexShrink: 0,
                    borderRadius: '2px',
                    background: cell.data ? heatColor(cell.data.score) : '#0d0f14',
                    cursor: cell.data ? 'default' : 'default',
                    border: cell.data ? '1px solid rgba(255,255,255,.04)' : '1px solid transparent',
                  }}
                  onMouseEnter={e => {
                    if (!cell.data) return
                    setTooltip({ x: e.clientX, y: e.clientY, day: cell.data })
                  }}
                  onMouseMove={e => {
                    if (!cell.data) return
                    setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null)
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              ))}
            </div>
          ))}

          {/* Legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>domains:</span>
            {[0, 1, 2, 3, 4, 5].map(s => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: s === 0 ? '#1a1f2e' : heatColor(s), border: '1px solid rgba(255,255,255,.06)' }} />
                <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Floating tooltip */}
      {tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x + 14, top: tooltip.y - 12,
          background: 'var(--surface)', border: '1px solid var(--border2)',
          borderRadius: '5px', padding: '8px 12px',
          fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text)',
          zIndex: 1000, pointerEvents: 'none', whiteSpace: 'nowrap',
          boxShadow: '0 4px 16px rgba(0,0,0,.4)',
        }}>
          <div style={{ color: 'var(--text-hi)', fontWeight: 600, marginBottom: '5px' }}>{tooltip.day.date}</div>
          {[['health',   tooltip.day.health_complete],
            ['location', tooltip.day.location_complete],
            ['pi',       tooltip.day.pi_complete],
            ['spend',    tooltip.day.spend_complete],
            ['weather',  tooltip.day.weather_complete],
          ].map(([name, val]) => (
            <div key={name} style={{ color: val ? 'var(--green)' : 'var(--text-dim)', marginBottom: '2px' }}>
              {val ? '✓' : '○'} {name}
            </div>
          ))}
          <div style={{ marginTop: '5px', color: 'var(--text-dim)', borderTop: '1px solid var(--border)', paddingTop: '5px' }}>
            score: <span style={{ color: 'var(--text-hi)' }}>{tooltip.day.score}/5</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Section 3: Feature readiness ──────────────────────────────────────────────

function FeatureReadiness({ features, loading, error }) {
  if (error) {
    return (
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-title">ML Feature Pipeline</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--red)' }}>{error}</div>
      </div>
    )
  }

  return (
    <div className="card" style={{ marginBottom: '24px' }}>
      <div style={{ marginBottom: '16px' }}>
        <div className="card-title" style={{ marginBottom: '4px' }}>ML Feature Pipeline</div>
        <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
          daily_summary columns required by ML models
        </span>
      </div>

      {loading && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-dim)' }}>Loading…</div>
      )}

      {!loading && features !== null && features.length === 0 && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-dim)' }}>
          No ML columns found in daily_summary.
        </div>
      )}

      {!loading && features && features.length > 0 && DOMAINS_LIST.map(domain => {
        const group = features.filter(f => f.domain === domain)
        if (!group.length) return null
        return (
          <div key={domain} style={{ marginBottom: '20px' }}>
            <div style={{
              fontSize: '11px', fontFamily: 'var(--mono)', fontWeight: 600,
              letterSpacing: '.08em', textTransform: 'uppercase',
              color: (DOMAIN_STYLE[domain] || {}).color || 'var(--text-dim)',
              marginBottom: '10px',
            }}>
              {DOMAIN_LABEL[domain]}
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: '10px',
            }}>
              {group.map(f => <FeatureCard key={f.column} feature={f} />)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Section 4: ML table status ────────────────────────────────────────────────

function MLTableStatus({ tables, loading, error }) {
  if (error) {
    return (
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-title">ML Output Tables</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--red)' }}>{error}</div>
      </div>
    )
  }

  const rows = tables?.tables ?? []

  return (
    <>
      <div style={{ marginBottom: '8px' }}>
        <span className="card-title">ML Output Tables</span>
      </div>
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Table</th>
                <th>Rows</th>
                <th>Columns</th>
                <th>Date Range</th>
                <th>Last Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ color: 'var(--text-dim)' }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} style={{ color: 'var(--text-dim)' }}>No ml_ tables found.</td></tr>
              ) : rows.map(t => {
                const empty = t.row_count === 0
                return (
                  <tr key={t.name}>
                    <td style={{ color: 'var(--text-hi)' }}>
                      {t.name}
                      {t.type === 'view' && (
                        <span className="badge badge-blue" style={{ marginLeft: '6px' }}>view</span>
                      )}
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>
                      {empty ? <span style={{ color: 'var(--text-dim)' }}>—</span> : t.row_count.toLocaleString()}
                    </td>
                    <td className="dim" style={{ fontSize: '11px', maxWidth: '260px', whiteSpace: 'normal', lineHeight: 1.8 }}>
                      {t.cols.join(', ')}
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>
                      {empty ? (
                        <span style={{
                          background: 'var(--yellow-lo)', color: 'var(--yellow)',
                          fontSize: '10px', padding: '2px 7px', borderRadius: '3px',
                          fontFamily: 'var(--mono)',
                        }}>
                          Awaiting data
                        </span>
                      ) : t.date_range ? (
                        <span style={{ color: 'var(--text-dim)' }}>
                          {t.date_range.min?.slice(0, 10)} → {t.date_range.max?.slice(0, 10)}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)' }}>
                      {t.last_updated ? t.last_updated.slice(0, 19).replace('T', ' ') : '—'}
                    </td>
                    <td>
                      <Link
                        to={`/db/table/${encodeURIComponent(t.name)}`}
                        className="btn btn-ghost"
                        style={{ padding: '4px 12px', fontSize: '11px' }}
                      >
                        Browse →
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ── Section 5: Model registry (static) ───────────────────────────────────────

function ModelRegistry() {
  return (
    <>
      <div style={{ marginBottom: '8px' }}>
        <span className="card-title">Model Registry</span>
      </div>
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Phase</th>
                <th>Data Requirement</th>
                <th>Status</th>
                <th>ETA</th>
              </tr>
            </thead>
            <tbody>
              {MODEL_REGISTRY.map((m, i) => {
                const ss = STATUS_STYLE[m.status] || STATUS_STYLE['Planned']
                return (
                  <tr key={i}>
                    <td style={{ color: 'var(--text-hi)' }}>{m.model}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-dim)' }}>
                      {m.phase}
                    </td>
                    <td style={{ color: 'var(--text-dim)', fontSize: '12px' }}>{m.requirement}</td>
                    <td>
                      <span style={{
                        ...ss, fontSize: '11px', fontFamily: 'var(--mono)',
                        padding: '2px 8px', borderRadius: '3px', whiteSpace: 'nowrap',
                      }}>
                        {m.status}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)' }}>
                      {m.eta}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ── Section 6: Correlation matrix placeholder ─────────────────────────────────

function CorrelationPlaceholder({ heatmap }) {
  const days    = heatmap?.days ?? []
  const complete = days.filter(d => d.score === 5).length
  const THRESHOLD = 30
  const pct = Math.min(Math.round(complete / THRESHOLD * 100), 100)

  return (
    <>
      <div style={{ marginBottom: '8px' }}>
        <span className="card-title">Feature Correlation Matrix</span>
      </div>
      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '16px' }}>
          Requires {THRESHOLD}+ complete daily_summary rows
        </div>
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '20px', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--text-hi)', marginBottom: '12px' }}>
            {complete} / {THRESHOLD} complete days
          </div>
          <div className="progress-bar-bg" style={{ maxWidth: '280px', margin: '0 auto 14px' }}>
            <div
              className={`progress-bar-fill${pct >= 100 ? '' : pct > 60 ? ' warn' : ''}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-dim)', lineHeight: 1.6, maxWidth: '480px', margin: '0 auto' }}>
            Once you have {THRESHOLD}+ fully-complete days, this section will show Pearson correlations
            between all ML feature columns in daily_summary — revealing which health, movement, and
            spend signals co-vary most strongly.
            {/* TODO: compute correlations client-side from /api/ml/daily-summary-features recent values */}
          </div>
        </div>
      </div>
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ML() {
  const [heatmap,     setHeatmap]     = useState(null)
  const [heatError,   setHeatError]   = useState('')
  const [features,    setFeatures]    = useState(null)
  const [featError,   setFeatError]   = useState('')
  const [tables,      setTables]      = useState(null)
  const [tablesError, setTablesError] = useState('')

  useEffect(() => {
    apiJson('/api/ml/completeness-heatmap')
      .then(setHeatmap)
      .catch(e => setHeatError(e.message))

    apiJson('/api/ml/daily-summary-features')
      .then(d => setFeatures(d.features ?? []))
      .catch(e => setFeatError(e.message))

    apiJson('/api/ml/tables')
      .then(setTables)
      .catch(e => setTablesError(e.message))
  }, [])

  return (
    <>
      <div className="page-header" style={{ marginBottom: '32px' }}>
        <h1>Machine Learning</h1>
        <p>Pipeline status and model readiness</p>
        <PhaseIndicator current={0} />
      </div>

      <CompletenessHeatmap
        heatmap={heatmap}
        loading={!heatmap && !heatError}
        error={heatError}
      />

      <FeatureReadiness
        features={features}
        loading={!features && !featError}
        error={featError}
      />

      <MLTableStatus
        tables={tables}
        loading={!tables && !tablesError}
        error={tablesError}
      />

      <ModelRegistry />

      <CorrelationPlaceholder heatmap={heatmap} />
    </>
  )
}
