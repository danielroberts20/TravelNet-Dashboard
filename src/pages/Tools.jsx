import { useState, useRef, useEffect } from 'react'
import { Card } from '../components/Card'
import { apiFetch } from '../api'
import { useRestartContainer } from '../hooks/useRestartContainer'
import { EditorView, basicSetup } from 'codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'

// ── Shared helpers ────────────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: '11px', color: 'var(--text-dim)', display: 'block', marginBottom: '5px',
                      fontFamily: 'var(--mono)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

const inputStyle = {
  background: 'var(--bg)', border: '1px solid var(--border2)', color: 'var(--text-hi)',
  borderRadius: '5px', padding: '7px 10px', fontFamily: 'var(--mono)', fontSize: '13px',
  width: '100%', outline: 'none', colorScheme: 'dark',
}

function StatusBanner({ status }) {
  if (!status) return null
  return (
    <div style={{
      padding: '9px 12px', borderRadius: '5px', fontSize: '12px',
      fontFamily: 'var(--mono)', marginBottom: '14px',
      background: status.ok ? 'var(--green-lo)' : 'var(--red-lo)',
      border: `1px solid ${status.ok ? 'var(--green)' : 'var(--red)'}`,
      color: status.ok ? 'var(--green)' : 'var(--red)',
      wordBreak: 'break-all',
    }}>{status.msg}</div>
  )
}

// ── Flight form ───────────────────────────────────────────────────────────────

