import { useState, useEffect } from 'react'
import { apiJson, apiFetch } from '../api'
import { Badge } from '../components/Badge'
import { Card } from '../components/Card'
import { timeSince } from '../utils'

const API_LIMITS = { 'exchangerate.host': 100, 'open-meteo': 300000 }

// Terminal Prefect states — no further transitions expected
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CRASHED', 'CANCELLED'])

// How long ad-hoc result colours (green / red) persist after a run completes
const AD_HOC_EXPIRY_MS = 30 * 60 * 1000        // 30 minutes

// How long automatic result colours (blue / orange) persist since last auto run
const AUTO_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// ── Colour helpers ─────────────────────────────────────────────────────────────

/**
 * Returns a CSS class suffix that drives the card's left-border colour.
 *
 * Priority (high → low):
 *   yellow  – ad-hoc run in progress
 *   green   – ad-hoc run completed within AD_HOC_EXPIRY_MS
 *   red     – ad-hoc run failed   within AD_HOC_EXPIRY_MS
 *   blue    – last auto run completed within AUTO_EXPIRY_MS
 *   orange  – last auto run failed    within AUTO_EXPIRY_MS
 *   grey    – none of the above (neutral / "Scheduled" default)
 */
function cardClass(dep, activeRuns) {
  const active = activeRuns[dep.id]

  if (active && !active.terminal) return 'running'       // yellow

  if (active && active.terminal) {
    const age = Date.now() - active.completedAt
    if (age < AD_HOC_EXPIRY_MS) {
      const s = (active.state || '').toUpperCase()
      if (s === 'COMPLETED')                     return 'success'  // green
      if (s === 'FAILED' || s === 'CRASHED')     return 'failure'  // red
    }
    // Expired — fall through
  }

  // Survives refresh: check last_manual_run age for ad-hoc green/red
  const manualRun = dep.last_manual_run
  if (manualRun?.start_time_iso) {
    const age = Date.now() - new Date(manualRun.start_time_iso).getTime()
    if (age < AD_HOC_EXPIRY_MS) {
      const s = (manualRun.state_type || '').toUpperCase()
      if (s === 'COMPLETED')                 return 'success'  // green
      if (s === 'FAILED' || s === 'CRASHED') return 'failure'  // red
    }
  }

  const autoRun = dep.last_auto_run
  if (autoRun?.start_time_iso) {
    const age = Date.now() - new Date(autoRun.start_time_iso).getTime()
    if (age < AUTO_EXPIRY_MS) {
      const s = (autoRun.state_type || '').toUpperCase()
      if (s === 'COMPLETED')                 return 'auto-success'  // blue
      if (s === 'FAILED' || s === 'CRASHED') return 'auto-failure'  // orange
    }
  }

  if (dep.paused) return 'paused'
  return 'unknown'  // grey
}

/** Badge variant + label for a given card class. */
function cardBadge(cls, dep, activeRuns) {
  switch (cls) {
    case 'running': {
      const s = activeRuns[dep.id]?.state || 'Scheduled'
      return { variant: 'yellow', text: s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() }
    }
    case 'success':      return { variant: 'green',  text: 'Completed' }
    case 'failure':      return { variant: 'red',    text: 'Failed'    }
    case 'auto-success': return { variant: 'blue',   text: 'Completed' }
    case 'auto-failure': return { variant: 'orange', text: 'Failed'    }
    case 'paused':       return { variant: 'yellow', text: 'Paused'    }
    default:             return { variant: 'dim',    text: dep.schedule?.cron ? 'Scheduled' : 'Manual' }
  }
}

/** Timing row shown below the badge. Returns null for the grey default. */
function CardMeta({ dep, activeRuns, cls }) {
  const active = activeRuns[dep.id]

  if (cls === 'running') {
    return <div className="cron-time">In progress…</div>
  }

  if (cls === 'success' || cls === 'failure') {
    if (active?.terminal) {
      return <div className="cron-time">{timeSince(active.completedAt / 1000)}</div>
    }
    // Survived a page refresh — show from last_manual_run
    const r = dep.last_manual_run
    if (r?.start_time_iso) {
      return (
        <>
          <div className="cron-time">{r.start_time} · {timeSince(r.start_time_iso)}</div>
          {r.duration_human && <div className="cron-time">{r.duration_human}</div>}
        </>
      )
    }
    return null
  }

  if (cls === 'auto-success' || cls === 'auto-failure') {
    const r = dep.last_auto_run
    return (
      <>
        <div className="cron-time">
          {r.start_time} · {timeSince(r.start_time_iso)}
        </div>
        {r.duration_human && <div className="cron-time">{r.duration_human}</div>}
      </>
    )
  }

  return null
}

// ── Schedule table helpers ─────────────────────────────────────────────────────

