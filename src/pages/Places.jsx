import { useState, useEffect } from 'react'
import { Card } from '../components/Card'
import { Badge } from '../components/Badge'
import { useToast } from '../components/Toast'
import { apiFetch } from '../api'

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

function formatDateTime(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function formatTimeRange(arrivedAt, departedAt, isOngoing) {
  if (!arrivedAt) return '—'
  const arrived = new Date(arrivedAt)
  const arrivedStr = arrived.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
  if (isOngoing) return `${arrivedStr} → Ongoing`
  if (!departedAt) return arrivedStr
  const dep = new Date(departedAt)
  const sameDay = arrived.toDateString() === dep.toDateString()
  const depStr = sameDay
    ? dep.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : dep.toLocaleString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
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

function VisitRow({ visit, onUpdate }) {
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
  const timeRange = formatTimeRange(visit.arrived_at, visit.departed_at, visit.is_ongoing)

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

function DetailPanel({ place, onPlaceUpdate }) {
  const { Toast, showToast }    = useToast()
  const [labelInput, setLabel]  = useState(place.label ?? '')
  const [notesInput, setNotes]  = useState(place.notes ?? '')
  const [saving, setSaving]     = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [displayName, setDisplayName] = useState(place.display_name)
  const [isGeocoded, setIsGeocoded]   = useState(place.is_geocoded)
  const [visits, setVisits]     = useState(null)
  const [unnotedOnly, setUnnotedOnly] = useState(false)

  useEffect(() => {
    setLabel(place.label ?? '')
    setNotes(place.notes ?? '')
    setDisplayName(place.display_name)
    setIsGeocoded(place.is_geocoded)
    setVisits(null)
    loadVisits()
  }, [place.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadVisits() {
    try {
      const resp = await apiFetch(`/api/places/${place.id}/visits`)
      const d = await resp.json()
      if (resp.ok) setVisits(d.visits)
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
          {place.latitude.toFixed(4)}°, {place.longitude.toFixed(4)}°
          {' · '}First seen {formatDateTime(place.first_seen)}
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
      </div>

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
                <VisitRow key={v.id} visit={v} onUpdate={updateVisit} />
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
  const [loading, setLoading]         = useState(true)

  useEffect(() => { loadPlaces() }, [])

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

  function updatePlace(updated) {
    setPlaces(ps => ps.map(p => p.id === updated.id ? { ...p, ...updated } : p))
  }

  const visiblePlaces  = unlabelledOnly
    ? (places ?? []).filter(p => p.label === null)
    : (places ?? [])

  const selectedPlace = places?.find(p => p.id === selectedId) ?? null

  return (
    <>
      <div className="page-header">
        <h1>Places</h1>
        <p>Label auto-detected stay locations and annotate individual visits.</p>
      </div>

      <div className="places-layout">
        {/* Left column — places list */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border2)',
          borderRadius: '8px', overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px', borderBottom: '1px solid var(--border2)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{
              fontFamily: 'var(--mono)', fontSize: '13px',
              fontWeight: 600, color: 'var(--text-hi)',
            }}>
              {places ? `${places.length} place${places.length !== 1 ? 's' : ''}` : 'Places'}
            </div>
            <label style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              fontSize: '11px', color: 'var(--text-dim)', cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={unlabelledOnly}
                onChange={e => setUnlabelled(e.target.checked)}
              />
              Unlabelled only
            </label>
          </div>

          <div style={{ maxHeight: 'min(calc(100vh - 220px), 400px)', overflowY: 'auto', padding: '6px' }}>
            {loading
              ? <div style={{ padding: '12px', fontSize: '12px', color: 'var(--text-dim)' }}>Loading…</div>
              : visiblePlaces.length === 0
                ? <div style={{ padding: '12px', fontSize: '12px', color: 'var(--text-dim)' }}>
                    No places{unlabelledOnly ? ' without labels' : ''}
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
            ? <DetailPanel key={selectedId} place={selectedPlace} onPlaceUpdate={updatePlace} />
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