function FlightForm() {
  const empty = {
    origin_iata: '', destination_iata: '',
    departed_at: '', arrived_at: '',
    airline: '', flight_number: '', seat_class: '', notes: '',
  }
  const [fields, setFields] = useState(empty)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)

  function set(k) { return e => setFields(f => ({ ...f, [k]: e.target.value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setStatus(null)
    const body = { ...fields }
    Object.keys(body).forEach(k => { if (!body[k]) delete body[k] })
    try {
      const resp = await apiFetch('/upload/flight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await resp.json()
      if (resp.ok) {
        const r = d.result
        const dur  = r.duration_mins != null ? `${Math.floor(r.duration_mins / 60)}h ${r.duration_mins % 60}m` : ''
        const dist = r.distance_km   != null ? `${r.distance_km.toLocaleString()} km` : ''
        setStatus({ ok: true, msg: `Inserted — ${r.origin?.iata} → ${r.destination?.iata}  ·  ${dur}  ·  ${dist}` })
        setFields(empty)
      } else {
        setStatus({ ok: false, msg: d.error || 'Upload failed' })
      }
    } catch (err) {
      setStatus({ ok: false, msg: err.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card title="Flight">
      <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '18px', lineHeight: '1.5' }}>
        Log a flight manually. Departure and arrival times are interpreted as local airport times —
        timezone conversion is handled server-side from airport coordinates.
      </p>
      <StatusBanner status={status} />
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

          <div className="form-grid-2">
            <Field label="Origin IATA *">
              <input style={inputStyle} value={fields.origin_iata} onChange={set('origin_iata')}
                     placeholder="SYD" maxLength={3} required
                     onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                     onBlur={e => e.target.style.borderColor = 'var(--border2)'} />
            </Field>
            <Field label="Destination IATA *">
              <input style={inputStyle} value={fields.destination_iata} onChange={set('destination_iata')}
                     placeholder="LHR" maxLength={3} required
                     onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                     onBlur={e => e.target.style.borderColor = 'var(--border2)'} />
            </Field>
          </div>

          <div className="form-grid-2">
            <Field label="Departed (local) *">
              <input type="datetime-local" style={inputStyle} value={fields.departed_at}
                     onChange={set('departed_at')} required
                     onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                     onBlur={e => e.target.style.borderColor = 'var(--border2)'} />
            </Field>
            <Field label="Arrived (local) *">
              <input type="datetime-local" style={inputStyle} value={fields.arrived_at}
                     onChange={set('arrived_at')} required
                     onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                     onBlur={e => e.target.style.borderColor = 'var(--border2)'} />
            </Field>
          </div>

          <div className="form-grid-3">
            <Field label="Airline">
              <input style={inputStyle} value={fields.airline} onChange={set('airline')}
                     placeholder="Qantas"
                     onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                     onBlur={e => e.target.style.borderColor = 'var(--border2)'} />
            </Field>
            <Field label="Flight number">
              <input style={inputStyle} value={fields.flight_number} onChange={set('flight_number')}
                     placeholder="QF1"
                     onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                     onBlur={e => e.target.style.borderColor = 'var(--border2)'} />
            </Field>
            <Field label="Seat class">
              <select style={inputStyle} value={fields.seat_class} onChange={set('seat_class')}
                      onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                      onBlur={e => e.target.style.borderColor = 'var(--border2)'}>
                <option value="">—</option>
                <option value="economy">Economy</option>
                <option value="premium_economy">Premium Economy</option>
                <option value="business">Business</option>
              </select>
            </Field>
          </div>

          <Field label="Notes">
            <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '60px' }}
                      value={fields.notes} onChange={set('notes')} placeholder="Optional notes"
                      onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                      onBlur={e => e.target.style.borderColor = 'var(--border2)'} />
          </Field>

          <button type="submit" disabled={loading} className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', opacity: loading ? 0.5 : 1 }}>
            {loading ? 'Submitting…' : '↑ Log Flight'}
          </button>
        </div>
      </form>
    </Card>
  )
}

// ── Cost of Living form ───────────────────────────────────────────────────────

const COUNTRY_MAP = {
  US: { country: 'United States',  currency: 'USD' },
  FJ: { country: 'Fiji',           currency: 'FJD' },
  AU: { country: 'Australia',      currency: 'AUD' },
  NZ: { country: 'New Zealand',    currency: 'NZD' },
  TH: { country: 'Thailand',       currency: 'THB' },
  VN: { country: 'Vietnam',        currency: 'VND' },
  MY: { country: 'Malaysia',       currency: 'MYR' },
  SG: { country: 'Singapore',      currency: 'SGD' },
  ID: { country: 'Indonesia',      currency: 'IDR' },
  KH: { country: 'Cambodia',       currency: 'KHR' },
  CA: { country: 'Canada',         currency: 'CAD' },
  GB: { country: 'United Kingdom', currency: 'GBP' },
}

function CostOfLivingForm() {
  const empty = {
    country_code: 'AU', city: '',
    col_index: '', rent_index: '', col_plus_rent: '',
    groceries_index: '', restaurant_index: '',
    center_lat: '', center_lon: '',
    source: 'Numbeo 2026', reference_year: '2026',
    is_estimated: false, notes: '',
  }
  const [fields, setFields] = useState(empty)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)

  function set(k) { return e => setFields(f => ({ ...f, [k]: e.target.value })) }
  function focus(e) { e.target.style.borderColor = 'var(--accent)' }
  function blur(e)  { e.target.style.borderColor = 'var(--border2)' }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setStatus(null)
    const info = COUNTRY_MAP[fields.country_code]
    const body = {
      country_code:    fields.country_code,
      country:         info.country,
      city:            fields.city,
      local_currency:  info.currency,
      source:          fields.source,
      reference_year:  parseInt(fields.reference_year, 10),
      is_estimated:    fields.is_estimated,
      notes:           fields.notes || null,
    }
    for (const k of ['col_index', 'rent_index', 'col_plus_rent', 'groceries_index', 'restaurant_index', 'center_lat', 'center_lon']) {
      if (fields[k] !== '') body[k] = parseFloat(fields[k])
    }
    try {
      const resp = await apiFetch('/upload/cost_of_living', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await resp.json()
      if (resp.ok) {
        const r = d.result
        const loc = r.city ? `${r.city}, ${r.country}` : r.country
        setStatus({ ok: true, msg: `${r.status === 'updated' ? 'Updated' : 'Inserted'} — ${loc}` })
        setFields(empty)
      } else {
        setStatus({ ok: false, msg: d.error || 'Submit failed' })
      }
    } catch (err) {
      setStatus({ ok: false, msg: err.message })
    } finally {
      setLoading(false)
    }
  }

  const derived = COUNTRY_MAP[fields.country_code]

  return (
    <Card title="Cost of Living">
      <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '18px', lineHeight: '1.5' }}>
        Log a cost of living entry for a country or city. Indices use Numbeo's NYC&nbsp;=&nbsp;100 baseline.
        Submitting a duplicate (same country + city) overwrites the existing row.
      </p>
      <StatusBanner status={status} />
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

          <div className="form-grid-2">
            <Field label="Country *">
              <select style={inputStyle} value={fields.country_code}
                      onChange={e => setFields(f => ({ ...f, country_code: e.target.value }))}
                      onFocus={focus} onBlur={blur} required>
                {Object.entries(COUNTRY_MAP).map(([code, { country }]) => (
                  <option key={code} value={code}>{code} — {country}</option>
                ))}
              </select>
            </Field>
            <Field label="City">
              <input style={inputStyle} value={fields.city} onChange={set('city')}
                     placeholder="Bangkok (leave blank for country-level)"
                     onFocus={focus} onBlur={blur} />
            </Field>
          </div>

          <div style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--mono)', marginTop: '-6px' }}>
            {derived.country} · {derived.currency}
          </div>

          <div className="form-grid-3">
            <Field label="Source">
              <input style={inputStyle} value={fields.source} onChange={set('source')}
                     onFocus={focus} onBlur={blur} required />
            </Field>
            <Field label="Reference year">
              <input type="number" style={inputStyle} value={fields.reference_year}
                     onChange={set('reference_year')} min={2020} max={2100}
                     onFocus={focus} onBlur={blur} required />
            </Field>
            <Field label="Estimated?">
              <label style={{
                display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '9px',
                cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--text-hi)',
              }}>
                <input type="checkbox" checked={fields.is_estimated}
                       onChange={e => setFields(f => ({ ...f, is_estimated: e.target.checked }))} />
                Is estimated
              </label>
            </Field>
          </div>

          <div style={{
            fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--mono)',
            borderTop: '1px solid var(--border2)', paddingTop: '10px',
            letterSpacing: '.06em', textTransform: 'uppercase',
          }}>
            Cost Indices — NYC = 100 baseline
          </div>

          <div className="form-grid-3">
            <Field label="CoL Index *">
              <input type="number" style={inputStyle} value={fields.col_index} onChange={set('col_index')}
                     step="0.1" min="0" max="200" placeholder="e.g. 65.4"
                     required={!fields.is_estimated}
                     onFocus={focus} onBlur={blur} />
            </Field>
            <Field label="Rent Index">
              <input type="number" style={inputStyle} value={fields.rent_index} onChange={set('rent_index')}
                     step="0.1" min="0" max="200" placeholder="optional"
                     onFocus={focus} onBlur={blur} />
            </Field>
            <Field label="CoL + Rent">
              <input type="number" style={inputStyle} value={fields.col_plus_rent} onChange={set('col_plus_rent')}
                     step="0.1" min="0" max="200" placeholder="optional"
                     onFocus={focus} onBlur={blur} />
            </Field>
          </div>

          <div className="form-grid-2">
            <Field label="Groceries Index">
              <input type="number" style={inputStyle} value={fields.groceries_index} onChange={set('groceries_index')}
                     step="0.1" min="0" max="200" placeholder="optional"
                     onFocus={focus} onBlur={blur} />
            </Field>
            <Field label="Restaurant Index">
              <input type="number" style={inputStyle} value={fields.restaurant_index} onChange={set('restaurant_index')}
                     step="0.1" min="0" max="200" placeholder="optional"
                     onFocus={focus} onBlur={blur} />
            </Field>
          </div>

          <div className="form-grid-2" style={{ opacity: fields.city.trim() ? 1 : 0.35, transition: 'opacity .2s' }}>
            <Field label="Centre latitude">
              <input type="number" style={inputStyle} value={fields.center_lat} onChange={set('center_lat')}
                     step="0.0001" placeholder="e.g. 51.5074"
                     onFocus={focus} onBlur={blur} />
            </Field>
            <Field label="Centre longitude">
              <input type="number" style={inputStyle} value={fields.center_lon} onChange={set('center_lon')}
                     step="0.0001" placeholder="e.g. -0.1278"
                     onFocus={focus} onBlur={blur} />
            </Field>
          </div>

          <Field label="Notes">
            <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '60px' }}
                      value={fields.notes} onChange={set('notes')} placeholder="Optional notes"
                      onFocus={focus} onBlur={blur} />
          </Field>

          <button type="submit" disabled={loading} className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', opacity: loading ? 0.5 : 1 }}>
            {loading ? 'Submitting…' : '↑ Log Cost of Living'}
          </button>
        </div>
      </form>
    </Card>
  )
}

