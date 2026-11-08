import { useState, useEffect } from 'react'
import { Card } from '../components/Card'
import { Badge } from '../components/Badge'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { apiFetch } from '../api'
import { appleMapsUrl } from '../utils'

function formatDuration(mins) {
  if (mins == null) return null
  if (mins < 60) return `${mins}m`
  if (mins < 1440) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`
}

// `timeZone` should be the IANA zone of the place the timestamp represents
// (e.g. place.timezone from the API) — not the viewer's browser timezone.
// Falling back to undefined lets the browser use its own local zone, which
// is the best we can do for places we haven't geocoded a timezone for yet.
function formatDateTime(iso, timeZone) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      ...(timeZone ? { timeZone } : {}),
    })
  } catch {
    return iso
  }
}

function formatTimeRange(arrivedAt, departedAt, isOngoing, timeZone) {
  if (!arrivedAt) return '—'
  const tzOpt = timeZone ? { timeZone } : {}
  const arrived = new Date(arrivedAt)
  const arrivedStr = arrived.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    ...tzOpt,
  })
  if (isOngoing) return `${arrivedStr} → Ongoing`
  if (!departedAt) return arrivedStr
  const dep = new Date(departedAt)
  // Compare dates in the same zone we're displaying them in, so a visit that
  // crosses midnight locally (but not in the browser's zone, or vice versa)
  // still gets the "same day" short form.
  const sameDay = arrived.toLocaleDateString('en-GB', tzOpt) === dep.toLocaleDateString('en-GB', tzOpt)
  const depStr = sameDay
    ? dep.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', ...tzOpt })
    : dep.toLocaleString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
        ...tzOpt,
      })
  return `${arrivedStr} → ${depStr}`
}

const inputStyle = {
  background: 'var(--bg)', border: '1px solid var(--border2)', color: 'var(--text-hi)',
  borderRadius: '5px', padding: '7px 10px', fontFamily: 'var(--mono)', fontSize: '13px',
  width: '100%', outline: 'none', colorScheme: 'dark', boxSizing: 'border-box',
}

function StatusDot({ label, notes }) {
  const color =
    label !== null && notes !== null ? 'var(--green)'
    : label !== null               ? 'var(--yellow)'
    :                                 'var(--text-dim)'
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: color, flexShrink: 0, marginTop: 4,
    }} />
  )
}

// Sort options for the places list. Missing values always sort last.
const byDesc = (get) => (a, b) => {
  const x = get(a), y = get(b)
  if (x == null && y == null) return 0
  if (x == null) return 1
  if (y == null) return -1
  return x < y ? 1 : x > y ? -1 : 0
}
const SORTS = {
  recent:  { label: 'Last visited',      cmp: byDesc(p => p.last_visited ?? p.first_seen) },
  newest:  { label: 'Newest first seen', cmp: byDesc(p => p.first_seen) },
  oldest:  { label: 'Oldest first seen', cmp: (a, b) => a.first_seen < b.first_seen ? -1 : a.first_seen > b.first_seen ? 1 : 0 },
  visits:  { label: 'Most visits',       cmp: byDesc(p => p.visit_count) },
  time:    { label: 'Most time spent',   cmp: byDesc(p => p.total_time_mins) },
  name:    { label: 'Name A–Z',          cmp: (a, b) => {
    if (!a.label && !b.label) return 0
    if (!a.label) return 1
    if (!b.label) return -1
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  } },
}

function PlaceItem({ place, selected, onClick }) {
  const dur = formatDuration(place.total_time_mins)
  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 12px', cursor: 'pointer', borderRadius: '5px',
        background: selected ? 'var(--accent-lo)' : 'transparent',
        borderLeft: `2px solid ${selected ? 'var(--accent)' : 'transparent'}`,
        display: 'flex', alignItems: 'flex-start', gap: '10px',
      }}
    >
      <StatusDot label={place.label} notes={place.notes} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: '13px',
          color: place.label ? 'var(--text-hi)' : 'var(--text-dim)',
          fontStyle: place.label ? 'normal' : 'italic',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {place.label ?? 'Unlabelled'}
        </div>
        <div style={{
          fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {place.display_name ?? <em>Not geocoded</em>}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>
          {place.visit_count} visit{place.visit_count !== 1 ? 's' : ''}
          {dur ? ` · ${dur}` : ''}
        </div>
      </div>
    </div>
  )
}

function VisitRow({ visit, timezone, onUpdate }) {
  const [editing, setEditing]   = useState(false)
  const [notesInput, setNotes]  = useState(visit.notes ?? '')
  const [saving, setSaving]     = useState(false)

  async function saveNotes() {
    setSaving(true)
    try {
      const resp = await apiFetch(`/api/places/visits/${visit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notesInput || null }),
      })
      const d = await resp.json()
      if (resp.ok) {
        onUpdate(d)
        setEditing(false)
      }
    } finally {
      setSaving(false)
    }
  }

  const dur      = formatDuration(visit.duration_mins)
  const timeRange = formatTimeRange(visit.arrived_at, visit.departed_at, visit.is_ongoing, timezone)

  return (
    <div style={{
      background: 'var(--bg)', borderRadius: '5px', padding: '10px 12px',
      border: '1px solid var(--border2)', marginBottom: '6px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-hi)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span>{timeRange}</span>
            {visit.is_ongoing && <Badge variant="green">Ongoing</Badge>}
          </div>
          {dur && (
            <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>{dur}</div>
          )}
          {visit.notes
            ? (
              <div style={{
                fontSize: '12px', color: 'var(--text-dim)', marginTop: '6px',
                background: 'var(--surface)', padding: '4px 8px', borderRadius: '3px',
              }}>
                {visit.notes}
              </div>
            ) : (
              <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--text-dim)', display: 'inline-block' }} />
                No notes
              </div>
            )
          }
        </div>
        <button
          className="btn btn-ghost"
          style={{ fontSize: '11px', flexShrink: 0 }}
          onClick={() => { setEditing(e => !e); setNotes(visit.notes ?? '') }}
        >
          Edit notes
        </button>
      </div>

      {editing && (
        <div style={{ marginTop: '8px' }}>
          <textarea
            value={notesInput}
            onChange={e => setNotes(e.target.value)}
            style={{
              ...inputStyle, resize: 'vertical', minHeight: '60px', fontSize: '12px',
            }}
            autoFocus
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border2)'}
          />
          <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
            <button
              className="btn btn-primary"
              style={{ fontSize: '11px', opacity: saving ? 0.5 : 1 }}
              onClick={saveNotes}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              className="btn btn-ghost"
              style={{ fontSize: '11px' }}
              onClick={() => { setEditing(false); setNotes(visit.notes ?? '') }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

const fieldLabel = {
  fontSize: '11px', color: 'var(--text-dim)', display: 'block', marginBottom: '5px',
  fontFamily: 'var(--mono)', letterSpacing: '.06em', textTransform: 'uppercase',
}

const EMPTY_SUB = { name: '', type: '', notes: '', latitude: '', longitude: '', radius_m: '30', wifi_ssid: '' }

function SubPlaceForm({ initial, place, parentRadius, types, onSubmit, onCancel, submitting, submitLabel }) {
  const [f, setF] = useState(initial)
  const set = k => e => setF(prev => ({ ...prev, [k]: e.target.value }))

  const hasPin = f.latitude !== '' && f.longitude !== ''
  const halfPin = (f.latitude === '') !== (f.longitude === '')
  const dist = hasPin
    ? distanceM(place.latitude, place.longitude, parseFloat(f.latitude), parseFloat(f.longitude))
    : null
  const outside = dist != null && parentRadius != null && dist > parentRadius

  function submit() {
    onSubmit({
      name: f.name,
      type: f.type || null,
      notes: f.notes || null,
      latitude: hasPin ? parseFloat(f.latitude) : null,
      longitude: hasPin ? parseFloat(f.longitude) : null,
      radius_m: parseInt(f.radius_m, 10) || 30,
      wifi_ssid: f.wifi_ssid || null,
    })
  }

  const focus = e => e.target.style.borderColor = 'var(--accent)'
  const blur  = e => e.target.style.borderColor = 'var(--border2)'

  return (
    <div style={{
      border: '1px solid var(--border2)', borderRadius: '6px', padding: '12px',
      display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '10px',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div>
          <label style={fieldLabel}>Name</label>
          <input style={inputStyle} value={f.name} onChange={set('name')}
            placeholder="e.g. Bookshop" onFocus={focus} onBlur={blur} />
        </div>
        <div>
          <label style={fieldLabel}>Type</label>
          <input style={inputStyle} value={f.type} onChange={set('type')} list="sub-place-types"
            placeholder="Pick or type your own" onFocus={focus} onBlur={blur} />
          <datalist id="sub-place-types">
            {types.map(t => <option key={t.id} value={t.name} />)}
          </datalist>
        </div>
      </div>
      <div>
        <label style={fieldLabel}>Notes</label>
        <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '44px' }}
          value={f.notes} onChange={set('notes')} placeholder="Optional"
          onFocus={focus} onBlur={blur} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px', gap: '10px' }}>
        <div>
          <label style={fieldLabel}>Latitude</label>
          <input style={inputStyle} value={f.latitude} onChange={set('latitude')}
            placeholder="optional" inputMode="decimal" onFocus={focus} onBlur={blur} />
        </div>
        <div>
          <label style={fieldLabel}>Longitude</label>
          <input style={inputStyle} value={f.longitude} onChange={set('longitude')}
            placeholder="optional" inputMode="decimal" onFocus={focus} onBlur={blur} />
        </div>
        <div>
          <label style={fieldLabel}>Radius m</label>
          <input style={inputStyle} value={f.radius_m} onChange={set('radius_m')}
            inputMode="numeric" onFocus={focus} onBlur={blur} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" style={{ fontSize: '11px' }} type="button"
          onClick={() => setF(prev => ({
            ...prev, latitude: String(place.latitude), longitude: String(place.longitude),
          }))}>
          Use parent's coordinates
        </button>
        {halfPin && (
          <span style={{ fontSize: '11px', color: 'var(--red)' }}>
            Set both latitude and longitude, or neither
          </span>
        )}
        {outside && (
          <span style={{ fontSize: '11px', color: 'var(--yellow)' }}>
            ⚠ {Math.round(dist)} m from the parent (radius {Math.round(parentRadius)} m) — you can still save
          </span>
        )}
      </div>
      <div>
        <label style={fieldLabel}>Wi-Fi SSID</label>
        <input style={inputStyle} value={f.wifi_ssid} onChange={set('wifi_ssid')}
          placeholder="optional — helps detect this sub-place later" onFocus={focus} onBlur={blur} />
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button className="btn btn-primary" onClick={submit}
          disabled={submitting || halfPin || !f.name.trim()}>
          {submitting ? 'Saving…' : submitLabel}
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function subToForm(sp) {
  return {
    name: sp.name, type: sp.type ?? '', notes: sp.notes ?? '',
    latitude: sp.latitude == null ? '' : String(sp.latitude),
    longitude: sp.longitude == null ? '' : String(sp.longitude),
    radius_m: String(sp.radius_m), wifi_ssid: sp.wifi_ssid ?? '',
  }
}

function SubPlaces({ place, showToast }) {
  const [subs, setSubs]       = useState(null)
  const [types, setTypes]     = useState([])
  const [parentRadius, setParentRadius] = useState(null)
  const [adding, setAdding]   = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setSubs(null); setAdding(false); setEditingId(null)
    load()
  }, [place.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    try {
      const [r1, r2] = await Promise.all([
        apiFetch(`/api/places/${place.id}/sub-places`),
        apiFetch('/api/places/sub-place-types'),
      ])
      if (r1.ok) {
        const d = await r1.json()
        setSubs(d.sub_places); setParentRadius(d.parent_radius_m)
      }
      if (r2.ok) setTypes((await r2.json()).types)
    } catch {}
  }

  async function send(url, method, body, okMsg, after) {
    setSubmitting(true)
    try {
      const resp = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const d = await resp.json()
      if (resp.ok) {
        after(d)
        showToast(okMsg, 'var(--green)')
        apiFetch('/api/places/sub-place-types').then(r => r.ok && r.json()).then(j => j && setTypes(j.types)).catch(() => {})
      } else {
        showToast(`✗ ${d.detail?.message ?? d.detail ?? d.error ?? 'Failed'}`, 'var(--red)')
      }
    } catch (e) {
      showToast(`✗ ${e.message}`, 'var(--red)')
    } finally {
      setSubmitting(false)
    }
  }

  const create = body => send(`/api/places/${place.id}/sub-places`, 'POST', body, '✓ Sub-place added',
    d => { setSubs(ss => [...(ss ?? []), d].sort((a, b) => a.name.localeCompare(b.name))); setAdding(false) })

  const update = id => body => send(`/api/places/sub-places/${id}`, 'PATCH', body, '✓ Saved',
    d => { setSubs(ss => ss.map(x => x.id === id ? d : x)); setEditingId(null) })

  function archive(sp) {
    if (!window.confirm(`Archive "${sp.name}"? It is hidden from this list but kept in the database.`)) return
    send(`/api/places/sub-places/${sp.id}`, 'DELETE', null, '✓ Archived',
      () => setSubs(ss => ss.filter(x => x.id !== sp.id)))
  }

  return (
    <div style={{ borderTop: '1px solid var(--border2)', paddingTop: '16px', marginBottom: '20px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px',
      }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '13px', fontWeight: 600, color: 'var(--text-hi)' }}>
          Sub-places{subs ? ` (${subs.length})` : ''}
        </div>
        {!adding && (
          <button className="btn btn-ghost" style={{ fontSize: '11px' }} onClick={() => { setAdding(true); setEditingId(null) }}>
            + Add
          </button>
        )}
      </div>

      {adding && (
        <SubPlaceForm initial={EMPTY_SUB} place={place} parentRadius={parentRadius} types={types}
          onSubmit={create} onCancel={() => setAdding(false)} submitting={submitting} submitLabel="Add sub-place" />
      )}

      {subs === null
        ? <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>Loading…</div>
        : subs.length === 0 && !adding
          ? <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
              None yet — add distinct spots that sit inside this place.
            </div>
          : subs.map(sp => editingId === sp.id
              ? <SubPlaceForm key={sp.id} initial={subToForm(sp)} place={place} parentRadius={parentRadius}
                  types={types} onSubmit={update(sp.id)} onCancel={() => setEditingId(null)}
                  submitting={submitting} submitLabel="Save" />
              : (
                <div key={sp.id} style={{
                  display: 'flex', justifyContent: 'space-between', gap: '12px',
                  padding: '8px 0', borderBottom: '1px solid var(--border2)',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '13px', color: 'var(--text-hi)' }}>
                      {sp.name}
                      {sp.type && <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-dim)' }}>{sp.type}</span>}
                      {sp.latitude != null && <span title={`${sp.latitude}, ${sp.longitude} · ${sp.radius_m} m`} style={{ marginLeft: '8px', fontSize: '11px' }}>📍</span>}
                      {sp.wifi_ssid && <span title={`Wi-Fi: ${sp.wifi_ssid}`} style={{ marginLeft: '6px', fontSize: '11px' }}>📶</span>}
                    </div>
                    {sp.notes && <div style={{ fontSize: '12px', color: 'var(--text-dim)', whiteSpace: 'pre-wrap' }}>{sp.notes}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <button className="btn btn-ghost" style={{ fontSize: '11px' }} onClick={() => { setEditingId(sp.id); setAdding(false) }}>Edit</button>
                    <button className="btn btn-ghost" style={{ fontSize: '11px' }} onClick={() => archive(sp)}>Archive</button>
                  </div>
                </div>
              ))
      }
    </div>
  )
}

function CoordLink({ place }) {
  return (
    <a href={appleMapsUrl(place.latitude, place.longitude, place.label)}
      target="_blank" rel="noopener noreferrer"
      title="Open in Apple Maps"
      style={{ color: 'inherit', textDecoration: 'underline dotted' }}>
      {place.latitude.toFixed(4)}°, {place.longitude.toFixed(4)}°
    </a>
  )
}

function DeletePlaceModal({ place, open, onClose, onDeleted }) {
  const [typed, setTyped]         = useState('')
  const [understood, setUnderstood] = useState(false)
  const [subCount, setSubCount]   = useState(null)
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState(null)

  useEffect(() => {
    if (!open) return
    setTyped(''); setUnderstood(false); setError(null); setSubCount(null)
    apiFetch(`/api/places/${place.id}/sub-places`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setSubCount(d.sub_places.length))
      .catch(() => {})
  }, [open, place.id])

  const dur = formatDuration(place.total_time_mins)
  const canDelete = understood && typed.trim() === String(place.id) && !busy

  async function confirmDelete() {
    setBusy(true); setError(null)
    try {
      const resp = await apiFetch(`/api/places/${place.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_id: place.id }),
      })
      const d = await resp.json()
      if (resp.ok) onDeleted(d)
      else setError(d.detail?.message ?? d.detail ?? d.error ?? 'Delete failed')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="Delete place">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
        <div style={{ color: 'var(--text-hi)' }}>
          <strong>{place.label ?? 'Unlabelled place'}</strong>
          <span style={{ color: 'var(--text-dim)' }}> · ID {place.id}</span>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>
            <CoordLink place={place} />
          </div>
        </div>

        <div style={{
          border: '1px solid var(--red)', background: 'var(--red-lo)', borderRadius: '6px',
          padding: '10px 12px', color: 'var(--text-hi)', lineHeight: 1.5,
        }}>
          This hides the place from the Places list, the map, daily summaries and future
          arrival detection, along with:
          <ul style={{ margin: '6px 0 0', paddingLeft: '18px' }}>
            <li>{place.visit_count} visit{place.visit_count !== 1 ? 's' : ''}{dur ? ` (${dur} total)` : ''}</li>
            <li>{subCount === null ? '…' : subCount} sub-place{subCount === 1 ? '' : 's'}</li>
          </ul>
          <div style={{ marginTop: '6px', color: 'var(--text-dim)' }}>
            Nothing is erased from the database and it can be restored, but there is no
            restore button yet.
          </div>
        </div>

        <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', cursor: 'pointer' }}>
          <input type="checkbox" checked={understood} onChange={e => setUnderstood(e.target.checked)}
            style={{ marginTop: '3px' }} />
          <span>I understand the above and want to delete this place.</span>
        </label>

        <div>
          <label style={fieldLabel}>Type the place ID ({place.id}) to confirm</label>
          <input style={inputStyle} value={typed} onChange={e => setTyped(e.target.value)}
            placeholder={String(place.id)} inputMode="numeric" autoComplete="off" />
        </div>

        {error && <div style={{ color: 'var(--red)', fontSize: '12px' }}>✗ {error}</div>}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-danger" onClick={confirmDelete} disabled={!canDelete}
            style={{ opacity: canDelete ? 1 : 0.5 }}>
            {busy ? 'Deleting…' : 'Delete place'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function DetailPanel({ place, onPlaceUpdate, onDeleted }) {
  const { Toast, showToast }    = useToast()
  const [labelInput, setLabel]  = useState(place.label ?? '')
  const [notesInput, setNotes]  = useState(place.notes ?? '')
  const [saving, setSaving]     = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [displayName, setDisplayName] = useState(place.display_name)
  const [isGeocoded, setIsGeocoded]   = useState(place.is_geocoded)
  const [visits, setVisits]     = useState(null)
  const [visitsTimezone, setVisitsTimezone] = useState(place.timezone)
  const [unnotedOnly, setUnnotedOnly] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  useEffect(() => {
    setLabel(place.label ?? '')
    setNotes(place.notes ?? '')
    setDisplayName(place.display_name)
    setIsGeocoded(place.is_geocoded)
    setVisits(null)
    setVisitsTimezone(place.timezone)
    loadVisits()
  }, [place.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadVisits() {
    try {
      const resp = await apiFetch(`/api/places/${place.id}/visits`)
      const d = await resp.json()
      if (resp.ok) {
        setVisits(d.visits)
        // API is the source of truth for the place's timezone; falls back to
        // place.timezone (set above) if the endpoint doesn't have one either.
        if (d.timezone) setVisitsTimezone(d.timezone)
      }
    } catch {}
  }

  async function handleSave() {
    setSaving(true)
    try {
      const resp = await apiFetch(`/api/places/${place.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: labelInput || null, notes: notesInput || null }),
      })
      const d = await resp.json()
      if (resp.ok) {
        onPlaceUpdate(d)
        showToast('✓ Saved', 'var(--green)')
      } else {
        showToast(`✗ ${d.detail || d.error || 'Save failed'}`, 'var(--red)')
      }
    } catch (e) {
      showToast(`✗ ${e.message}`, 'var(--red)')
    } finally {
      setSaving(false)
    }
  }

  async function handleGeocode() {
    setGeocoding(true)
    try {
      const resp = await apiFetch(`/api/places/${place.id}/geocode`, { method: 'POST' })
      const d = await resp.json()
      if (resp.ok) {
        setDisplayName(d.display_name)
        setIsGeocoded(true)
        onPlaceUpdate({ ...place, display_name: d.display_name, is_geocoded: true })
        showToast('✓ Geocoded', 'var(--green)')
      } else {
        showToast(`✗ ${d.detail || d.error || 'Geocoding failed'}`, 'var(--red)')
      }
    } catch (e) {
      showToast(`✗ ${e.message}`, 'var(--red)')
    } finally {
      setGeocoding(false)
    }
  }

  function updateVisit(updated) {
    setVisits(vs => vs.map(v => v.id === updated.id ? updated : v))
  }

  const dur            = formatDuration(place.total_time_mins)
  const visibleVisits  = unnotedOnly ? (visits ?? []).filter(v => !v.notes) : (visits ?? [])

  return (
    <Card>
      <Toast />

      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: '18px', fontWeight: 700,
          color: 'var(--text-hi)', marginBottom: '6px',
        }}>
          {place.label
            ? place.label
            : <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>Unlabelled</span>
          }
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
            {displayName ?? <em>Not geocoded</em>}
          </div>
          {!isGeocoded && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: '11px' }}
              onClick={handleGeocode}
              disabled={geocoding}
            >
              {geocoding ? '…' : 'Geocode'}
            </button>
          )}
        </div>

        <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '6px' }}>
          <CoordLink place={place} />
          {' · '}First seen {formatDateTime(place.first_seen, place.timezone)}
          {' · '}{place.visit_count} visit{place.visit_count !== 1 ? 's' : ''}
          {dur ? ` · ${dur} total` : ''}
        </div>
      </div>

      {/* Edit form */}
      <div style={{ borderTop: '1px solid var(--border2)', paddingTop: '16px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{
              fontSize: '11px', color: 'var(--text-dim)', display: 'block', marginBottom: '5px',
              fontFamily: 'var(--mono)', letterSpacing: '.06em', textTransform: 'uppercase',
            }}>Label</label>
            <input
              style={inputStyle}
              value={labelInput}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Camp Office"
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border2)'}
            />
          </div>
          <div>
            <label style={{
              fontSize: '11px', color: 'var(--text-dim)', display: 'block', marginBottom: '5px',
              fontFamily: 'var(--mono)', letterSpacing: '.06em', textTransform: 'uppercase',
            }}>Notes</label>
            <textarea
              style={{ ...inputStyle, resize: 'vertical', minHeight: '60px' }}
              value={notesInput}
              onChange={e => setNotes(e.target.value)}
              placeholder="Optional notes"
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border2)'}
            />
          </div>
          <button
            className="btn btn-primary"
            style={{ alignSelf: 'flex-start', opacity: saving ? 0.5 : 1 }}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px dashed var(--border2)' }}>
          <button className="btn btn-danger btn-sm" onClick={() => setDeleteOpen(true)}>
            Delete place…
          </button>
        </div>
        <DeletePlaceModal place={place} open={deleteOpen}
          onClose={() => setDeleteOpen(false)} onDeleted={onDeleted} />
      </div>

      <SubPlaces place={place} showToast={showToast} />

      {/* Visit history */}
      <div style={{ borderTop: '1px solid var(--border2)', paddingTop: '16px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '12px',
        }}>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: '13px',
            fontWeight: 600, color: 'var(--text-hi)',
          }}>
            Visits
          </div>
          <label style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: '11px', color: 'var(--text-dim)', cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={unnotedOnly}
              onChange={e => setUnnotedOnly(e.target.checked)}
            />
            Un-noted only
          </label>
        </div>

        {visits === null
          ? <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>Loading…</div>
          : visibleVisits.length === 0
            ? <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                No visits{unnotedOnly ? ' without notes' : ''}
              </div>
            : visibleVisits.map(v => (
                <VisitRow key={v.id} visit={v} timezone={visitsTimezone} onUpdate={updateVisit} />
              ))
        }
      </div>
    </Card>
  )
}

