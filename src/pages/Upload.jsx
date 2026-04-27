import { useState, useRef, useEffect } from 'react'
import { Card } from '../components/Card'
import { apiFetch } from '../api'

function UploadZone({ id, accept, icon, label, hint, onFileChange }) {
  const [dragover, setDragover] = useState(false)
  const [filename, setFilename] = useState('')

  function handleChange(e) {
    const f = e.target.files[0]
    setFilename(f ? f.name : '')
    onFileChange(f || null)
  }

  return (
    <div
      style={{
        border: `2px dashed ${dragover ? 'var(--accent)' : 'var(--border2)'}`,
        background: dragover ? 'var(--accent-lo)' : 'transparent',
        borderRadius: '8px', padding: '32px 24px', textAlign: 'center',
        transition: 'border-color .2s, background .2s', cursor: 'pointer',
        position: 'relative',
      }}
      onDragOver={e => { e.preventDefault(); setDragover(true) }}
      onDragLeave={() => setDragover(false)}
      onDrop={() => setDragover(false)}
    >
      <input
        type="file" accept={accept} onChange={handleChange}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
      />
      <div style={{ fontSize: '28px', marginBottom: '10px' }}>{icon}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--text-hi)' }}>{label}</div>
      <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '6px' }}>{hint}</div>
      {filename && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--accent)', marginTop: '8px' }}>
          ✓ {filename}
        </div>
      )}
    </div>
  )
}

function UploadCard({ title, description, accept, icon, hint, endpoint }) {
  const [file, setFile]       = useState(null)
  const [status, setStatus]   = useState(null)
  const [loading, setLoading] = useState(false)
  const formRef               = useRef()

  async function handleSubmit(e) {
    e.preventDefault()
    if (!file) return
    setLoading(true)
    setStatus(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const resp = await apiFetch(endpoint, { method: 'POST', body: fd })
      const d = await resp.json()
      if (resp.ok) {
        setStatus({ ok: true, msg: 'Upload successful: ' + JSON.stringify(d.result) })
        setFile(null)
        if (formRef.current) formRef.current.reset()
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
    <Card title={title}>
      <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '18px', lineHeight: '1.5' }}>
        {description}
      </p>
      {status && (
        <div style={{
          padding: '9px 12px', borderRadius: '5px', fontSize: '12px',
          fontFamily: 'var(--mono)', marginBottom: '14px',
          background: status.ok ? 'var(--green-lo)' : 'var(--red-lo)',
          border: `1px solid ${status.ok ? 'var(--green)' : 'var(--red)'}`,
          color: status.ok ? 'var(--green)' : 'var(--red)',
          wordBreak: 'break-all',
        }}>{status.msg}</div>
      )}
      <form ref={formRef} onSubmit={handleSubmit}>
        <UploadZone
          accept={accept} icon={icon}
          label={`Drop ${accept.replace('.', '').toUpperCase()} here or click to browse`}
          hint={hint}
          onFileChange={setFile}
        />
        <button
          type="submit" disabled={!file || loading}
          className="btn btn-primary"
          style={{ marginTop: '14px', width: '100%', justifyContent: 'center',
                   opacity: (!file || loading) ? 0.5 : 1 }}
        >
          {loading ? 'Uploading…' : '↑ Upload to FastAPI'}
        </button>
      </form>
    </Card>
  )
}

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
    // strip empty optional fields
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
        const dur = r.duration_mins != null ? `${Math.floor(r.duration_mins / 60)}h ${r.duration_mins % 60}m` : ''
        const dist = r.distance_km != null ? `${r.distance_km.toLocaleString()} km` : ''
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

  const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }
  const grid3 = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }

  return (
    <Card title="Flight" style={{ marginTop: '24px' }}>
      <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '18px', lineHeight: '1.5' }}>
        Log a flight manually. Departure and arrival times are interpreted as local airport times —
        timezone conversion is handled server-side from airport coordinates.
      </p>
      {status && (
        <div style={{
          padding: '9px 12px', borderRadius: '5px', fontSize: '12px',
          fontFamily: 'var(--mono)', marginBottom: '14px',
          background: status.ok ? 'var(--green-lo)' : 'var(--red-lo)',
          border: `1px solid ${status.ok ? 'var(--green)' : 'var(--red)'}`,
          color: status.ok ? 'var(--green)' : 'var(--red)',
          wordBreak: 'break-all',
        }}>{status.msg}</div>
      )}
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

          <div style={grid2}>
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

          <div style={grid2}>
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

          <div style={grid3}>
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
                  style={{ alignSelf: 'flex-start', opacity: loading ? 0.5 : 1 }}>
            {loading ? 'Submitting…' : '↑ Log Flight'}
          </button>
        </div>
      </form>
    </Card>
  )
}

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
      country_code: fields.country_code,
      country: info.country,
      city: fields.city,
      local_currency: info.currency,
      source: fields.source,
      reference_year: parseInt(fields.reference_year, 10),
      is_estimated: fields.is_estimated,
      notes: fields.notes || null,
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
  const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }
  const grid3 = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }

  return (
    <Card title="Cost of Living" style={{ marginTop: '24px' }}>
      <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '18px', lineHeight: '1.5' }}>
        Log a cost of living entry for a country or city. Indices use Numbeo's NYC&nbsp;=&nbsp;100 baseline.
        Submitting a duplicate (same country + city) overwrites the existing row.
      </p>
      {status && (
        <div style={{
          padding: '9px 12px', borderRadius: '5px', fontSize: '12px',
          fontFamily: 'var(--mono)', marginBottom: '14px',
          background: status.ok ? 'var(--green-lo)' : 'var(--red-lo)',
          border: `1px solid ${status.ok ? 'var(--green)' : 'var(--red)'}`,
          color: status.ok ? 'var(--green)' : 'var(--red)',
          wordBreak: 'break-all',
        }}>{status.msg}</div>
      )}
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

          <div style={grid2}>
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

          <div style={grid3}>
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

          <div style={grid3}>
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

          <div style={grid2}>
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

          <div style={{ ...grid2, opacity: fields.city.trim() ? 1 : 0.35, transition: 'opacity .2s' }}>
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
                  style={{ alignSelf: 'flex-start', opacity: loading ? 0.5 : 1 }}>
            {loading ? 'Submitting…' : '↑ Log Cost of Living'}
          </button>
        </div>
      </form>
    </Card>
  )
}

