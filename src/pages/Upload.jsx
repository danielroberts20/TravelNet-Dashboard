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