// ── YAML editor (CodeMirror 6) ────────────────────────────────────────────────

function YamlEditor({ editorViewRef }) {
  const containerRef = useRef(null)

  useEffect(() => {
    const view = new EditorView({
      doc: '',
      extensions: [
        basicSetup,
        yaml(),
        oneDark,
        EditorView.theme({
          '&':            { height: '500px' },
          '.cm-scroller': { overflow: 'auto' },
          // Suppress the default blue browser outline — the border on the
          // container div already provides the focus indicator.
          '&.cm-focused': { outline: 'none' },
        }),
      ],
      parent: containerRef.current,
    })
    editorViewRef.current = view
    return () => { view.destroy(); editorViewRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={containerRef}
      style={{ border: '1px solid var(--border2)', borderRadius: '5px', overflow: 'hidden' }}
    />
  )
}

// ── Travel YAML tab ───────────────────────────────────────────────────────────

const RESTART_CONTAINERS = [
  { key: 'travelnet',           label: 'TravelNet API' },
  { key: 'travelnet-dashboard', label: 'Dashboard' },
  { key: 'trevor',              label: 'Trevor' },
]

function TravelYamlTab() {
  const [lastModified, setLastModified] = useState(null)
  const [loadError, setLoadError]       = useState(null)
  const [saveStatus, setSaveStatus]     = useState(null)
  const [saving, setSaving]             = useState(false)
  const [selected, setSelected]         = useState({ travelnet: true, 'travelnet-dashboard': false, trevor: false })
  const [restarting, setRestarting]     = useState(false)
  const editorViewRef                   = useRef(null)
  const { restartContainer, Toast }     = useRestartContainer()

  async function loadYaml() {
    setLoadError(null)
    try {
      const resp = await apiFetch('/api/travel-yml')
      const d    = await resp.json()
      if (!resp.ok) { setLoadError(d.error || 'Load failed'); return }
      setLastModified(d.last_modified)
      const view = editorViewRef.current
      if (view) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: d.content } })
      }
    } catch (e) {
      setLoadError(e.message)
    }
  }

  // Load on mount. By the time the async fetch resolves, YamlEditor's useEffect
  // has already run (child effects fire before parent effects), so editorViewRef
  // is guaranteed to be set when we dispatch the content update.
  useEffect(() => { loadYaml() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    const content = editorViewRef.current?.state.doc.toString() ?? ''
    setSaving(true)
    setSaveStatus(null)
    try {
      const resp = await apiFetch('/api/travel-yml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const d = await resp.json()
      if (resp.ok) {
        setSaveStatus({ ok: true, msg: '✓ Saved successfully' })
        setLastModified(d.last_modified)
      } else {
        setSaveStatus({ ok: false, msg: d.error || 'Save failed' })
      }
    } catch (e) {
      setSaveStatus({ ok: false, msg: e.message })
    } finally {
      setSaving(false)
    }
  }

  async function handleRestart() {
    // Restart dashboard last to avoid a mid-loop page reload.
    const regular   = RESTART_CONTAINERS.filter(c => selected[c.key] && c.key !== 'travelnet-dashboard')
    const dashboard = RESTART_CONTAINERS.filter(c => selected[c.key] && c.key === 'travelnet-dashboard')
    const targets   = [...regular, ...dashboard]
    if (!targets.length) return
    setRestarting(true)
    for (const { key } of targets) {
      await restartContainer(key)
    }
    setRestarting(false)
  }

  function toggleContainer(key) {
    setSelected(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const selectedCount = RESTART_CONTAINERS.filter(c => selected[c.key]).length

  return (
    <>
      <Card title="Travel YAML">
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)' }}>
            {loadError
              ? <span style={{ color: 'var(--red)' }}>{loadError}</span>
              : lastModified
                ? `Last modified: ${new Date(lastModified).toLocaleString()}`
                : 'Loading…'}
          </div>
          <button className="btn btn-ghost" onClick={loadYaml} style={{ fontSize: '11px' }}>
            Reload
          </button>
        </div>

        <YamlEditor editorViewRef={editorViewRef} />

        {saveStatus && (
          <div style={{
            padding: '9px 12px', borderRadius: '5px', fontSize: '12px',
            fontFamily: 'var(--mono)', marginTop: '12px',
            background: saveStatus.ok ? 'var(--green-lo)' : 'var(--red-lo)',
            border: `1px solid ${saveStatus.ok ? 'var(--green)' : 'var(--red)'}`,
            color: saveStatus.ok ? 'var(--green)' : 'var(--red)',
            wordBreak: 'break-all',
          }}>
            {saveStatus.msg}
          </div>
        )}

        <div style={{ marginTop: '14px' }}>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
            style={{ opacity: saving ? 0.5 : 1 }}
          >
            {saving ? 'Saving…' : '↑ Validate & Save'}
          </button>
        </div>
      </Card>

      <Card title="Restart Services" style={{ marginTop: '16px' }}>
        <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '14px', lineHeight: '1.5' }}>
          Restart containers to apply YAML changes. The ingest API re-reads travel.yml on startup.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
          {RESTART_CONTAINERS.map(({ key, label }) => (
            <label key={key} style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--text-hi)', cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={!!selected[key]}
                onChange={() => toggleContainer(key)}
                style={{ accentColor: 'var(--accent)' }}
              />
              {label}
              <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>({key})</span>
            </label>
          ))}
        </div>
        <button
          className="btn btn-primary"
          onClick={handleRestart}
          disabled={restarting || selectedCount === 0}
          style={{ opacity: (restarting || selectedCount === 0) ? 0.5 : 1 }}
        >
          {restarting ? 'Restarting…' : `↺ Restart Selected (${selectedCount})`}
        </button>

        <div style={{
          marginTop: '16px', padding: '10px 12px', borderRadius: '5px',
          background: 'var(--bg)', border: '1px solid var(--border2)',
          fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)',
        }}>
          ⚠ The demo site (travelnet.dev) requires a Netlify rebuild to pick up changes.
        </div>
      </Card>

      <Toast />
    </>
  )
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'flight', label: 'Flight Log'     },
  { key: 'col',    label: 'Cost of Living' },
  { key: 'yaml',   label: 'Travel YAML'   },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Tools() {
  const [tab, setTab] = useState('flight')

  return (
    <>
      <div className="page-header">
        <h1>Tools</h1>
        <p>Log flights, update cost of living data, and edit the travel itinerary.</p>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border2)', marginBottom: '24px' }}>
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${tab === key ? 'var(--accent)' : 'transparent'}`,
              padding: '10px 18px',
              marginBottom: '-1px',
              cursor: 'pointer',
              fontFamily: 'var(--mono)',
              fontSize: '13px',
              color: tab === key ? 'var(--text-hi)' : 'var(--text-dim)',
              transition: 'color .15s, border-color .15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'flight' && <FlightForm />}
      {tab === 'col'    && <CostOfLivingForm />}
      {tab === 'yaml'   && <TravelYamlTab />}
    </>
  )
}
