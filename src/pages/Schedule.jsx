import { useState, useEffect, useRef } from 'react'
import { apiJson, apiFetch } from '../api'
import { Badge } from '../components/Badge'
import { Card } from '../components/Card'
import { timeSince } from '../utils'

const API_LIMITS = { 'exchangerate.host': 100, 'open-meteo': 300000 }

// States from which a flow will not progress further
const TERMINAL_STATES = new Set(['COMPLETED', 'FAILED', 'CRASHED', 'CANCELLED'])

function timeUntil(epoch) {
  if (!epoch) return null
  const mins = Math.round((epoch * 1000 - Date.now()) / 60000)
  if (mins < 0)    return 'overdue'
  if (mins < 60)   return `in ${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h < 24)      return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`
  return `in ${Math.floor(h / 24)}d`
}

function stateVariant(stateType) {
  switch ((stateType || '').toUpperCase()) {
    case 'COMPLETED':  return 'green'
    case 'FAILED':
    case 'CRASHED':    return 'red'
    case 'RUNNING':
    case 'SCHEDULED':
    case 'PENDING':    return 'yellow'
    default:           return 'dim'
  }
}

function cardClass(dep, activeRuns) {
  const active = activeRuns[dep.id]
  if (active) {
    const s = (active.state || '').toUpperCase()
    if (s === 'COMPLETED')                     return 'success'
    if (s === 'FAILED' || s === 'CRASHED')     return 'failure'
    if (s === 'ERROR')                         return 'failure'
    if (s === 'CANCELLED')                     return 'unknown'
    return 'running'  // SCHEDULED, PENDING, RUNNING
  }
  if (dep.paused) return 'paused'
  if (!dep.last_run) return 'unknown'
  switch ((dep.last_run.state_type || '').toUpperCase()) {
    case 'COMPLETED': return 'success'
    case 'FAILED':
    case 'CRASHED':   return 'failure'
    case 'RUNNING':   return 'running'
    default:          return 'unknown'
  }
}

function runButton(dep, triggering, activeRuns) {
  if (triggering[dep.id])  return { text: 'Queuing…',  disabled: true }
  const active = activeRuns[dep.id]
  if (active) {
    const s = (active.state || '').toUpperCase()
    if (s === 'COMPLETED')                 return { text: '✓ Done',     disabled: true }
    if (s === 'FAILED' || s === 'CRASHED') return { text: '✗ Failed',   disabled: true }
    if (s === 'CANCELLED')                 return { text: 'Cancelled',  disabled: true }
    if (s === 'ERROR')                     return { text: '✗ Error',    disabled: true }
    return { text: '⏳ Running…', disabled: true }
  }
  return { text: '▶ Run', disabled: dep.paused }
}

function levelVariant(lvl) {
  if (!lvl) return 'dim'
  if (lvl === 'ERROR' || lvl === 'CRITICAL') return 'red'
  if (lvl === 'WARNING') return 'yellow'
  if (lvl === 'INFO')    return 'blue'
  return 'dim'
}

export default function Schedule() {
  const [deployments, setDeployments] = useState(null)
  const [auxData,     setAuxData]     = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  // { [depId]: true } — while the trigger POST is in-flight
  const [triggering,  setTriggering]  = useState({})
  // { [depId]: { flowRunId, state } } — runs we're watching
  const [activeRuns,  setActiveRuns]  = useState({})
  // Stable ref so the interval callback can always see the latest activeRuns
  const activeRunsRef = useRef(activeRuns)
  useEffect(() => { activeRunsRef.current = activeRuns }, [activeRuns])

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

  // Poll active runs every 5 s
  useEffect(() => {
    const pending = Object.entries(activeRuns).filter(
      ([, r]) => !TERMINAL_STATES.has((r.state || '').toUpperCase()) && r.state !== 'ERROR'
    )
    if (pending.length === 0) return

    const timer = setInterval(async () => {
      for (const [depId, run] of pending) {
        if (!run.flowRunId) continue
        try {
          const data = await apiJson(`/api/prefect/flow-run/${run.flowRunId}`)
          const newState = data.state?.type
          if (!newState) continue

          setActiveRuns(s => ({ ...s, [depId]: { ...s[depId], state: newState } }))

          if (TERMINAL_STATES.has(newState.toUpperCase())) {
            // Refresh the full deployment list so the card shows the new last_run
            loadDeployments()
            // Clear this entry a few seconds later so the user sees the final colour
            setTimeout(() => {
              setActiveRuns(s => { const n = { ...s }; delete n[depId]; return n })
            }, 5000)
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
      setActiveRuns(s => ({ ...s, [dep.id]: { flowRunId: data.flow_run_id, state: 'SCHEDULED' } }))
    } catch (_) {
      setActiveRuns(s => ({ ...s, [dep.id]: { flowRunId: null, state: 'ERROR' } }))
      setTimeout(() => {
        setActiveRuns(s => { const n = { ...s }; delete n[dep.id]; return n })
      }, 5000)
    } finally {
      setTriggering(s => { const n = { ...s }; delete n[dep.id]; return n })
    }
  }

  const apiUsage = auxData?.api_usage || {}
  const jobs     = auxData?.jobs      || []
  const deps     = deployments        || []

  // Schedule table: split into daily / scheduled / manual, each sorted by next_run_epoch
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
              const btn = runButton(dep, triggering, activeRuns)
              return (
                <div key={dep.id} className={`cron-card ${cardClass(dep, activeRuns)}`}>
                  <div className="cron-name">{dep.name}</div>
                  {dep.description && (
                    <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: '6px', lineHeight: 1.4 }}>
                      {dep.description}
                    </div>
                  )}
                  <div style={{ marginBottom: '6px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {(() => {
                      const active = activeRuns[dep.id]
                      if (active) {
                        const s = active.state || 'SCHEDULED'
                        return <Badge variant={stateVariant(s)}>{s.charAt(0) + s.slice(1).toLowerCase()}</Badge>
                      }
                      return dep.last_run
                        ? <Badge variant={stateVariant(dep.last_run.state_type)}>
                            {dep.last_run.state_name || dep.last_run.state_type || '—'}
                          </Badge>
                        : <Badge variant="dim">Never run</Badge>
                    })()}
                    {dep.paused && <Badge variant="yellow">paused</Badge>}
                  </div>
                  {dep.last_run && (
                    <>
                      <div className="cron-time">
                        {dep.last_run.start_time} · {timeSince(dep.last_run.start_time_iso)}
                      </div>
                      {dep.last_run.duration_human && (
                        <div className="cron-time">{dep.last_run.duration_human}</div>
                      )}
                    </>
                  )}
                  <div style={{ marginTop: '10px' }}>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: '11px', padding: '3px 10px', width: '100%', justifyContent: 'center' }}
                      disabled={btn.disabled}
                      onClick={() => triggerRun(dep)}
                    >
                      {btn.text}
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
    </>
  )
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
