import { useState, useEffect } from 'react'
import { apiJson } from '../api'
import { Badge } from '../components/Badge'

function timeSince(ts) {
  if (!ts) return '—'
  const secs = Math.floor(Date.now() / 1000) - ts
  const days = Math.floor(secs / 86400)
  const hrs  = Math.floor((secs % 86400) / 3600)
  const mins = Math.floor((secs % 3600) / 60)
  if (days > 0) return `${days}d ${hrs}h ago`
  if (hrs > 0)  return `${hrs}h ${mins}m ago`
  return `${mins}m ago`
}

function BackupCard({ label, info }) {
  if (!info) {
    return (
      <div className="backup-card empty">
        <div><div className="backup-label">{label}</div></div>
        <div className="dim" style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>No backup found</div>
        <div />
      </div>
    )
  }
  if (info.error) {
    return (
      <div className="backup-card error">
        <div><div className="backup-label">{label}</div></div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--red)' }}>{info.error}</div>
        <div />
      </div>
    )
  }
  const cls = info.stale ? 'stale' : 'ok'
  return (
    <div className={`backup-card ${cls}`}>
      <div>
        <div className="backup-label">{label}</div>
        <div className="backup-meta">{info.filename}</div>
      </div>
      <div>
        <Badge variant={info.stale ? 'red' : 'green'}>{info.stale ? '⚠ Stale' : '✓ OK'}</Badge>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)', marginLeft: '10px' }}>
          {info.modified} · {timeSince(info.modified_ts)}
        </span>
        <div className="backup-meta" style={{ marginTop: '4px' }}>{info.size_mb} MB</div>
      </div>
      <div className="backup-count">{info.count} backup{info.count !== 1 ? 's' : ''} stored</div>
    </div>
  )
}

function Section({ title, cards }) {
  return (
    <div className="backup-section">
      <div style={{ marginBottom: '8px' }}><span className="card-title">{title}</span></div>
      {cards.map(({ label, info }) => <BackupCard key={label} label={label} info={info} />)}
    </div>
  )
}

export default function Backups() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const d = await apiJson('/api/backups')
      if (d.error) throw new Error(d.error)
      setData(d)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const local  = data?.local  || {}
  const remote = data?.remote || null
  const staleDays = data?.stale_days ?? 7

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1>Backups</h1>
            <p>Local and remote backup status. Stale threshold: {staleDays} days.</p>
          </div>
          <button className="btn btn-ghost" onClick={load}>↺ Refresh</button>
        </div>
      </div>

      {loading && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--text-dim)', marginBottom: '16px' }}>
          Loading…
        </div>
      )}
      {error && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--red)', marginBottom: '16px' }}>
          Failed to load: {error}
        </div>
      )}

      {data && (
        <>
          <Section title="Remote (Cloudflare R2)" cards={[{ label: 'Cloudflare R2 (DB)', info: remote }]} />
          <Section title="Local — Database"       cards={[{ label: 'Database', info: local.db }]} />
          <Section title="Local — Uploads" cards={[
            { label: 'Health',                   info: local.health },
            { label: 'Workouts',                 info: local.workouts },
            { label: 'Location (Shortcuts)',     info: local.location?.shortcut || local.location },
            { label: 'Location (Overland)',      info: local.location?.overland || local.location },
            { label: 'Revolut',                  info: local.revolut },
            { label: 'Wise',                     info: local.wise },
            { label: 'FX Rates',                 info: local.fx },
          ]} />
        </>
      )}
    </>
  )
}
