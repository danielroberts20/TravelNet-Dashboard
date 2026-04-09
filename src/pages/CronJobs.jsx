import { useState, useEffect } from 'react'
import { apiJson } from '../api'
import { Badge } from '../components/Badge'
import { Card } from '../components/Card'

const KNOWN_JOBS = [
  'get_fx', 'get_fx_up_to_date', 'backfill_gbp', 'backfill_place',
  'send_warn_error_log', 'reset_api_usage', 'get_weather', 'backup_db',
  'check_health_gaps', 'push_public_stats', 'geocode_places', 'run_tests',
]

const API_LIMITS = { 'exchangerate.host': 100, 'open-meteo': 300000 }

function timeSince(ts) {
  const mins = Math.floor((Date.now() / 1000 - ts) / 60)
  if (mins < 60)   return mins + 'm ago'
  if (mins < 1440) return Math.floor(mins / 60) + 'h ago'
  return Math.floor(mins / 1440) + 'd ago'
}

function levelVariant(lvl) {
  if (!lvl) return 'dim'
  if (lvl === 'ERROR' || lvl === 'CRITICAL') return 'red'
  if (lvl === 'WARNING') return 'yellow'
  if (lvl === 'INFO')    return 'blue'
  return 'dim'
}

export default function CronJobs() {
  const [data,     setData]     = useState(null)
  const [runs,     setRuns]     = useState({})
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    Promise.all([
      apiJson('/api/crons'),
      apiJson('/api/cron-runs'),
    ]).then(([d, r]) => {
      setData(d)
      setRuns(r)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const scheduleRows    = data?.schedule_rows || []
  const dailyRows       = scheduleRows.filter(r => r.schedule.includes('daily'))
  const scheduledRows   = scheduleRows.filter(r => !r.schedule.includes('daily'))
  const apiUsage        = data?.api_usage || {}
  const jobs            = data?.jobs || []

  return (
    <>
      <div className="page-header">
        <h1>Cron Jobs</h1>
        <p>Last-run status and scheduled task history. Crons run at host level.</p>
      </div>

      {/* Status cards */}
      <div style={{ marginBottom:'8px' }}><span className="card-title">Last Run Status</span></div>
      <div className="cron-status-grid">
        {loading
          ? <div style={{ fontFamily:'var(--mono)', fontSize:'12px', color:'var(--text-dim)' }}>Loading…</div>
          : KNOWN_JOBS.map(job => {
              const run = runs[job]
              if (!run) {
                return (
                  <div key={job} className="cron-card unknown">
                    <div className="cron-name">{job}</div>
                    <div style={{ fontSize:'12px', color:'var(--text-dim)', fontStyle:'italic' }}>Never recorded</div>
                  </div>
                )
              }
              const cls = run.success ? 'success' : 'failure'
              return (
                <div key={job} className={`cron-card ${cls}`}>
                  <div className="cron-name">{job}</div>
                  <div style={{ marginBottom:'6px' }}>
                    <Badge variant={run.success ? 'green' : 'red'}>{run.success ? '✓ ok' : '✗ failed'}</Badge>
                  </div>
                  <div className="cron-time">{run.ts_human} · {timeSince(run.timestamp)}</div>
                  {run.detail && <div className="cron-detail" title={run.detail}>{run.detail}</div>}
                </div>
              )
            })
        }
      </div>

      {/* Schedule reference */}
      <div style={{ marginBottom:'8px' }}><span className="card-title">Schedule Reference</span></div>
      <Card style={{ marginBottom:'24px' }}>
        <div style={{ fontFamily:'var(--mono)', fontSize:'11px', color:'var(--text-dim)', marginBottom:'8px' }}>Daily</div>
        <div className="table-wrap" style={{ marginBottom:'20px' }}>
          <table>
            <thead><tr><th>Script</th><th>Schedule</th><th>Description</th></tr></thead>
            <tbody>
              {dailyRows.map(r => (
                <tr key={r.script}>
                  <td>{r.script}</td><td>{r.schedule}</td><td>{r.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontFamily:'var(--mono)', fontSize:'11px', color:'var(--text-dim)', marginBottom:'8px' }}>Scheduled</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Script</th><th>Schedule</th><th>Description</th></tr></thead>
            <tbody>
              {scheduledRows.map(r => (
                <tr key={r.script}>
                  <td>{r.script}</td><td>{r.schedule}</td><td>{r.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* API usage */}
      {Object.keys(apiUsage).length > 0 && (
        <>
          <div style={{ marginBottom:'8px' }}><span className="card-title">API Usage</span></div>
          <Card style={{ marginBottom:'24px' }}>
            {Object.entries(apiUsage).map(([name, svc], i, arr) => {
              const limit = API_LIMITS[name] || 1
              const pct   = Math.round(parseInt(svc.count || 0) / limit * 1000) / 10
              const barClass = pct > 85 ? 'danger' : pct > 65 ? 'warn' : ''
              return (
                <div key={name} style={{ marginBottom: i < arr.length - 1 ? '16px' : 0 }}>
                  <div style={{ fontFamily:'var(--mono)', fontSize:'12px', color:'var(--text-dim)', marginBottom:'8px' }}>{name}</div>
                  <div className="grid grid-3" style={{ marginBottom:'8px' }}>
                    <div><div className="stat-label">Calls this month</div>
                      <div style={{ fontFamily:'var(--mono)', fontSize:'20px', color:'var(--text-hi)' }}>{svc.count ?? '—'}</div></div>
                    <div><div className="stat-label">Month</div>
                      <div style={{ fontFamily:'var(--mono)', fontSize:'20px', color:'var(--text-hi)' }}>{svc.month ?? '—'}</div></div>
                    <div><div className="stat-label">Monthly limit</div>
                      <div style={{ fontFamily:'var(--mono)', fontSize:'20px', color:'var(--text-hi)' }}>{limit.toLocaleString()}</div></div>
                  </div>
                  <div className="progress-bar-bg" style={{ height:'6px' }}>
                    <div className={`progress-bar-fill${barClass ? ' ' + barClass : ''}`} style={{ width: Math.min(pct,100) + '%' }} />
                  </div>
                  <div style={{ fontSize:'11px', color:'var(--text-dim)', marginTop:'4px' }}>{pct}% of monthly quota used</div>
                  {i < arr.length - 1 && <hr style={{ border:'none', borderTop:'1px solid var(--border)', margin:'8px 0 16px' }} />}
                </div>
              )
            })}
          </Card>
        </>
      )}

      {/* Log digest */}
      <div style={{ marginBottom:'8px' }}><span className="card-title">Log Digest History</span></div>
      <Card>
        {jobs.length === 0
          ? <p style={{ fontFamily:'var(--mono)', fontSize:'13px', color:'var(--text-dim)' }}>
              No log digest entries found.
            </p>
          : <div className="table-wrap">
              <table>
                <thead><tr><th>Level</th><th>Logger / Job</th><th>Message</th><th>Timestamp</th></tr></thead>
                <tbody>
                  {jobs.map((row, i) => {
                    const lvl = row.levelname || row.level || ''
                    return (
                      <tr key={i}>
                        <td><Badge variant={levelVariant(lvl)}>{lvl || '—'}</Badge></td>
                        <td className="dim">{row.name || row.logger || '—'}</td>
                        <td>{(row.message || row.msg || '—').slice(0, 160)}</td>
                        <td className="dim" style={{ whiteSpace:'nowrap' }}>
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