function timeUntil(epoch) {
  if (!epoch) return null
  const mins = Math.round((epoch * 1000 - Date.now()) / 60000)
  if (mins < 0)  return 'overdue'
  if (mins < 60) return `in ${mins}m`
  const h = Math.floor(mins / 60), m = mins % 60
  if (h < 24)    return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`
  return `in ${Math.floor(h / 24)}d`
}

function ScheduleSection({ label, rows, showNext, style }) {
  return (
    <div style={style}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)', marginBottom: '8px' }}>
        {label}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Flow</th>
              {showNext && <th>Schedule</th>}
              {showNext && <th>Next run</th>}
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(dep => (
              <tr key={dep.id}>
                <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{dep.name}</td>
                {showNext && (
                  <td style={{ whiteSpace: 'nowrap' }}>{dep.schedule?.label || dep.schedule?.cron || '—'}</td>
                )}
                {showNext && (
                  <td className="dim" style={{ whiteSpace: 'nowrap' }}>
                    {timeUntil(dep.schedule?.next_run_epoch) || '—'}
                  </td>
                )}
                <td>{dep.description || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Result modal ───────────────────────────────────────────────────────────────

function RunModal({ dep, flowRunId, onClose }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    apiJson(`/api/prefect/flow-run/${flowRunId}`)
      .then(d => {
        if (d?.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => setError(e.message || 'Failed to load run data'))
      .finally(() => setLoading(false))
  }, [flowRunId])

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const state      = data?.state || {}
  const stateType  = (state.type || '').toUpperCase()
  const isAuto     = data?.auto_scheduled
  const uiUrl      = data?.prefect_ui_url
  const result     = data?.result

  function stateBadgeVariant() {
    if (stateType === 'COMPLETED') return isAuto ? 'blue' : 'green'
    if (stateType === 'FAILED' || stateType === 'CRASHED') return isAuto ? 'orange' : 'red'
    if (stateType === 'RUNNING') return 'yellow'
    return 'dim'
  }

  function fmtSecs(s) {
    if (!s) return null
    const total = Math.round(s)
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60
    if (h) return `${h}h ${m}m ${sec}s`
    if (m) return `${m}m ${sec}s`
    return `${sec}s`
  }

  let resultContent
  if (loading) {
    resultContent = (
      <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-dim)' }}>
        Loading…
      </div>
    )
  } else if (error) {
    resultContent = (
      <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--red)' }}>
        {error}
      </div>
    )
  } else if (result !== null && result !== undefined) {
    // Normalise: result may arrive as a parsed object or as a compact JSON string
    let formatted
    if (typeof result === 'string') {
      try { formatted = JSON.stringify(JSON.parse(result), null, 2) }
      catch { formatted = result }
    } else {
      formatted = JSON.stringify(result, null, 2)
    }
    resultContent = (
      <pre className="modal-result-pre">{formatted}</pre>
    )
  } else {
    resultContent = (
      <div style={{ fontSize: '12px', color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>
        Result not available inline.
        {uiUrl && (
          <>
            {' '}
            <a href={uiUrl} target="_blank" rel="noreferrer"
               style={{ color: 'var(--accent)' }}>
              View in Prefect UI →
            </a>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{dep.name}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {!loading && !error && data && (
          <div className="modal-meta">
            <Badge variant={stateBadgeVariant()}>
              {state.name || stateType || '—'}
            </Badge>
            {isAuto !== undefined && (
              <span style={{ color: 'var(--text-dim)' }}>
                {isAuto ? 'Scheduled run' : 'Manual run'}
              </span>
            )}
            {data.start_time && (
              <span>{new Date(data.start_time).toLocaleString()}</span>
            )}
            {fmtSecs(data.total_run_time) && (
              <span>Duration: {fmtSecs(data.total_run_time)}</span>
            )}
          </div>
        )}

        <div className="modal-body">
          {!loading && !error && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)', marginBottom: '8px' }}>
              Return value
            </div>
          )}
          {resultContent}
        </div>
      </div>
    </div>
  )
}

// ── Log digest helpers ─────────────────────────────────────────────────────────

function levelVariant(lvl) {
  if (!lvl) return 'dim'
  if (lvl === 'ERROR' || lvl === 'CRITICAL') return 'red'
  if (lvl === 'WARNING') return 'yellow'
  if (lvl === 'INFO')    return 'blue'
  return 'dim'
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Schedule() {
  const [deployments, setDeployments] = useState(null)
  const [auxData,     setAuxData]     = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  // { [depId]: true } — while the trigger POST is in-flight
  const [triggering,  setTriggering]  = useState({})
  // { [depId]: { flowRunId, state, terminal, completedAt } }
  const [activeRuns,  setActiveRuns]  = useState({})
  // { dep, flowRunId } | null
  const [modal,       setModal]       = useState(null)

  function loadDeployments() {
    return apiJson('/api/prefect/deployments').then(deps => {
      if (Array.isArray(deps)) setDeployments(deps)
      else if (deps?.error)    setError(`Prefect: ${deps.error}`)
    })
  }

  useEffect(() => {
    Promise.all([loadDeployments(), apiJson('/api/crons')])
      .then(([, aux]) => setAuxData(aux))
      .catch(() => setError('Failed to load schedule data'))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll in-progress ad-hoc runs every 5 s
  useEffect(() => {
    const pending = Object.entries(activeRuns).filter(([, r]) => !r.terminal)
    if (pending.length === 0) return

    const timer = setInterval(async () => {
      for (const [depId, run] of pending) {
        if (!run.flowRunId) continue
        try {
          const data     = await apiJson(`/api/prefect/flow-run/${run.flowRunId}`)
          const newState = data.state?.type
          if (!newState) continue

          if (TERMINAL.has(newState.toUpperCase())) {
            const completedAt = Date.now()
            setActiveRuns(s => ({
              ...s,
              [depId]: { ...s[depId], state: newState, terminal: true, completedAt },
            }))
            loadDeployments()
            // Clear this entry after X minutes so the card reverts to auto colour
            setTimeout(() => {
              setActiveRuns(s => { const n = { ...s }; delete n[depId]; return n })
            }, AD_HOC_EXPIRY_MS)
          } else {
            setActiveRuns(s => ({ ...s, [depId]: { ...s[depId], state: newState } }))
          }
        } catch (_) { /* ignore transient poll errors */ }
      }
    }, 5000)

    return () => clearInterval(timer)
  }, [activeRuns]) // eslint-disable-line react-hooks/exhaustive-deps

  async function triggerRun(dep) {
    setTriggering(s => ({ ...s, [dep.id]: true }))
    try {
      const resp = await apiFetch(`/api/prefect/run/${dep.id}`, { method: 'POST' })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Unknown error')
      setActiveRuns(s => ({ ...s, [dep.id]: { flowRunId: data.flow_run_id, state: 'SCHEDULED', terminal: false } }))
    } catch (_) {
      // No activeRun on error — show nothing (the trigger itself failed)
    } finally {
      setTriggering(s => { const n = { ...s }; delete n[dep.id]; return n })
    }
  }

  function openModal(dep) {
    const active = activeRuns[dep.id]
    if (active?.flowRunId) {
      setModal({ dep, flowRunId: active.flowRunId })
      return
    }
    // Pick whichever of auto / manual run is more recent
    const autoTime   = dep.last_auto_run?.start_time_iso   ? new Date(dep.last_auto_run.start_time_iso).getTime()   : 0
    const manualTime = dep.last_manual_run?.start_time_iso ? new Date(dep.last_manual_run.start_time_iso).getTime() : 0
    const flowRunId  = manualTime >= autoTime
      ? (dep.last_manual_run?.flow_run_id || dep.last_auto_run?.flow_run_id)
      : (dep.last_auto_run?.flow_run_id   || dep.last_manual_run?.flow_run_id)
    if (!flowRunId) return
    setModal({ dep, flowRunId })
  }

  const apiUsage    = auxData?.api_usage || {}
  const jobs        = auxData?.jobs      || []
  const deps        = deployments        || []
  const byNextRun   = (a, b) => (a.schedule?.next_run_epoch ?? Infinity) - (b.schedule?.next_run_epoch ?? Infinity)
  const dailyDeps   = deps.filter(d =>  d.schedule?.is_daily).sort(byNextRun)
  const scheduledDeps = deps.filter(d => d.schedule?.cron && !d.schedule.is_daily).sort(byNextRun)
  const manualDeps  = deps.filter(d => !d.schedule?.cron).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <>
      <div className="page-header">
        <h1>Schedule</h1>
        <p>Prefect flow status and deployment schedule.</p>
      </div>

      {error && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--red)', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      {/* Flow status cards */}
      <div style={{ marginBottom: '8px' }}><span className="card-title">Flow Status</span></div>
      <div className="cron-status-grid">
        {loading
          ? <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-dim)' }}>Loading…</div>
          : deps.map(dep => {
              const cls  = cardClass(dep, activeRuns)
              const bdg  = cardBadge(cls, dep, activeRuns)
              const isRunning = triggering[dep.id] || (activeRuns[dep.id] && !activeRuns[dep.id].terminal)

              return (
                <div
                  key={dep.id}
                  className={`cron-card ${cls}`}
                  onClick={() => openModal(dep)}
                  title="Click to view last run details"
                >
                  <div className="cron-name">{dep.name}</div>
                  {dep.description && (
                    <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: '6px', lineHeight: 1.4 }}>
                      {dep.description}
                    </div>
                  )}
                  <div style={{ marginBottom: '6px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <Badge variant={bdg.variant}>{bdg.text}</Badge>
                    {dep.paused && cls !== 'paused' && <Badge variant="yellow">paused</Badge>}
                  </div>
                  <CardMeta dep={dep} activeRuns={activeRuns} cls={cls} />
                  <div style={{ marginTop: 'auto', paddingTop: '10px' }}>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: '11px', padding: '3px 10px', width: '100%', justifyContent: 'center' }}
                      disabled={isRunning || dep.paused}
                      onClick={e => { e.stopPropagation(); triggerRun(dep) }}
                    >
                      {triggering[dep.id] ? 'Queuing…' : isRunning ? '⏳ Running…' : '▶ Run'}
                    </button>
                  </div>
                </div>
              )
            })
        }
      </div>

      {/* Schedule reference */}
      <div style={{ marginBottom: '8px' }}><span className="card-title">Upcoming Runs</span></div>
      <Card style={{ marginBottom: '24px' }}>
        {loading
          ? <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-dim)' }}>Loading…</div>
          : <>
              {dailyDeps.length > 0 && (
                <ScheduleSection
                  label="Daily"
                  rows={dailyDeps}
                  showNext
                  style={{ marginBottom: scheduledDeps.length > 0 || manualDeps.length > 0 ? '20px' : 0 }}
                />
              )}
              {scheduledDeps.length > 0 && (
                <ScheduleSection
                  label="Scheduled"
                  rows={scheduledDeps}
                  showNext
                  style={{ marginBottom: manualDeps.length > 0 ? '20px' : 0 }}
                />
              )}
              {manualDeps.length > 0 && (
                <ScheduleSection label="Manual only" rows={manualDeps} showNext={false} />
              )}
            </>
        }
      </Card>

      {/* API usage */}
      {Object.keys(apiUsage).length > 0 && (
        <>
          <div style={{ marginBottom: '8px' }}><span className="card-title">API Usage</span></div>
          <Card style={{ marginBottom: '24px' }}>
            {Object.entries(apiUsage).map(([name, svc], i, arr) => {
              const limit    = API_LIMITS[name] || 1
              const pct      = Math.round(parseInt(svc.count || 0) / limit * 1000) / 10
              const barClass = pct > 85 ? 'danger' : pct > 65 ? 'warn' : ''
              return (
                <div key={name} style={{ marginBottom: i < arr.length - 1 ? '16px' : 0 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-dim)', marginBottom: '8px' }}>
                    {name}
                  </div>
                  <div className="grid grid-3" style={{ marginBottom: '8px' }}>
                    <div>
                      <div className="stat-label">Calls this month</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '20px', color: 'var(--text-hi)' }}>{svc.count ?? '—'}</div>
                    </div>
                    <div>
                      <div className="stat-label">Month</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '20px', color: 'var(--text-hi)' }}>{svc.month ?? '—'}</div>
                    </div>
                    <div>
                      <div className="stat-label">Monthly limit</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '20px', color: 'var(--text-hi)' }}>{limit.toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="progress-bar-bg" style={{ height: '6px' }}>
                    <div className={`progress-bar-fill${barClass ? ' ' + barClass : ''}`}
                         style={{ width: Math.min(pct, 100) + '%' }} />
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>
                    {pct}% of monthly quota used
                  </div>
                  {i < arr.length - 1 && (
                    <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '8px 0 16px' }} />
                  )}
                </div>
              )
            })}
          </Card>
        </>
      )}

      {/* Log digest */}
      <div style={{ marginBottom: '8px' }}><span className="card-title">Log Digest History</span></div>
      <Card>
        {jobs.length === 0
          ? <p style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--text-dim)' }}>
              No log digest entries found.
            </p>
          : <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Level</th><th>Logger / Job</th><th>Message</th><th>Timestamp</th></tr>
                </thead>
                <tbody>
                  {jobs.map((row, i) => {
                    const lvl = row.levelname || row.level || ''
                    return (
                      <tr key={row.ts || row.created || row.timestamp || i}>
                        <td><Badge variant={levelVariant(lvl)}>{lvl || '—'}</Badge></td>
                        <td className="dim">{row.name || row.logger || '—'}</td>
                        <td>{(row.message || row.msg || '—').slice(0, 160)}</td>
                        <td className="dim" style={{ whiteSpace: 'nowrap' }}>
                          {row.ts || row.created || row.timestamp || '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
        }
      </Card>

      {/* Result modal */}
      {modal && (
        <RunModal
          dep={modal.dep}
          flowRunId={modal.flowRunId}
          onClose={() => setModal(null)}
        />
      )}
    </>
  )
}
