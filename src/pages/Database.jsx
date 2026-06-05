import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch, apiJson } from '../api'
import { Modal } from '../components/Modal'
import { groupTablesByDomain, defaultGroupExpanded } from '../utils'

// ── Prune modal ──────────────────────────────────────────────────────────────

function localToUtcStr(localVal) {
  if (!localVal) return null
  return new Date(localVal).toISOString().slice(0, 19)
}

function getTimezoneInfo() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const offsetMins = -new Date().getTimezoneOffset()
  const sign = offsetMins >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMins)
  const offsetStr = sign + String(Math.floor(abs / 60)).padStart(2, '0') + ':' + String(abs % 60).padStart(2, '0')
  return { tz, offsetStr }
}

function todayMidnightLocal() {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const pad = n => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T00:00`
}

function PruneModal({ open, onClose, onDone }) {
  const [phase, setPhase]             = useState('configure') // configure | preview | result
  const [meta, setMeta]               = useState(null)        // { tables, cascade_only, pre_delete, cascade_parents, default }
  const [cutoff, setCutoff]           = useState('')
  const [configError, setConfigErr]   = useState('')
  const [previewData, setPreview]     = useState(null)        // { counts, totals, cutoffUtc }
  const [confirmText, setConfirm]     = useState('')
  const [previewError, setPreviewErr] = useState('')
  const [resultData, setResult]       = useState(null)
  const [loading, setLoading]         = useState(false)

  useEffect(() => {
    if (!open) return
    setPhase('configure')
    setConfigErr('')
    setPreviewErr('')
    setConfirm('')
    if (!cutoff) setCutoff(todayMidnightLocal())

    if (!meta) {
      apiJson('/api/db/prune/tables').then(d => setMeta(d)).catch(e => {
        setConfigErr('Failed to load table list: ' + e.message)
      })
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived sets from meta ─────────────────────────────────────────────────
  const cascadeSet   = new Set(meta?.cascade_only ?? [])
  const preDeleteSet = new Set(meta?.pre_delete   ?? [])
  const defaultSet   = new Set(meta?.default      ?? [])

  const [checked, setChecked] = useState({})

  useEffect(() => {
    if (meta) {
      const initial = {}
      meta.tables.forEach(t => { initial[t] = defaultSet.has(t) })
      setChecked(initial)
    }
  }, [meta]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleTable(name, val) {
    const isDisabled = cascadeSet.has(name) || preDeleteSet.has(name)
    if (isDisabled) return

    setChecked(prev => {
      const next = { ...prev, [name]: val }
      // When a parent table is toggled, its cascade/pre-delete children follow.
      // Uses cascade_parents from the API so the frontend never hardcodes relationships.
      Object.entries(meta.cascade_parents ?? {}).forEach(([child, parent]) => {
        if (parent === name) next[child] = val
      })
      return next
    })
  }

  function selectAll(val) {
    if (!meta) return
    const next = {}
    if (!val) {
      // Deselect everything, including cascade/pre-delete tables that were
      // checked automatically when their parents were selected.
      meta.tables.forEach(t => { next[t] = false })
    } else {
      // Select all directly-toggleable tables and propagate to their children,
      // mirroring what toggleTable does for individual rows.
      meta.tables.forEach(t => {
        const isDisabled = cascadeSet.has(t) || preDeleteSet.has(t)
        if (!isDisabled) {
          next[t] = true
          Object.entries(meta.cascade_parents ?? {}).forEach(([child, parent]) => {
            if (parent === t) next[child] = true
          })
        }
      })
    }
    setChecked(prev => ({ ...prev, ...next }))
  }

  const selectedTables = meta ? meta.tables.filter(t => checked[t]) : []

  const { tz, offsetStr } = getTimezoneInfo()
  const cutoffUtcPreview = cutoff ? localToUtcStr(cutoff) : null

  async function runPreview() {
    setConfigErr('')
    if (!cutoff) { setConfigErr('Please select a cutoff date and time.'); return }
    if (selectedTables.length === 0) { setConfigErr('Select at least one table.'); return }

    setLoading(true)
    try {
      const resp = await apiFetch('/api/db/prune/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cutoff: localToUtcStr(cutoff), tables: selectedTables }),
      })
      const d = await resp.json()
      if (!resp.ok) { setConfigErr(d.detail || d.error || 'Preview failed.'); return }
      setPreview({ counts: d.counts, totals: d.totals ?? {}, cutoffUtc: localToUtcStr(cutoff) })
      setConfirm('')
      setPhase('preview')
    } catch (e) {
      setConfigErr('Request failed: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  async function runExecute() {
    setPreviewErr('')
    setLoading(true)
    try {
      const resp = await apiFetch('/api/db/prune/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cutoff: previewData.cutoffUtc, tables: selectedTables }),
      })
      const d = await resp.json()
      if (!resp.ok) { setPreviewErr(d.detail || d.error || 'Prune failed.'); return }
      setResult(d)
      setPhase('result')
    } catch (e) {
      setPreviewErr('Request failed: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="⚠ Prune Records" width="min(640px, 94vw)">

      {/* ── Phase: configure ── */}
      {phase === 'configure' && (
        <div>
          <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '20px' }}>
            Delete all rows with a timestamp <strong style={{ color: 'var(--text)' }}>before</strong> the
            chosen cutoff. A backup is created automatically before any data is removed.
          </p>

          <label className="field-label">Cutoff date &amp; time</label>
          <input
            type="datetime-local"
            value={cutoff}
            onChange={e => setCutoff(e.target.value)}
            style={{
              background: 'var(--bg)', border: '1px solid var(--border2)',
              color: 'var(--text-hi)', borderRadius: 'var(--radius)',
              padding: '8px 12px', fontFamily: 'var(--mono)', fontSize: '13px',
              width: '100%', outline: 'none', marginBottom: '6px',
            }}
          />
          <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)', marginBottom: '20px' }}>
            {tz} (UTC{offsetStr})
            {cutoffUtcPreview && (
              <> &nbsp;·&nbsp; Cutoff in UTC: <span style={{ color: 'var(--accent)' }}>{cutoffUtcPreview}</span></>
            )}
          </div>

          <label className="field-label">Tables to prune</label>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '8px' }}>
            <button className="btn btn-ghost" style={{ fontSize: '11px', padding: '3px 10px' }} onClick={() => selectAll(true)}>Select all</button>
            <button className="btn btn-ghost" style={{ fontSize: '11px', padding: '3px 10px' }} onClick={() => selectAll(false)}>Deselect all</button>
          </div>

          {!meta ? (
            <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-dim)', marginBottom: '20px' }}>Loading…</div>
          ) : (
            <div className="prune-table-grid">
              {meta.tables.map(name => {
                const isCascade   = cascadeSet.has(name)
                const isPreDelete = preDeleteSet.has(name)
                const isDisabled  = isCascade || isPreDelete
                const parent      = meta.cascade_parents?.[name]

                const tooltip = isCascade
                  ? `Deleted automatically via CASCADE when ${parent ?? 'parent'} is pruned`
                  : isPreDelete
                  ? `Deleted before ${parent ?? 'parent'} — no direct timestamp column`
                  : undefined

                return (
                  <label
                    key={name}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      cursor:  isDisabled ? 'default' : 'pointer',
                      opacity: isDisabled ? 0.5 : 1,
                    }}
                    title={tooltip}
                  >
                    <input
                      type="checkbox"
                      checked={!!checked[name]}
                      onChange={e => !isDisabled && toggleTable(name, e.target.checked)}
                      style={{
                        accentColor: 'var(--red)',
                        cursor: isDisabled ? 'default' : 'pointer',
                        flexShrink: 0,
                      }}
                    />
                    <span style={{
                      fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {name}
                    </span>
                  </label>
                )
              })}
            </div>
          )}

          {configError && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--red)', marginBottom: '14px' }}>{configError}</div>
          )}

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-danger" onClick={runPreview} disabled={loading}>
              {loading ? 'Loading…' : 'Preview →'}
            </button>
          </div>
        </div>
      )}

      {/* ── Phase: preview ── */}
      {phase === 'preview' && previewData && (
        <div>
          <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '16px' }}>
            Rows that will be deleted (cutoff:{' '}
            <code style={{ color: 'var(--text-hi)', fontFamily: 'var(--mono)' }}>
              {previewData.cutoffUtc?.replace('T', ' ')}
            </code>{' '}
            <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>UTC</span>):
          </p>

          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: '20px' }}>
            <table style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>Table</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'right' }}>Delete</th>
                  <th style={{ textAlign: 'right' }}>Remain</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(previewData.counts).map(([table, deleteCount]) => {
                  const isCascade   = cascadeSet.has(table)
                  const isPreDelete = preDeleteSet.has(table)
                  // Cascade and pre-delete tables have no direct timestamp so
                  // Total/Remain are meaningless — the backend doesn't return totals for them.
                  const noDirectTs  = isCascade || isPreDelete
                  const total       = previewData.totals?.[table] ?? null
                  const remain      = (!noDirectTs && total !== null) ? total - deleteCount : null
                  const dimMono     = { fontFamily: 'var(--mono)', fontSize: '12px', textAlign: 'right', color: 'var(--text-dim)' }

                  return (
                    <tr key={table}>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>
                        {table}
                        {isCascade   && <span className="badge badge-dim"    style={{ fontSize: '10px', marginLeft: '6px' }}>cascade</span>}
                        {isPreDelete && <span className="badge badge-yellow" style={{ fontSize: '10px', marginLeft: '6px' }}>pre-delete</span>}
                      </td>
                      <td style={dimMono}>
                        {noDirectTs ? '—' : (total !== null ? total.toLocaleString() : '—')}
                      </td>
                      <td style={{
                        ...dimMono,
                        color:     isCascade ? 'var(--text-dim)' : (deleteCount > 0 ? 'var(--red)' : 'var(--text-dim)'),
                        fontStyle: isCascade ? 'italic' : undefined,
                      }}>
                        {isCascade ? 'cascade' : deleteCount.toLocaleString()}
                      </td>
                      <td style={{
                        ...dimMono,
                        color: noDirectTs ? 'var(--text-dim)' : (remain === 0 ? 'var(--yellow)' : 'var(--green)'),
                      }}>
                        {noDirectTs ? '—' : (remain !== null ? remain.toLocaleString() : '—')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                {(() => {
                  let grandTotal = 0, grandDelete = 0, grandRemain = 0
                  Object.entries(previewData.counts).forEach(([table, deleteCount]) => {
                    // Exclude cascade and pre-delete from the grand total —
                    // they have no direct timestamp so Total/Remain aren't meaningful.
                    if (cascadeSet.has(table) || preDeleteSet.has(table)) return
                    const total = previewData.totals?.[table] ?? null
                    if (total !== null) {
                      grandTotal  += total
                      grandDelete += deleteCount
                      grandRemain += (total - deleteCount)
                    }
                  })
                  return (
                    <tr style={{ borderTop: '1px solid var(--border2)' }}>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-dim)' }}>Total (direct rows)</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 600, color: 'var(--text-hi)', textAlign: 'right' }}>{grandTotal.toLocaleString()}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 600, color: 'var(--red)',     textAlign: 'right' }}>{grandDelete.toLocaleString()}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 600, color: 'var(--green)',   textAlign: 'right' }}>{grandRemain.toLocaleString()}</td>
                    </tr>
                  )
                })()}
              </tfoot>
            </table>
          </div>

          <div style={{ background: 'var(--red-lo)', border: '1px solid var(--red)', borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: '16px' }}>
            <p style={{ fontSize: '12px', color: 'var(--red)', marginBottom: '10px' }}>
              This action is <strong>irreversible</strong> (though a backup will be saved first).
              Type <code style={{ fontFamily: 'var(--mono)', background: 'rgba(0,0,0,.3)', padding: '1px 5px', borderRadius: '3px' }}>DELETE</code> to confirm.
            </p>
            <input
              type="text"
              value={confirmText}
              placeholder="DELETE"
              onChange={e => setConfirm(e.target.value)}
              style={{
                background: 'var(--bg)', border: '1px solid var(--border2)',
                color: 'var(--text-hi)', borderRadius: 'var(--radius)',
                padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: '13px',
                width: '100%', outline: 'none',
              }}
            />
          </div>

          {previewError && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--red)', marginBottom: '14px' }}>{previewError}</div>
          )}

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setPhase('configure')}>← Back</button>
            <button
              className="btn btn-danger"
              onClick={runExecute}
              disabled={confirmText !== 'DELETE' || loading}
              style={{ opacity: confirmText !== 'DELETE' ? 0.4 : 1, cursor: confirmText !== 'DELETE' ? 'not-allowed' : 'pointer' }}
            >
              {loading ? 'Pruning…' : 'Execute Prune'}
            </button>
          </div>
        </div>
      )}

      {/* ── Phase: result ── */}
      {phase === 'result' && resultData && (
        <div>
          <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '16px' }}>Prune complete. Rows deleted:</p>

          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: '16px' }}>
            <table style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>Table</th>
                  <th style={{ textAlign: 'right' }}>Deleted</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(resultData.deleted).map(([table, count]) => {
                  const isCascade   = cascadeSet.has(table)
                  const isPreDelete = preDeleteSet.has(table)
                  return (
                    <tr key={table}>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>
                        {table}
                        {isCascade   && <span className="badge badge-dim"    style={{ fontSize: '10px', marginLeft: '6px' }}>cascade</span>}
                        {isPreDelete && <span className="badge badge-yellow" style={{ fontSize: '10px', marginLeft: '6px' }}>pre-delete</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--green)' }}>
                        {/* cascade returns -1 (unknowable); pre-delete returns real rowcount */}
                        {isCascade
                          ? <em style={{ color: 'var(--text-dim)' }}>via cascade</em>
                          : count.toLocaleString()
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {resultData.backup && (
            <p style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--mono)', marginBottom: '20px' }}>
              Backup saved to: {resultData.backup}
            </p>
          )}

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => { onClose(); onDone() }}>Close &amp; Refresh</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Truncate modal ───────────────────────────────────────────────────────────

function TruncateModal({ open, onClose, onDone, resettableTables }) {
  const [phase, setPhase]       = useState('confirm') // confirm | result
  const [confirmText, setConfirm] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState(null)

  useEffect(() => {
    if (!open) return
    setPhase('confirm')
    setConfirm('')
    setError('')
    setResult(null)
  }, [open])

  async function run() {
    setError('')
    setLoading(true)
    try {
      const resp = await apiFetch('/api/db/truncate-all', { method: 'POST' })
      const d = await resp.json()
      if (!resp.ok) { setError(d.error || 'Truncate failed.'); return }
      setResult(d)
      setPhase('result')
    } catch (e) {
      setError('Request failed: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="⚠ Truncate Resettable Tables" width="min(520px, 94vw)">

      {phase === 'confirm' && (
        <div>
          <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '16px' }}>
            Delete <strong style={{ color: 'var(--text)' }}>all rows</strong> from every{' '}
            <span className="badge badge-yellow">resettable</span> table
            ({resettableTables?.length ?? 0} tables). Useful after a migration dry-run.
            This action cannot be undone.
          </p>

          {resettableTables && resettableTables.length > 0 && (
            <div style={{
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: '16px',
              maxHeight: '160px', overflowY: 'auto',
            }}>
              {resettableTables.map(t => (
                <div key={t} style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)', lineHeight: '1.8' }}>{t}</div>
              ))}
            </div>
          )}

          <div style={{ background: 'var(--red-lo)', border: '1px solid var(--red)', borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: '16px' }}>
            <p style={{ fontSize: '12px', color: 'var(--red)', marginBottom: '10px' }}>
              Type <code style={{ fontFamily: 'var(--mono)', background: 'rgba(0,0,0,.3)', padding: '1px 5px', borderRadius: '3px' }}>TRUNCATE</code> to confirm.
            </p>
            <input
              type="text"
              value={confirmText}
              placeholder="TRUNCATE"
              onChange={e => setConfirm(e.target.value)}
              style={{
                background: 'var(--bg)', border: '1px solid var(--border2)',
                color: 'var(--text-hi)', borderRadius: 'var(--radius)',
                padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: '13px',
                width: '100%', outline: 'none',
              }}
            />
          </div>

          {error && <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--red)', marginBottom: '14px' }}>{error}</div>}

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-danger"
              onClick={run}
              disabled={confirmText !== 'TRUNCATE' || loading}
              style={{ opacity: confirmText !== 'TRUNCATE' ? 0.4 : 1, cursor: confirmText !== 'TRUNCATE' ? 'not-allowed' : 'pointer' }}
            >
              {loading ? 'Truncating…' : 'Truncate all'}
            </button>
          </div>
        </div>
      )}

      {phase === 'result' && result && (
        <div>
          <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '16px' }}>
            {result.count} {result.count === 1 ? 'table' : 'tables'} truncated successfully.
          </p>
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: '16px' }}>
            <table style={{ margin: 0 }}>
              <tbody>
                {result.cleared.map(t => (
                  <tr key={t}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--green)' }}>✓ {t}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => { onClose(); onDone() }}>Close &amp; Refresh</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Grouped table sections ───────────────────────────────────────────────────

function GroupSection({ group, rowCounts, expanded, onToggle, query }) {
  const navigate = useNavigate()
  const isOpen = query ? true : (expanded[group.label] ?? true)

  const totalCount = group.rows.reduce((sum, t) => {
    const c = rowCounts[t.name]
    return sum + (typeof c === 'number' ? c : 0)
  }, 0)

  return (
    <div style={{ marginBottom: '8px' }}>
      <div
        onClick={() => !query && onToggle(group.label)}
        style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '9px 16px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: isOpen ? 'var(--radius) var(--radius) 0 0' : 'var(--radius)',
          cursor: query ? 'default' : 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 600, color: 'var(--text-hi)', flex: 1 }}>
          {group.label}
        </span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)' }}>
          {group.rows.length} {group.rows.length === 1 ? 'table' : 'tables'}
          {totalCount > 0 && (
            <> · {totalCount.toLocaleString()} rows</>
          )}
        </span>
        {!query && (
          <span style={{
            color: 'var(--text-dim)', fontSize: '11px',
            display: 'inline-block',
            transition: 'transform .15s',
            transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
          }}>
            ▾
          </span>
        )}
      </div>

      {isOpen && (
        <div style={{
          border: '1px solid var(--border)',
          borderTop: 'none',
          borderRadius: '0 0 var(--radius) var(--radius)',
          overflow: 'hidden',
        }}>
          <div className="table-wrap">
          <table style={{ margin: 0, width: '100%', tableLayout: 'fixed' }}>
            <colgroup>
              <col />
              <col style={{ width: '110px' }} />
              <col style={{ width: '140px' }} />
            </colgroup>
            <tbody>
              {group.rows.map(t => (
                <tr
                  key={t.name}
                  onClick={() => navigate(`/db/table/${encodeURIComponent(t.name)}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <td style={{ color: 'var(--text-hi)', paddingLeft: '24px' }}>
                    {t.name}
                    {t.type === 'view' && (
                      <span className="badge badge-blue" style={{ marginLeft: '6px' }}>view</span>
                    )}
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: '12px', whiteSpace: 'nowrap', textAlign: 'right', paddingRight: '16px' }}>
                    <span className="badge badge-dim">
                      {typeof rowCounts[t.name] === 'number'
                        ? rowCounts[t.name].toLocaleString()
                        : (rowCounts[t.name] ?? '…')}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', paddingRight: '16px' }}>
                    {t.resettable
                      ? <span className="badge badge-yellow">resettable</span>
                      : <span className="badge badge-dim">–</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function Database() {
  const [tables, setTables]       = useState(null)
  const [rowCounts, setRowCounts] = useState({})
  const [loading, setLoading]     = useState(false)
  const [loadMsg, setLoadMsg]     = useState('')
  const [error, setError]         = useState('')
  const [pruneOpen, setPruneOpen]       = useState(false)
  const [truncateOpen, setTruncateOpen] = useState(false)
  const [query, setQuery]         = useState('')
  const [expanded, setExpanded]   = useState(defaultGroupExpanded)
  const esRef = useRef(null)

  function loadDatabase() {
    if (esRef.current) { esRef.current.close(); esRef.current = null }
    setLoading(true)
    setError('')
    setLoadMsg('Loading…')

    apiJson('/api/db/meta').then(d => {
      const initial = {}
      d.tables.forEach(t => { initial[t.name] = '…' })
      setTables(d.tables)
      setRowCounts(initial)
      setLoadMsg('Loading row counts…')

      const es = new EventSource('/api/db/count')
      esRef.current = es

      es.onmessage = (event) => {
        let data
        try { data = JSON.parse(event.data) } catch { return }
        if (data.done) {
          es.close()
          esRef.current = null
          setLoadMsg('')
          setLoading(false)
          return
        }
        setRowCounts(prev => ({ ...prev, [data.name]: data.count }))
      }

      es.onerror = () => {
        es.close()
        esRef.current = null
        setLoadMsg('Failed to load row counts')
        setLoading(false)
      }
    }).catch(e => {
      setError('Failed to load: ' + e.message)
      setLoadMsg('')
      setLoading(false)
    })
  }

  useEffect(() => {
    loadDatabase()
    return () => { if (esRef.current) { esRef.current.close() } }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleGroup(label) {
    setExpanded(prev => ({ ...prev, [label]: !prev[label] }))
  }

  const q = query.trim().toLowerCase()

  // Build groups, applying search filter
  const groups = tables
    ? groupTablesByDomain(tables).map(g => ({
        ...g,
        rows: q ? g.rows.filter(t => t.name.toLowerCase().includes(q)) : g.rows,
      })).filter(g => g.rows.length > 0)
    : []

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1>Database</h1>
            <p>All tables in the live SQLite database. Click Browse to inspect rows.</p>
          </div>
          <button className="btn btn-ghost" onClick={loadDatabase} disabled={loading}>
            {loading ? '↺ Loading…' : '↺ Refresh'}
          </button>
        </div>
      </div>

      {loadMsg && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--text-dim)', marginBottom: '16px' }}>
          {loadMsg}
        </div>
      )}

      {error && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--red)', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
        <a href="/db/download" className="btn btn-primary">↓ Download travel.db</a>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="Filter tables…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border2)',
            color: 'var(--text-hi)',
            borderRadius: 'var(--radius)',
            padding: '8px 12px',
            fontFamily: 'var(--mono)',
            fontSize: '13px',
            width: '100%',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {!tables ? (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--text-dim)' }}>Loading…</div>
      ) : groups.length === 0 ? (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--text-dim)' }}>No tables match.</div>
      ) : (
        groups.map((group, i) => (
          <div key={group.label}>
            <GroupSection
              group={group}
              rowCounts={rowCounts}
              expanded={expanded}
              onToggle={toggleGroup}
              query={q}
            />
            {i === 0 && <div style={{ height: '16px' }} />}
          </div>
        ))
      )}

      {/* Danger zone */}
      <div style={{ marginTop: '40px', border: '1px solid var(--red)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--red)', background: 'var(--red-lo)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: 'var(--red)', fontSize: '15px' }}>⚠</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--red)' }}>Danger Zone</span>
        </div>

        <div style={{ background: 'var(--surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)', gap: '16px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '13px', color: 'var(--text-hi)', marginBottom: '3px' }}>Prune old records</div>
              <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>Delete table records older than a configurable threshold.</div>
            </div>
            <button className="btn btn-danger" style={{ flexShrink: 0 }} onClick={() => setPruneOpen(true)}>Prune…</button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', gap: '16px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '13px', color: 'var(--text-hi)', marginBottom: '3px' }}>Truncate resettable tables</div>
              <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                Wipe all rows from tables marked <span className="badge badge-yellow">resettable</span> — useful after a migration dry-run.
              </div>
            </div>
            <button className="btn btn-danger" style={{ flexShrink: 0 }} onClick={() => setTruncateOpen(true)}>Truncate…</button>
          </div>
        </div>
      </div>

      <PruneModal open={pruneOpen} onClose={() => setPruneOpen(false)} onDone={loadDatabase} />
      <TruncateModal
        open={truncateOpen}
        onClose={() => setTruncateOpen(false)}
        onDone={loadDatabase}
        resettableTables={tables ? tables.filter(t => t.resettable).map(t => t.name).sort() : []}
      />
    </>
  )
}
