import { useState, useEffect, useRef } from 'react'
import { apiJson, apiFetch } from '../api'
import { Badge } from '../components/Badge'
import { Modal } from '../components/Modal'

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

function RunButton({ depId, triggering, trigResult, onRun }) {
  if (!depId) return null
  const isRunning = triggering.has(depId)
  const result    = trigResult[depId]
  return (
    <button
      className="btn btn-ghost"
      style={{ fontSize: '11px', padding: '3px 10px' }}
      onClick={() => onRun(depId)}
      disabled={isRunning}
    >
      {isRunning
        ? 'Running…'
        : result === 'ok'
          ? '✓ Triggered'
          : result === 'error'
            ? '✗ Failed'
            : '▶ Run Now'}
    </button>
  )
}

function Section({ title, cards, depId, triggering, trigResult, onRun }) {
  return (
    <div className="backup-section">
      <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span className="card-title">{title}</span>
        <RunButton depId={depId} triggering={triggering} trigResult={trigResult} onRun={onRun} />
      </div>
      {cards.map(({ label, info }) => <BackupCard key={label} label={label} info={info} />)}
    </div>
  )
}

// ── Restore modal ─────────────────────────────────────────────────────────────

function lineColor(level, text) {
  if (level === 'error')   return 'var(--red)'
  if (level === 'success') return 'var(--green)'
  if (text.startsWith('✓')) return 'var(--green)'
  if (text.startsWith('✗')) return 'var(--red)'
  if (text.startsWith('ℹ')) return 'var(--accent)'
  return 'var(--text)'
}

function formatSize(bytes) {
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB'
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(1) + ' KB'
  return bytes + ' B'
}