export default function Places() {
  const [places, setPlaces]           = useState(null)
  const [selectedId, setSelectedId]   = useState(null)
  const [unlabelledOnly, setUnlabelled] = useState(false)
  const [noNotesOnly, setNoNotesOnly]   = useState(false)
  const [query, setQuery]               = useState('')
  const [sortKey, setSortKey]           = useState('recent')
  const [loading, setLoading]         = useState(true)
  const [adding, setAdding]           = useState(false)
  const { Toast, showToast }          = useToast()

  useEffect(() => { loadPlaces() }, [])

  async function handleAddCurrent() {
    if (!window.confirm('Add your current location as a known place now?')) return
    setAdding(true)
    try {
      const resp = await apiFetch('/api/places/add-current', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const d = await resp.json()
      if (resp.ok) {
        setPlaces(ps => [d, ...(ps ?? [])])
        setSelectedId(d.id)
        showToast('✓ Added current location', 'var(--green)')
      } else {
        const detail = d.detail?.message ?? d.detail ?? d.error ?? 'Add failed'
        if (resp.status === 409 && d.detail?.place_id) setSelectedId(d.detail.place_id)
        showToast(`✗ ${detail}`, 'var(--red)')
      }
    } catch (e) {
      showToast(`✗ ${e.message}`, 'var(--red)')
    } finally {
      setAdding(false)
    }
  }

  async function loadPlaces() {
    setLoading(true)
    try {
      const resp = await apiFetch('/api/places')
      const d = await resp.json()
      if (resp.ok) setPlaces(d.places)
    } finally {
      setLoading(false)
    }
  }

  function handleDeleted(d) {
    setPlaces(ps => ps.filter(p => p.id !== d.id))
    setSelectedId(null)
    showToast(`✓ Deleted place ${d.id}`, 'var(--green)')
  }

  function updatePlace(updated) {
    setPlaces(ps => ps.map(p => p.id === updated.id ? { ...p, ...updated } : p))
  }

  const q = query.trim().toLowerCase()
  const filtering = unlabelledOnly || noNotesOnly || q !== ''
  const visiblePlaces = (places ?? [])
    .filter(p => !unlabelledOnly || p.label === null)
    .filter(p => !noNotesOnly || !p.notes)
    .filter(p => q === '' || [String(p.id), p.label, p.notes, p.display_name]
      .some(v => v && String(v).toLowerCase().includes(q)))
    .sort(SORTS[sortKey].cmp)

  const selectedPlace = places?.find(p => p.id === selectedId) ?? null

  return (
    <>
      <div className="page-header">
        <h1>Places</h1>
        <p>Label auto-detected stay locations and annotate individual visits.</p>
        <button className="btn btn-primary" onClick={handleAddCurrent} disabled={adding}>
          {adding ? 'Adding…' : '📍 Add current location'}
        </button>
      </div>
      <Toast />

      <div className="places-layout">
        {/* Left column — places list */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border2)',
          borderRadius: '8px', overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px', borderBottom: '1px solid var(--border2)',
            display: 'flex', flexDirection: 'column', gap: '10px',
          }}>
            <div style={{
              fontFamily: 'var(--mono)', fontSize: '13px',
              fontWeight: 600, color: 'var(--text-hi)',
            }}>
              {places
                ? filtering
                  ? `${visiblePlaces.length} of ${places.length} place${places.length !== 1 ? 's' : ''}`
                  : `${places.length} place${places.length !== 1 ? 's' : ''}`
                : 'Places'}
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                style={{ ...inputStyle, flex: 1, minWidth: 0, fontSize: '12px', padding: '6px 9px' }}
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search label, notes, address, ID"
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border2)'}
              />
              <select
                style={{ ...inputStyle, width: 'auto', fontSize: '12px', padding: '6px 9px' }}
                value={sortKey}
                onChange={e => setSortKey(e.target.value)}
                aria-label="Sort places"
              >
                {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                fontSize: '11px', color: 'var(--text-dim)', cursor: 'pointer',
              }}>
                <input type="checkbox" checked={unlabelledOnly} onChange={e => setUnlabelled(e.target.checked)} />
                Unlabelled only
              </label>
              <label style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                fontSize: '11px', color: 'var(--text-dim)', cursor: 'pointer',
              }}>
                <input type="checkbox" checked={noNotesOnly} onChange={e => setNoNotesOnly(e.target.checked)} />
                No notes only
              </label>
              {filtering && (
                <button className="btn btn-ghost btn-sm"
                  onClick={() => { setQuery(''); setUnlabelled(false); setNoNotesOnly(false) }}>
                  Clear
                </button>
              )}
            </div>
          </div>

          <div style={{ maxHeight: 'min(calc(100vh - 220px), 400px)', overflowY: 'auto', padding: '6px' }}>
            {loading
              ? <div style={{ padding: '12px', fontSize: '12px', color: 'var(--text-dim)' }}>Loading…</div>
              : visiblePlaces.length === 0
                ? <div style={{ padding: '12px', fontSize: '12px', color: 'var(--text-dim)' }}>
                    {filtering ? 'No places match these filters' : 'No places'}
                  </div>
                : visiblePlaces.map(p => (
                    <PlaceItem
                      key={p.id}
                      place={p}
                      selected={selectedId === p.id}
                      onClick={() => setSelectedId(p.id)}
                    />
                  ))
            }
          </div>
        </div>

        {/* Right column — detail panel */}
        <div>
          {selectedPlace
            ? <DetailPanel key={selectedId} place={selectedPlace} onPlaceUpdate={updatePlace} onDeleted={handleDeleted} />
            : (
              <div style={{
                background: 'var(--surface)', border: '1px solid var(--border2)',
                borderRadius: '8px', padding: '48px', textAlign: 'center',
                color: 'var(--text-dim)', fontSize: '13px', fontFamily: 'var(--mono)',
              }}>
                Select a place to view details
              </div>
            )
          }
        </div>
      </div>
    </>
  )
}