export default function Upload() {
  const [apiStatus, setApiStatus] = useState(null)

  async function checkFastAPI() {
    setApiStatus({ checking: true })
    try {
      const resp = await apiFetch('/api/fastapi-health')
      const d = await resp.json()
      if (d.status === 'ok') {
        setApiStatus({ ok: true, msg: '● Online — HTTP ' + d.code })
      } else {
        setApiStatus({ ok: false, msg: '● Unreachable — ' + (d.detail || 'unknown error') })
      }
    } catch (e) {
      setApiStatus({ ok: false, msg: '● Error: ' + e.message })
    }
  }

  useEffect(() => { checkFastAPI() }, [])

  return (
    <>
      <div className="page-header">
        <h1>Upload</h1>
        <p>Upload transaction exports. Files are forwarded directly to the FastAPI ingestion endpoints.</p>
      </div>

      <div className="grid grid-2">
        <UploadCard
          title="Revolut CSV"
          description="Upload a Revolut transaction export (.csv). Duplicates are ignored via source_transaction_id."
          accept=".csv" icon="📄"
          hint="Revolut_account_statement_*.csv"
          endpoint="/upload/revolut"
        />
        <UploadCard
          title="Wise ZIP"
          description="Upload a Wise zip export containing per-currency/per-pot CSVs. Composite PKs handle the currency conversion ID collision."
          accept=".zip" icon="📦"
          hint="wise_transactions_*.zip"
          endpoint="/upload/wise"
        />
      </div>

      <FlightForm />

      <CostOfLivingForm />

      <Card title="FastAPI Status" style={{ marginTop: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: '13px',
            color: apiStatus?.ok === true  ? 'var(--green)'
                 : apiStatus?.ok === false ? 'var(--red)'
                 : 'var(--text-dim)',
          }}>
            {apiStatus?.checking ? 'Checking…' : (apiStatus?.msg ?? 'Checking…')}
          </div>
          <button className="btn btn-ghost" onClick={checkFastAPI} style={{ fontSize: '11px' }}>
            Refresh
          </button>
        </div>
      </Card>
    </>
  )
}
