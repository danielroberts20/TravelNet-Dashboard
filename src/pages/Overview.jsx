import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiJson } from '../api'
import { Badge } from '../components/Badge'
import { StatTile } from '../components/StatTile'
import { Card } from '../components/Card'
import { timeSince, groupTablesByDomain, defaultGroupExpanded } from '../utils'

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

function DiskRow({ label, pct, usedGb, totalGb, smart, isSsd }) {
  const barClass = pct != null && !isNaN(pct) ? (pct > 85 ? ' danger' : pct > 70 ? ' warn' : '') : ''
  const healthOk = smart?.health === 'PASSED'
  const healthColor = smart?.health === 'PASSED' ? 'var(--green)' : smart?.health === 'FAILED' ? 'var(--red)' : 'var(--text-dim)'
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '3px' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          {smart ? (
            <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: healthColor, fontWeight: 600 }}>
              {smart.health}
            </span>
          ) : smart === null ? (
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-dim)', opacity: 0.5 }}>no SMART</span>
          ) : null}
          <span style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--text-hi)', fontWeight: 600 }}>
            {pct != null ? `${pct}%` : '—'}
          </span>
        </div>
      </div>
      {usedGb != null && (
        <div className="stat-sub" style={{ marginBottom: '5px' }}>{usedGb} / {totalGb} GB</div>
      )}
      <div className="progress-bar-bg" style={{ height: '5px', marginBottom: smart ? '5px' : 0 }}>
        <div className={`progress-bar-fill${barClass}`} style={{ width: Math.min(pct || 0, 100) + '%' }} />
      </div>
      {smart && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', marginTop: '4px' }}>
          {smart.temperature_c != null && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
              {smart.temperature_c}°C
            </span>
          )}
          {smart.power_on_hours != null && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
              {Math.round(smart.power_on_hours / 24 / 30)}mo on
            </span>
          )}
          {smart.reallocated_sectors != null && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: smart.reallocated_sectors > 0 ? 'var(--yellow)' : 'var(--text-dim)' }}>
              {smart.reallocated_sectors} realloc
            </span>
          )}
          {isSsd && smart.wear_leveling_count != null && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: smart.wear_leveling_count < 10 ? 'var(--red)' : 'var(--text-dim)' }}>
              wear {smart.wear_leveling_count}
            </span>
          )}
          {isSsd && smart.total_host_writes_gb != null && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
              {smart.total_host_writes_gb >= 1000
                ? `${(smart.total_host_writes_gb / 1000).toFixed(1)} TB written`
                : `${smart.total_host_writes_gb} GB written`}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function OverviewDbGroups({ tables }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(defaultGroupExpanded)
  const groups = groupTablesByDomain(tables)

  function toggle(label) {
    setExpanded(prev => ({ ...prev, [label]: !prev[label] }))
  }

  return (
    <>
      {groups.map(group => {
        const isOpen = expanded[group.label] ?? true
        return (
          <div key={group.label} style={{ marginBottom: '6px' }}>
            <div
              onClick={() => toggle(group.label)}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '8px 14px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: isOpen ? 'var(--radius) var(--radius) 0 0' : 'var(--radius)',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 600, color: 'var(--text-hi)', flex: 1 }}>
                {group.label}
              </span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)' }}>
                {group.rows.length} {group.rows.length === 1 ? 'table' : 'tables'}
              </span>
              <span style={{
                color: 'var(--text-dim)', fontSize: '11px',
                display: 'inline-block',
                transition: 'transform .15s',
                transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
              }}>
                ▾
              </span>
            </div>
            {isOpen && (
              <div style={{
                border: '1px solid var(--border)',
                borderTop: 'none',
                borderRadius: '0 0 var(--radius) var(--radius)',
                overflow: 'hidden',
              }}>
                <table style={{ margin: 0 }}>
                  <tbody>
                    {group.rows.map(t => (
                      <tr
                        key={t.name}
                        onClick={() => navigate(`/db/table/${encodeURIComponent(t.name)}`)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td style={{ paddingLeft: '24px' }}>{t.name}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>
                          <span className="badge badge-dim">{t.count != null ? Number(t.count).toLocaleString() : '—'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

const WATCHDOG_CHECK_ORDER = ['internet', 'tailscale', 'api', 'shelly', 'cloudflare', 'prefect', 'ssh_tailscale', 'ssh_lan']

function formatWatchdogTime(ts) {
  if (!ts) return null
  const parts = ts.split(' ')
  if (parts.length < 2) return ts
  return parts[1].split(',')[0]
}

export default function Overview() {
  const [overview,   setOverview]   = useState(null)
  const [status,     setStatus]     = useState(null)
  const [backups,    setBackups]    = useState(null)
  const [watchdog,   setWatchdog]   = useState(null)
  const [sysHealth,  setSysHealth]  = useState(null)
  const [fetchError, setFetchError] = useState(null)
  const [wdExpanded, setWdExpanded] = useState(false)

  useEffect(() => {
    apiJson('/api/overview').then(setOverview).catch(() => setFetchError('Failed to load overview data'))
    apiJson('/api/status').then(setStatus).catch(() => setFetchError('Failed to load status data'))
    apiJson('/api/backups').then(setBackups).catch(() => setFetchError('Failed to load backup data'))
    apiJson('/api/watchdog/status').then(setWatchdog).catch(() => {})
    apiJson('/api/system-health').then(setSysHealth).catch(() => {})
    const wdInterval = setInterval(() => {
      apiJson('/api/watchdog/status').then(setWatchdog).catch(() => {})
    }, 60000)
    const healthInterval = setInterval(() => {
      apiJson('/api/system-health').then(setSysHealth).catch(() => {})
    }, 5000)
    return () => { clearInterval(wdInterval); clearInterval(healthInterval) }
  }, [])

  const h  = sysHealth || overview?.health || {}
  const sd = overview?.smart_data        // null = file missing, object = data present
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
        <div className="stat">
          <div className="stat-label">Disk</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
            <DiskRow label="SSD"
                     pct={overview?.ssd_disk?.pct} usedGb={overview?.ssd_disk?.used_gb} totalGb={overview?.ssd_disk?.total_gb}
                     smart={sd ? sd.ssd : (sd === null ? null : undefined)}
                     isSsd={true} />
            <div style={{ borderTop: '1px solid var(--border)', margin: '0' }} />
            <DiskRow label="HDD"
                     pct={overview?.hdd_disk?.pct} usedGb={overview?.hdd_disk?.used_gb} totalGb={overview?.hdd_disk?.total_gb}
                     smart={sd ? sd.hdd : (sd === null ? null : undefined)}
                     isSsd={false} />
          </div>
        </div>
        {h.temps && Object.keys(h.temps).length > 0
          ? Object.entries(h.temps).map(([label, temp]) => (
              <StatTile key={label} label={label}
                        value={<>{temp}<span style={{ fontSize:'14px', color:'var(--text-dim)' }}>°C</span></>}
                        pct={Math.min(temp / 85 * 100, 100)} />
            ))
          : <StatTile label="Temperature" value={<span className="dim" style={{ fontSize:'16px' }}>N/A</span>} sub='' />
        }
      </div>

      {/* Watchdog */}
      {(() => {
        const checks  = watchdog?.checks || {}
        const hasData = Object.keys(checks).length > 0
        const timeStr = formatWatchdogTime(watchdog?.timestamp)
        const ordered = [
          ...WATCHDOG_CHECK_ORDER.filter(k => k in checks),
          ...Object.keys(checks).filter(k => !WATCHDOG_CHECK_ORDER.includes(k)),
        ]
        const healthy = ordered.filter(k => checks[k].ok === true).length
        const failed  = ordered.filter(k => checks[k].ok === false).length
        const total   = healthy + failed
        const summaryColor = total === 0 ? 'var(--text-dim)' : failed > 0 ? 'var(--red)' : 'var(--green)'
        return (
          <>
            <style>{`
              @keyframes wd-pulse {
                0%, 100% { opacity: 1; box-shadow: 0 0 0 0 currentColor; }
                50%       { opacity: .7; box-shadow: 0 0 0 5px transparent; }
              }
              .wd-dot { animation: wd-pulse 4.8s ease-in-out infinite; }
            `}</style>
            <div style={{ marginBottom: '8px' }}><span className="card-title">Watchdog</span></div>
            <Card style={{ marginBottom: '24px' }}>
              {!hasData ? (
                <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-dim)' }}>
                  Unavailable
                </span>
              ) : (
                <>
                <div
                  onClick={() => setWdExpanded(v => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}
                >
                  <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: summaryColor, flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: summaryColor }}>
                    {total === 0 ? 'No data yet' : `${healthy}/${total} healthy`}
                  </span>
                  {timeStr && (
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)', marginLeft: 'auto' }}>
                      Last check: {timeStr}
                    </span>
                  )}
                  <span style={{
                    fontSize: '10px', color: 'var(--text-dim)', marginLeft: timeStr ? '0' : 'auto',
                    transform: wdExpanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s',
                  }}>
                    &#9656;
                  </span>
                </div>
                {wdExpanded && (
                  <div style={{
                    display: 'flex', flexDirection: 'column', marginTop: '16px',
                    border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden',
                  }}>
                    {ordered.map((key, i) => {
                      const check = checks[key]
                      const color = check.ok === true ? 'var(--green)' : check.ok === false ? 'var(--red)' : 'var(--text-dim)'
                      return (
                        <div
                          key={key}
                          title={check.detail || ''}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px',
                            borderTop: i === 0 ? 'none' : '1px solid var(--border)', cursor: 'default',
                          }}
                        >
                          <div className="wd-dot" style={{
                            width: '9px', height: '9px', borderRadius: '50%',
                            background: color, color, flexShrink: 0,
                          }} />
                          <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-hi)', textTransform: 'uppercase', letterSpacing: '.03em', flex: 1 }}>
                            {key}
                          </span>
                          {check.detail && (
                            <span style={{
                              fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)',
                              maxWidth: '50%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {check.detail}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                </>
              )}
            </Card>
          </>
        )
      })()}

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
      <div style={{ marginBottom:'24px' }}>
        {!overview
          ? <Card><span className="dim">Loading…</span></Card>
          : <OverviewDbGroups tables={overview.tables || []} />
        }
      </div>

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