function RestoreModal({ open, onClose }) {
  const [phase, setPhase]           = useState('configure') // configure | confirm | stream
  const [backups, setBackups]       = useState(null)
  const [listError, setListError]   = useState('')
  const [listLoading, setLoading]   = useState(false)
  const [selected, setSelected]     = useState(null)
  const [isLive, setIsLive]         = useState(false)
  const [confirmText, setConfirm]   = useState('')
  const [lines, setLines]           = useState([])
  const [streamDone, setStreamDone] = useState(null) // null | 'done' | 'restarting'
  const esRef     = useRef(null)
  const outputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    resetConfigure()
    loadBackups()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [lines])

  useEffect(() => {
    return () => { if (esRef.current) { esRef.current.close(); esRef.current = null } }
  }, [])

  function resetConfigure() {
    setPhase('configure')
    setSelected(null)
    setConfirm('')
    setLines([])
    setStreamDone(null)
    setIsLive(false)
    if (esRef.current) { esRef.current.close(); esRef.current = null }
  }

  async function loadBackups() {
    setLoading(true)
    setListError('')
    try {
      const d = await apiJson('/api/database/restore/list')
      if (d.error) throw new Error(d.error)
      setBackups(d.backups || [])
    } catch (e) {
      setListError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function startStream(live) {
    setLines([])
    setStreamDone(null)
    setIsLive(live)
    setPhase('stream')

    const params = new URLSearchParams({ filename: selected, live: String(live) })
    const es = new EventSource(`/api/database/restore/stream?${params}`)
    esRef.current = es

    es.onmessage = (event) => {
      const sep   = event.data.indexOf('|')
      const level = sep >= 0 ? event.data.slice(0, sep).trim() : 'info'
      const text  = sep >= 0 ? event.data.slice(sep + 1) : event.data
      setLines(prev => [...prev, { level, text }])
    }

    es.onerror = () => {
      es.close()
      esRef.current = null
      setStreamDone(live ? 'restarting' : 'done')
      if (live) {
        setTimeout(() => window.location.reload(), 60000)
      }
    }
  }

  function handleClose() {
    if (esRef.current) { esRef.current.close(); esRef.current = null }
    if (streamDone === 'restarting') {
      window.location.reload()
    } else {
      onClose()
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="⚠ Restore from Backup" width="min(700px, 94vw)">

      {/* ── Phase: configure ── */}
      {phase === 'configure' && (
        <div>
          <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '20px' }}>
            Select a backup from Cloudflare R2 to inspect or restore. A dry run is safe — it shows
            what the backup contains without touching the live database.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <label className="field-label" style={{ margin: 0 }}>Available backups</label>
            <button
              className="btn btn-ghost"
              style={{ fontSize: '11px', padding: '3px 10px' }}
              onClick={loadBackups}
              disabled={listLoading}
            >
              {listLoading ? 'Loading…' : '↺ Refresh'}
            </button>
          </div>

          {listLoading && !backups && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-dim)', marginBottom: '16px' }}>Loading…</div>
          )}
          {listError && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--red)', marginBottom: '16px' }}>{listError}</div>
          )}

          {backups && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: '20px' }}>
              {backups.length === 0 ? (
                <div style={{ padding: '16px', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-dim)' }}>
                  No backups found.
                </div>
              ) : backups.map((b, i) => (
                <div
                  key={b.filename}
                  onClick={() => setSelected(b.filename)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', cursor: 'pointer',
                    background: selected === b.filename ? 'var(--red-lo)' : 'transparent',
                    borderLeft: selected === b.filename ? '3px solid var(--red)' : '3px solid transparent',
                    borderBottom: i < backups.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-hi)' }}>{b.filename}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>{formatSize(b.size_bytes)}</div>
                  </div>
                  {selected === b.filename && (
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--red)', flexShrink: 0 }}>Selected</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={handleClose}>Cancel</button>
            <button
              className="btn btn-ghost"
              onClick={() => startStream(false)}
              disabled={!selected}
              style={{ opacity: selected ? 1 : 0.4, cursor: selected ? 'pointer' : 'not-allowed' }}
            >
              Dry Run
            </button>
            <button
              className="btn btn-danger"
              onClick={() => { setConfirm(''); setPhase('confirm') }}
              disabled={!selected}
              style={{ opacity: selected ? 1 : 0.4, cursor: selected ? 'pointer' : 'not-allowed' }}
            >
              Restore Live Database…
            </button>
          </div>
        </div>
      )}

      {/* ── Phase: confirm ── */}
      {phase === 'confirm' && (
        <div>
          <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '16px' }}>
            Restoring:{' '}
            <code style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}>{selected}</code>
          </p>

          <div style={{ background: 'var(--red-lo)', border: '1px solid var(--red)', borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: '16px' }}>
            <p style={{ fontSize: '12px', color: 'var(--red)', marginBottom: '10px' }}>
              This will stop the ingest service, replace the live database, and restart. The Dashboard
              will remain available but the API will be offline for ~1 minute.{' '}
              <strong>ALL DATA collected since this backup will be permanently lost.</strong>
            </p>
            <p style={{ fontSize: '12px', color: 'var(--red)', marginBottom: '10px' }}>
              Type{' '}
              <code style={{ fontFamily: 'var(--mono)', background: 'rgba(0,0,0,.3)', padding: '1px 5px', borderRadius: '3px' }}>RESTORE</code>
              {' '}to confirm.
            </p>
            <input
              type="text"
              value={confirmText}
              placeholder="RESTORE"
              onChange={e => setConfirm(e.target.value)}
              style={{
                background: 'var(--bg)', border: '1px solid var(--border2)',
                color: 'var(--text-hi)', borderRadius: 'var(--radius)',
                padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: '13px',
                width: '100%', outline: 'none',
              }}
            />
          </div>

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setPhase('configure')}>← Back</button>
            <button
              className="btn btn-danger"
              onClick={() => startStream(true)}
              disabled={confirmText !== 'RESTORE'}
              style={{ opacity: confirmText !== 'RESTORE' ? 0.4 : 1, cursor: confirmText !== 'RESTORE' ? 'not-allowed' : 'pointer' }}
            >
              Confirm Restore
            </button>
          </div>
        </div>
      )}

      {/* ── Phase: stream ── */}
      {phase === 'stream' && (
        <div>
          <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '12px' }}>
            {isLive ? 'Live restore' : 'Dry run'}:{' '}
            <code style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}>{selected}</code>
          </p>

          <div
            ref={outputRef}
            style={{
              background: '#0d0f14', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              padding: '12px 14px', fontFamily: 'var(--mono)', fontSize: '12px',
              height: '320px', overflowY: 'auto', marginBottom: '16px', lineHeight: 1.6,
            }}
          >
            {lines.length === 0 && !streamDone && (
              <span style={{ color: 'var(--text-dim)' }}>Connecting…</span>
            )}
            {lines.map((line, i) => (
              <div key={i} style={{ color: lineColor(line.level, line.text) }}>{line.text}</div>
            ))}
          </div>

          {streamDone === 'done' && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--green)', marginBottom: '12px' }}>
              ✓ Done.
            </div>
          )}
          {streamDone === 'restarting' && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-dim)', marginBottom: '12px' }}>
              Ingest service is restarting. This page will attempt to reconnect in 1 minute.
            </div>
          )}

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={handleClose}>
              {streamDone === 'restarting' ? 'Reload Now' : 'Close'}
            </button>
            {streamDone === 'done' && !isLive && (
              <button
                className="btn btn-danger"
                onClick={() => { setConfirm(''); setPhase('confirm') }}
              >
                Restore Live Database…
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const BACKUP_DEP_NAMES = ['backup-db', 'backup-db-to-cloudflare']

export default function Backups() {
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [restoreOpen, setRestore] = useState(false)
  const [depIds, setDepIds]       = useState({})   // name → prefect deployment id
  const [triggering, setTriggering] = useState(new Set())
  const [trigResult, setTrigResult] = useState({}) // depId → 'ok' | 'error'

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

  async function loadDeployments() {
    try {
      const deps = await apiJson('/api/prefect/deployments')
      if (!Array.isArray(deps)) return
      const map = {}
      for (const dep of deps) {
        if (BACKUP_DEP_NAMES.includes(dep.name)) map[dep.name] = dep.id
      }
      setDepIds(map)
    } catch (_) {}
  }

  async function triggerBackup(depId) {
    setTriggering(s => new Set([...s, depId]))
    try {
      const resp = await apiFetch(`/api/prefect/run/${depId}`, { method: 'POST' })
      const result = resp.ok ? 'ok' : 'error'
      setTrigResult(s => ({ ...s, [depId]: result }))
      setTimeout(() => setTrigResult(s => { const n = { ...s }; delete n[depId]; return n }), 4000)
    } catch (_) {
      setTrigResult(s => ({ ...s, [depId]: 'error' }))
      setTimeout(() => setTrigResult(s => { const n = { ...s }; delete n[depId]; return n }), 4000)
    } finally {
      setTriggering(s => { const n = new Set(s); n.delete(depId); return n })
    }
  }

  useEffect(() => { load(); loadDeployments() }, [])

  const local     = data?.local  || {}
  const remote    = data?.remote || null
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
          <Section title="Remote (Cloudflare R2)" cards={[{ label: 'Cloudflare R2 (DB)', info: remote }]}
            depId={depIds['backup-db-to-cloudflare']} triggering={triggering} trigResult={trigResult} onRun={triggerBackup} />
          <Section title="Local — Database" cards={[{ label: 'Database', info: local.db }]}
            depId={depIds['backup-db']} triggering={triggering} trigResult={trigResult} onRun={triggerBackup} />
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

      {/* Danger zone */}
      <div style={{ marginTop: '40px', border: '1px solid var(--red)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--red)', background: 'var(--red-lo)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: 'var(--red)', fontSize: '15px' }}>⚠</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--red)' }}>Danger Zone</span>
        </div>

        <div style={{ background: 'var(--surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', gap: '16px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '13px', color: 'var(--text-hi)', marginBottom: '3px' }}>Restore from Backup</div>
              <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                Replace the live database with a backup from Cloudflare R2. Supports dry run and live restore.
              </div>
            </div>
            <button className="btn btn-danger" style={{ flexShrink: 0 }} onClick={() => setRestore(true)}>Restore…</button>
          </div>
        </div>
      </div>

      <RestoreModal open={restoreOpen} onClose={() => setRestore(false)} />
    </>
  )
}
