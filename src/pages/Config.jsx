import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../api'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'

const RESTART_KEY = 'tn_restart_needed'

// ── Type helpers ─────────────────────────────────────────────────────────────

function valueToInput(type, value) {
  if (type === 'bool')         return value
  if (type === 'datetime')     return value ? value.split('T')[0].split(' ')[0] : ''
  if (type.startsWith('list')) return Array.isArray(value) ? value : []
  if (type.startsWith('dict')) return (value && typeof value === 'object') ? value : {}
  return value ?? ''
}

function dictValueInputType(type) {
  const m = type.match(/^dict\[str,(\w+)\]$/)
  const vt = m ? m[1] : 'str'
  if (vt === 'datetime') return 'date'
  if (vt === 'int' || vt === 'float') return 'number'
  return 'text'
}

// ── ChipInput ────────────────────────────────────────────────────────────────

function ChipInput({ value, onChange }) {
  const [chips, setChips] = useState(Array.isArray(value) ? value : [])
  const inputRef = useRef(null)

  useEffect(() => {
    setChips(Array.isArray(value) ? value : [])
  }, [value])

  function addChip(val) {
    const trimmed = val.trim()
    if (!trimmed) return
    const next = [...chips, trimmed]
    setChips(next)
    onChange(next)
  }

  function removeChip(i) {
    const next = chips.filter((_, idx) => idx !== i)
    setChips(next)
    onChange(next)
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addChip(e.target.value)
      e.target.value = ''
    } else if (e.key === 'Backspace' && !e.target.value && chips.length) {
      removeChip(chips.length - 1)
    }
  }

  return (
    <div className="chip-input" onClick={() => inputRef.current?.focus()}>
      {chips.map((chip, i) => (
        <span key={i} className="chip">
          {chip}
          <button type="button" onClick={() => removeChip(i)}>×</button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="chip-text-input"
        placeholder="Add item, press Enter"
        onKeyDown={handleKeydown}
        onBlur={e => { if (e.target.value.trim()) { addChip(e.target.value); e.target.value = '' } }}
      />
    </div>
  )
}

// ── DictEditor ───────────────────────────────────────────────────────────────

function DictEditor({ value, valueInputType, onChange }) {
  const [pairs, setPairs] = useState(
    Object.entries(value && typeof value === 'object' ? value : {})
  )

  useEffect(() => {
    setPairs(Object.entries(value && typeof value === 'object' ? value : {}))
  }, [value])

  function update(next) {
    setPairs(next)
    const obj = {}
    next.forEach(([k, v]) => { if (k.trim()) obj[k.trim()] = v })
    onChange(obj)
  }

  function setKey(i, k) { update(pairs.map((p, idx) => idx === i ? [k, p[1]] : p)) }
  function setVal(i, v) { update(pairs.map((p, idx) => idx === i ? [p[0], v] : p)) }
  function removeRow(i) { update(pairs.filter((_, idx) => idx !== i)) }
  function addRow()     { update([...pairs, ['', '']]) }

  return (
    <div className="dict-editor">
      {pairs.map(([k, v], i) => {
        const displayVal = valueInputType === 'date' ? (v ? String(v).split('T')[0] : '') : String(v ?? '')
        return (
          <div key={i} className="dict-row">
            <input type="text"           value={k}          placeholder="key"   onChange={e => setKey(i, e.target.value)} />
            <input type={valueInputType} value={displayVal} placeholder="value" onChange={e => setVal(i, e.target.value)} />
            <button className="dict-remove" type="button" onClick={() => removeRow(i)}>×</button>
          </div>
        )
      })}
      <button className="dict-add" type="button" onClick={addRow}>+ Add entry</button>
    </div>
  )
}

// ── ConfigRow ────────────────────────────────────────────────────────────────

function ConfigRow({ configKey, entry, onSave, onReset }) {
  const [localVal, setLocalVal] = useState(valueToInput(entry.type, entry.value))
  const [dirty, setDirty]       = useState(false)

  useEffect(() => {
    setLocalVal(valueToInput(entry.type, entry.value))
    setDirty(false)
  }, [entry])

  function markDirty(val) { setLocalVal(val); setDirty(true) }

  const defaultJson = JSON.stringify(entry.default)
  const truncated   = defaultJson.length > 60
  const displayStr  = truncated ? defaultJson.slice(0, 60) + '…' : defaultJson

  const rowClass = ['config-row',
    entry.overridden ? 'overridden' : '',
    dirty ? 'dirty' : '',
  ].filter(Boolean).join(' ')

  let inputEl
  if (entry.type === 'bool') {
    inputEl = (
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={!!localVal}
          onChange={e => markDirty(e.target.checked)}
          style={{ width: 'auto', accentColor: 'var(--accent)' }}
        />
        <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{localVal ? 'true' : 'false'}</span>
      </label>
    )
  } else if (entry.type.startsWith('list')) {
    inputEl = <ChipInput value={localVal} onChange={val => markDirty(val)} />
  } else if (entry.type.startsWith('dict')) {
    inputEl = <DictEditor value={localVal} valueInputType={dictValueInputType(entry.type)} onChange={val => markDirty(val)} />
  } else {
    const inputType = entry.type === 'int' || entry.type === 'float' ? 'number'
                    : entry.type === 'datetime' ? 'date'
                    : 'text'
    inputEl = (
      <input
        className={'config-input' + (dirty ? ' modified' : '')}
        type={inputType}
        value={localVal}
        step={entry.type === 'float' ? 'any' : undefined}
        onChange={e => markDirty(e.target.value)}
      />
    )
  }

  return (
    <div className={rowClass}>
      <div>
        <div className="config-key">{configKey}</div>
        <div className="config-desc">{entry.description || ''}</div>
        <div className="config-type">{entry.type} · {entry.module}</div>
      </div>

      <div className="config-input-wrap">
        {inputEl}
        <div
          className="config-default"
          title={truncated ? 'Click to copy full default' : undefined}
          style={{ cursor: truncated ? 'pointer' : undefined }}
          onClick={truncated ? () => navigator.clipboard.writeText(defaultJson) : undefined}
        >
          default: {displayStr}
        </div>
      </div>

      <div className="config-actions">
        {dirty && (
          <button className="btn btn-primary" onClick={() => onSave(configKey, localVal, entry.type)} style={{ fontSize: '11px', padding: '5px 12px' }}>
            Save
          </button>
        )}
        {entry.overridden && (
          <button className="btn btn-ghost" onClick={() => onReset(configKey)} style={{ fontSize: '11px', padding: '5px 10px' }} title="Reset to default">
            ↩
          </button>
        )}
      </div>
    </div>
  )
}

// ── RestartModal ─────────────────────────────────────────────────────────────

function RestartModal({ open, onClose, onDone }) {
  const [status, setStatus]   = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => { if (open) { setStatus(''); setLoading(false) } }, [open])

  async function doRestart() {
    setLoading(true)
    setStatus('Sending restart signal…')
    try {
      const resp = await apiFetch('/api/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ container: 'travelnet' }),
      })
      const d = await resp.json()
      if (!resp.ok) throw new Error(d.error)
      setStatus('✓ ' + d.message)
      onDone()
      setTimeout(() => onClose(), 2000)
    } catch (e) {
      setStatus('✗ ' + e.message)
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="↺ Restart Server" width="380px">
      <p style={{ color: 'var(--text-dim)', fontSize: '12px', marginBottom: '18px', lineHeight: 1.6, fontFamily: 'var(--mono)' }}>
        This will restart the <code>travelnet</code> FastAPI container. Config overrides will be applied on startup.
        The container will be unavailable for a few seconds.
      </p>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={doRestart} disabled={loading}>Restart</button>
      </div>
      {status && (
        <div style={{
          fontFamily: 'var(--mono)', fontSize: '12px', marginTop: '10px',
          color: status.startsWith('✗') ? 'var(--red)' : 'var(--accent)',
        }}>{status}</div>
      )}
    </Modal>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function Config() {
  const [configData, setConfigData]     = useState(null)
  const [loadError, setLoadError]       = useState('')
  const [pendingKeys, setPendingKeys]   = useState(new Set())
  const [needsRestart, setNeedsRestart] = useState(() => localStorage.getItem(RESTART_KEY) === '1')
  const [restartOpen, setRestartOpen]   = useState(false)
  const [renderKey, setRenderKey]       = useState(0)
  const { Toast, showToast }            = useToast()

  function persistRestart(val) {
    setNeedsRestart(val)
    if (val) localStorage.setItem(RESTART_KEY, '1')
    else     localStorage.removeItem(RESTART_KEY)
  }

  const loadConfig = useCallback(() => {
    setLoadError('')
    setConfigData(null)
    apiFetch('/api/config').then(r => r.json()).then(data => {
      if (data.error) throw new Error(data.error)
      setConfigData(data)
      setPendingKeys(new Set())
    }).catch(e => setLoadError('Failed to load config: ' + e.message))
  }, [])

  useEffect(() => { loadConfig() }, [loadConfig])

  async function handleSave(key, value, type) {
    let coerced = value
    if (type === 'int')   coerced = parseInt(value, 10)
    if (type === 'float') coerced = parseFloat(value)
    if (type === 'bool')  coerced = value === true || value === 'true'
    try {
      const resp = await apiFetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: coerced }),
      })
      const d = await resp.json()
      if (!resp.ok) throw new Error(d.error || resp.statusText)
      setConfigData(prev => ({
        ...prev,
        [key]: { ...prev[key], value: coerced, overridden: true },
      }))
      setPendingKeys(prev => { const s = new Set(prev); s.delete(key); return s })
      persistRestart(true)
    } catch (e) {
      showToast(`✗ Failed to save ${key}: ${e.message}`, 'var(--red)')
    }
  }

  async function handleReset(key) {
    try {
      const resp = await apiFetch(`/api/config/${key}`, { method: 'DELETE' })
      const d = await resp.json()
      if (!resp.ok) throw new Error(d.error || resp.statusText)
      setConfigData(prev => ({
        ...prev,
        [key]: { ...prev[key], value: prev[key].default, overridden: false },
      }))
      setPendingKeys(prev => { const s = new Set(prev); s.delete(key); return s })
      persistRestart(true)
    } catch (e) {
      showToast(`✗ Failed to reset ${key}: ${e.message}`, 'var(--red)')
    }
  }

  function handleDiscard() {
    setPendingKeys(new Set())
    setRenderKey(k => k + 1)
    loadConfig()
  }

  const groups = configData ? (() => {
    const g = {}
    for (const [key, entry] of Object.entries(configData)) {
      const name = entry.group || 'general'
      if (!g[name]) g[name] = []
      g[name].push([key, entry])
    }
    return Object.entries(g).sort(([aName, aEntries], [bName, bEntries]) => {
      const aOv = aEntries.filter(([, e]) => e.overridden).length
      const bOv = bEntries.filter(([, e]) => e.overridden).length
      if (aOv !== bOv) return bOv - aOv
      return aName.localeCompare(bName)
    })
  })() : []

  const hasPending = pendingKeys.size > 0

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1>Config</h1>
            <p>Edit server configuration. Changes require a server restart to take effect.</p>
          </div>
          <button
            className="btn btn-ghost"
            onClick={() => setRestartOpen(true)}
            style={needsRestart ? { borderColor: 'var(--yellow)', color: 'var(--yellow)' } : {}}
          >↺ Restart Server</button>
        </div>
      </div>

      {loadError && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--red)', marginBottom: '16px' }}>
          {loadError}
        </div>
      )}
      {!configData && !loadError && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--text-dim)' }}>Loading config…</div>
      )}

      {groups.map(([groupName, entries]) => {
        const overrideCount = entries.filter(([, e]) => e.overridden).length
        return (
          <div key={groupName} className="config-group">
            <div className="config-group-title">
              {groupName}
              {overrideCount > 0 && (
                <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, color: 'var(--accent)', fontSize: '10px', marginLeft: '8px' }}>
                  {overrideCount} overridden
                </span>
              )}
            </div>
            {entries.map(([key, entry]) => (
              <ConfigRow
                key={`${key}-${renderKey}`}
                configKey={key}
                entry={entry}
                onSave={(k, v, t) => {
                  setPendingKeys(prev => { const s = new Set(prev); s.add(k); return s })
                  handleSave(k, v, t)
                }}
                onReset={handleReset}
              />
            ))}
          </div>
        )
      })}

      {/* Unsaved changes banner */}
      <div className={'restart-banner' + (hasPending ? ' visible' : '')}>
        <span>⚠ Unsaved changes</span>
        <button className="btn btn-ghost" style={{ fontSize: '11px', color: 'var(--text-dim)' }} onClick={handleDiscard}>Discard</button>
      </div>

      {/* Restart required banner */}
      <div
        className={'restart-needed-banner' + (needsRestart ? ' visible' : '')}
        style={{ bottom: needsRestart && hasPending ? '88px' : '24px' }}
      >
        <span>↺ Restart required to apply changes</span>
        <button className="btn btn-ghost" style={{ fontSize: '11px' }} onClick={() => setRestartOpen(true)}>Restart now</button>
        <button className="btn btn-ghost" style={{ fontSize: '11px', color: 'var(--text-dim)' }} onClick={() => persistRestart(false)}>Dismiss</button>
      </div>

      <RestartModal open={restartOpen} onClose={() => setRestartOpen(false)} onDone={() => persistRestart(false)} />

      <Toast />
    </>
  )
}
