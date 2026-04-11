import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { apiJson } from '../api'
import { Badge } from '../components/Badge'
import { StatTile } from '../components/StatTile'
import { Card } from '../components/Card'
import { timeSince } from '../utils'

const SOURCE_LABELS = {
  location_shortcuts: 'Location (Shortcuts)',
  location_overland:  'Location (Overland)',
  health:             'Health',
  transactions:       'Transactions',
  fx_rates:           'FX Rates',
  workouts:           'Workouts',
}

const API_LIMITS = { 'exchangerate.host': 100, 'open-meteo': 300000 }

const formatPct = v =>
  v != null ? (
    <>
      {v}
      <span style={{ fontSize: '14px', color: 'var(--text-dim)' }}> %</span>
    </>
  ) : '—';

function staleVariant(ts) {
  if (!ts) return 'red'
  const hrs = (Date.now() - (typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts))) / 3600000
  if (hrs > 48) return 'red'
  if (hrs > 25) return 'yellow'
  return 'green'
}

export default function Overview() {
  const [overview,   setOverview]   = useState(null)
  const [status,     setStatus]     = useState(null)
  const [backups,    setBackups]    = useState(null)
  const [fetchError, setFetchError] = useState(null)

  useEffect(() => {
    apiJson('/api/overview').then(setOverview).catch(() => setFetchError('Failed to load overview data'))
    apiJson('/api/status').then(setStatus).catch(() => setFetchError('Failed to load status data'))
    apiJson('/api/backups').then(setBackups).catch(() => setFetchError('Failed to load backup data'))
  }, [])

  const h = overview?.health || {}
  const now = overview?.now ? new Date(overview.now) : new Date()
  const nowStr = now.toLocaleDateString('en-GB', { weekday:'long', day:'2-digit', month:'short', year:'numeric' })
               + ', ' + now.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }) + ' UTC'

  return (
    <>
      <div className="page-header">
        <h1>Overview</h1>
        <p>System health and quick stats — {nowStr}</p>
      </div>

      {fetchError && (
        <div style={{ fontFamily:'var(--mono)', fontSize:'12px', color:'var(--red)', marginBottom:'16px' }}>
          {fetchError}
        </div>
      )}

      {/* System health */}
      <div style={{ marginBottom: '8px' }}><span className="card-title">System Health</span></div>
      <div className="grid grid-4" style={{ marginBottom: '24px' }}>
        <StatTile label="CPU"        value={formatPct(h.cpu_pct)} valueStyle={{ fontSize: '26px' }}
                  sub='' pct={h.cpu_pct} />
        <StatTile label="RAM"        value={formatPct(h.ram_pct)}
                  sub={h.ram_used_gb != null ? `${h.ram_used_gb} / ${h.ram_total_gb} GB` : undefined}
                  pct={h.ram_pct} />
        <StatTile label="Disk (data)" value={formatPct(h.disk_pct)}
                  sub={h.disk_used_gb != null ? `${h.disk_used_gb} / ${h.disk_total_gb} GB` : undefined}
                  pct={h.disk_pct} />
        {h.temps && Object.keys(h.temps).length > 0
          ? Object.entries(h.temps).map(([label, temp]) => (
              <StatTile key={label} label={label}
                        value={<>{temp}<span style={{ fontSize:'14px', color:'var(--text-dim)' }}>°C</span></>}
                        pct={Math.min(temp / 85 * 100, 100)} />
            ))
          : <StatTile label="Temperature" value={<span className="dim" style={{ fontSize:'16px' }}>N/A</span>} sub='' />
        }
      </div>

      {/* API Usage */}
      {overview?.api_usage && Object.keys(overview.api_usage).length > 0 && (
        <>
          <div style={{ marginBottom: '8px' }}><span className="card-title">API Usage</span></div>
          <Card style={{ marginBottom: '24px' }}>
            {Object.entries(overview.api_usage).map(([name, svc], i, arr) => {
              const limit = API_LIMITS[name] || 1
              const calls = parseInt(svc.count || 0)
              const pct   = Math.round(calls / limit * 1000) / 10
              const barClass = pct > 85 ? 'danger' : pct > 65 ? 'warn' : ''
              return (
                <div key={name} style={{ marginBottom: i < arr.length - 1 ? '16px' : 0 }}>
                  <div style={{ fontFamily:'var(--mono)', fontSize:'12px', color:'var(--text-dim)', marginBottom:'8px' }}>
                    {name}
                  </div>
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

      {/* Server status */}
      <div style={{ marginBottom:'8px', display:'flex', alignItems:'center', gap:'12px' }}>
        <span className="card-title">Server Status</span>
        {!status && <span style={{ fontSize:'11px', color:'var(--text-dim)', fontFamily:'var(--mono)' }}>Loading…</span>}
      </div>
      <div className="grid grid-4" style={{ marginBottom:'24px' }}>
        <StatTile label="Pi Uptime"  value={status?.uptime?.pi  || '—'} valueStyle={{ fontSize:'18px' }} />
        <StatTile label="App Uptime" value={status?.uptime?.app || '—'} valueStyle={{ fontSize:'18px' }} />
        <StatTile label="DB Size"    value={status?.db?.size_mb ? status.db.size_mb + ' MB' : '—'}
                  sub={status?.db?.query_latency_ms ? status.db.query_latency_ms + 'ms latency' : undefined}
                  valueStyle={{ fontSize:'18px' }} />
        <StatTile label="Pending Digest"
                  value={<span style={{ color: (status?.pending_digest_records ?? 0) > 0 ? 'var(--yellow)' : 'var(--green)' }}>
                           {status?.pending_digest_records ?? '—'}
                         </span>}
                  sub="undigested warnings"
                  valueStyle={{ fontSize:'18px' }} />
      </div>

      {/* Last upload */}
      <div style={{ marginBottom:'8px' }}><span className="card-title">Last Upload</span></div>
      <Card style={{ marginBottom:'24px' }}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Source</th><th>Last Upload</th><th>Time Since</th></tr></thead>
            <tbody>
              {!status
                ? <tr><td colSpan={3} className="dim">Loading…</td></tr>
                : Object.entries(SOURCE_LABELS).map(([key, label]) => {
                    const ts    = status.last_upload?.[key]
                    const tsStr = ts ? (typeof ts === 'number'
                      ? new Date(ts * 1000).toISOString().replace('T',' ').slice(0,19) + ' UTC'
                      : ts) : '—'
                    return (
                      <tr key={key}>
                        <td style={{ color:'var(--text-hi)' }}>{label}</td>
                        <td className="dim">{tsStr}</td>
                        <td><Badge variant={staleVariant(ts)}>{timeSince(ts)}</Badge></td>
                      </tr>
                    )
                  })
              }
            </tbody>
          </table>
        </div>
      </Card>

      {/* DB tables */}
      <div style={{ marginBottom:'8px' }}><span className="card-title">Database Tables</span></div>
      <Card style={{ marginBottom:'24px' }}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Table</th><th>Rows</th><th>Resettable</th><th></th></tr></thead>
            <tbody>
              {!overview
                ? <tr><td colSpan={4} className="dim">Loading…</td></tr>
                : (overview.tables || []).map(t => (
                    <tr key={t.name}>
                      <td>{t.name}</td>
                      <td>{t.count}</td>
                      <td><Badge variant={t.resettable ? 'yellow' : 'dim'}>{t.resettable ? 'yes' : 'no'}</Badge></td>
                      <td>
                        <Link to={`/db/table/${t.name}`} className="btn btn-ghost"
                              style={{ padding:'4px 10px', fontSize:'11px' }}>view</Link>
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      </Card>

      {/* Recent log events */}
      {overview?.recent_logs?.length > 0 && (
        <>
          <div style={{ marginBottom:'8px' }}><span className="card-title">Recent Log Events</span></div>
          <Card>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Level</th><th>Logger</th><th>Message</th><th>Time</th></tr></thead>
                <tbody>
                  {overview.recent_logs.map((row, i) => {
                    const lvl = row.levelname || row.level || ''
                    const v   = lvl === 'ERROR' || lvl === 'CRITICAL' ? 'red'
                              : lvl === 'WARNING' ? 'yellow' : 'dim'
                    return (
                      <tr key={i}>
                        <td><Badge variant={v}>{lvl || '—'}</Badge></td>
                        <td className="dim">{row.name || row.logger || '—'}</td>
                        <td>{(row.message || row.msg || '—').slice(0, 120)}</td>
                        <td className="dim">{row.ts || row.created || row.timestamp || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* Backup summary */}
      <div style={{ marginBottom:'8px', display:'flex', alignItems:'center', gap:'12px' }}>
        <span className="card-title">Backups</span>
        {!backups && <span style={{ fontSize:'11px', color:'var(--text-dim)', fontFamily:'var(--mono)' }}>Loading…</span>}
        <Link to="/backups" className="btn btn-ghost"
              style={{ marginLeft:'auto', fontSize:'11px', padding:'4px 10px' }}>View all →</Link>
      </div>
      <Card style={{ marginBottom:'24px' }}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Source</th><th>Status</th><th>Latest</th></tr></thead>
            <tbody>
              {!backups
                ? <tr><td colSpan={3} className="dim">Loading…</td></tr>
                : (() => {
                    const local = backups.local || {}
                    const staleDays = backups.stale_days ?? 7
                    const rows = [
                      { label:'DB (local)',            info: local.db },
                      { label:'DB (remote)',           info: backups.remote },
                      { label:'Health',                info: local.health },
                      { label:'Workouts',              info: local.workouts },
                      { label:'Location (Shortcuts)',  info: local.location?.shortcut || local.location },
                      { label:'Location (Overland)',   info: local.location?.overland || local.location },
                      { label:'Revolut',               info: local.revolut },
                      { label:'Wise',                  info: local.wise },
                      { label:'FX',                    info: local.fx },
                    ]
                    return rows.map(({ label, info }) => {
                      const badge = !info ? <Badge variant="dim">No backup</Badge>
                                  : info.error ? <Badge variant="red">Error</Badge>
                                  : info.stale  ? <Badge variant="red">⚠ Stale</Badge>
                                  : <Badge variant="green">✓ OK</Badge>
                      const sub = !info ? '—'
                                : info.error ? info.error
                                : `${info.modified} · ${info.size_mb} MB`
                      return (
                        <tr key={label}>
                          <td style={{ color:'var(--text-hi)' }}>{label}</td>
                          <td>{badge}</td>
                          <td className="dim" style={{ fontSize:'11px' }}>{sub}</td>
                        </tr>
                      )
                    })
                  })()
              }
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
