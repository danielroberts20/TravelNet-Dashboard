import { useState, useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { apiJson } from '../api'
import { timeSince } from '../utils'

const FALLBACK_STYLE = 'https://tiles.openfreemap.org/styles/bright'
const MAPTILER_STYLE = (key) => `https://api.maptiler.com/maps/dataviz/style.json?key=${key}`

const WINDOW_OPTIONS = [
  { label: '6h',  value: 6   },
  { label: '24h', value: 24  },
  { label: '48h', value: 48  },
  { label: '7d',  value: 168 },
]

const INJECTED_CSS = `
@keyframes loc-pulse {
  0%   { transform: translate(-50%,-50%) scale(1);   opacity: 0.8; }
  100% { transform: translate(-50%,-50%) scale(1.8); opacity: 0; }
}
.loc-pulse-container { position:relative; width:20px; height:20px; pointer-events:none; }
.loc-pulse-ring {
  position:absolute; top:50%; left:50%;
  transform:translate(-50%,-50%);
  width:20px; height:20px; border-radius:50%;
  background:rgba(10,132,255,0.35);
  animation:loc-pulse 2s ease-out infinite;
}
.loc-pulse-dot {
  position:absolute; top:50%; left:50%;
  transform:translate(-50%,-50%);
  width:12px; height:12px; border-radius:50%;
  background:#0A84FF; border:2px solid #fff;
  box-shadow:0 1px 4px rgba(0,0,0,0.3);
}
.loc-place-chip {
  background:#fff; border:1px solid rgba(0,0,0,0.18); border-radius:10px;
  padding:2px 8px;
  font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
  font-size:11px; color:#333; cursor:default;
  max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  display:flex; align-items:center; min-height:20px; user-select:none;
}
.maplibregl-popup-content { padding:10px 12px !important; border-radius:8px !important; }
`

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTs(ts) {
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
       + ' ' + d.toLocaleDateString([], { day: '2-digit', month: 'short' })
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' })
  } catch { return iso?.slice(0, 10) ?? '—' }
}

function fmtDuration(mins) {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function createPulseMarker() {
  const c = document.createElement('div')
  c.className = 'loc-pulse-container'
  const ring = document.createElement('div')
  ring.className = 'loc-pulse-ring'
  const dot = document.createElement('div')
  dot.className = 'loc-pulse-dot'
  c.appendChild(ring)
  c.appendChild(dot)
  return c
}

function createPlaceChip(place, placeVisits) {
  const el = document.createElement('div')
  el.className = 'loc-place-chip'
  const baseLabel = place.label
    || `~${Number(place.latitude).toFixed(2)}, ${Number(place.longitude).toFixed(2)}`
  let text = baseLabel
  if (placeVisits && placeVisits.length === 1) {
    text = `${baseLabel} · ${fmtDuration(placeVisits[0].duration_mins)}`
  } else if (placeVisits && placeVisits.length > 1) {
    text = `${baseLabel} ×${placeVisits.length}`
  }
  el.title = place.label || ''
  el.textContent = text
  return el
}

function placePopupHtml(place, placeVisits) {
  const label    = place.label || 'Unlabelled place'
  const lastSeen = place.last_visited ? timeSince(place.last_visited) : 'never'
  const lat      = Number(place.latitude).toFixed(4)
  const lon      = Number(place.longitude).toFixed(4)
  const dispLine = place.display_name
    ? `<div style="color:#888;font-size:10px;margin-bottom:4px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${place.display_name}</div>`
    : ''
  let visitLines = ''
  if (placeVisits && placeVisits.length > 0) {
    visitLines = '<div style="margin-top:4px;border-top:1px solid #eee;padding-top:4px">'
    visitLines += placeVisits.map(v => {
      const arr = formatTs(v.arrived_at)
      const dep = v.departed_at ? formatTs(v.departed_at) : 'ongoing'
      return `<div style="color:#555;font-size:10px;margin-bottom:1px">${arr} → ${dep} (${fmtDuration(v.duration_mins)})</div>`
    }).join('')
    visitLines += '</div>'
  }
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;font-size:12px">
    <div style="font-weight:600;color:#111;margin-bottom:2px">${label}</div>
    ${dispLine}
    <div style="color:#666;margin-bottom:2px">Visits: ${place.visit_count ?? 0}</div>
    <div style="color:#666;margin-bottom:2px">Last: ${lastSeen}</div>
    <div style="color:#999;font-size:10px">${lat}, ${lon}</div>
    ${visitLines}
  </div>`
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Location() {
  const today = new Date().toISOString().split('T')[0]

  const [selectedDate, setSelectedDate] = useState(today)
  const [windowHours,  setWindowHours]  = useState(24)
  const [pointsData,   setPointsData]   = useState(null)
  const [places,       setPlaces]       = useState([])
  const [fetching,     setFetching]     = useState(false)
  const [error,        setError]        = useState(null)
  const [mapReady,     setMapReady]     = useState(false)
  const [mapStyle,     setMapStyle]     = useState(null)

  const mapContainerRef = useRef(null)
  const mapRef          = useRef(null)
  const pulseMarkerRef  = useRef(null)
  const placeMarkersRef = useRef([])

  // Resolve map style: use MapTiler if a key is configured, otherwise fall back to OpenFreeMap
  useEffect(() => {
    apiJson('/api/config/map-key')
      .then(d => setMapStyle(d.key ? MAPTILER_STYLE(d.key) : FALLBACK_STYLE))
      .catch(() => setMapStyle(FALLBACK_STYLE))
  }, [])

  // Initialise MapLibre once the style URL is known
  useEffect(() => {
    if (!mapStyle) return
    const map = new maplibregl.Map({
      container:          mapContainerRef.current,
      style:              mapStyle,
      center:             [0, 20],
      zoom:               2,
      attributionControl: false,
      cooperativeGestures: false,
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right')
    mapRef.current = map

    map.on('load', () => {
      // GeoJSON source with lineMetrics required for line-gradient
      map.addSource('location-track', {
        type:        'geojson',
        data:        { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } },
        lineMetrics: true,
      })

      // White halo gives the Apple Maps nav-line look
      map.addLayer({
        id:     'location-track-casing',
        type:   'line',
        source: 'location-track',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint:  { 'line-width': 6, 'line-color': '#ffffff', 'line-opacity': 0.6, 'line-blur': 2 },
      })

      // Main track with time-based colour gradient (old → new = indigo → blue)
      map.addLayer({
        id:     'location-track-line',
        type:   'line',
        source: 'location-track',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint:  {
          'line-width': 3.5,
          'line-gradient': [
            'interpolate', ['linear'], ['line-progress'],
            0, 'hsl(240, 60%, 55%)',
            1, 'hsl(210, 90%, 55%)',
          ],
        },
      })

      setMapReady(true)
    })

    return () => {
      if (pulseMarkerRef.current) { pulseMarkerRef.current.remove(); pulseMarkerRef.current = null }
      placeMarkersRef.current.forEach(m => m.remove())
      placeMarkersRef.current = []
      map.remove()
    }
  }, [mapStyle]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch location points whenever date or window changes
  useEffect(() => {
    loadPoints()
  }, [selectedDate, windowHours]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadPoints() {
    setFetching(true)
    setError(null)
    try {
      const res = await apiJson(`/api/location-points?end_date=${selectedDate}&hours=${windowHours}`)
      if (res.error) throw new Error(res.error)
      setPointsData(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setFetching(false)
    }
  }

  // Fetch known places once on mount
  useEffect(() => {
    apiJson('/api/location/known-places')
      .then(d => { if (!d.error) setPlaces(d.places || []) })
      .catch(() => {})
  }, [])

  // Update track + latest-position marker when data or map readiness changes
  // We keep the previous track visible while fetching (don't clear on setFetching)
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const map = mapRef.current
    const points = pointsData?.points || []
    const coords = points.map(p => [p.longitude, p.latitude])

    const src = map.getSource('location-track')
    if (src) {
      // A LineString with < 2 coords is invalid — render empty track instead
      src.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords.length >= 2 ? coords : [] } })
    }

    if (pulseMarkerRef.current) { pulseMarkerRef.current.remove(); pulseMarkerRef.current = null }

    if (coords.length > 0) {
      const latest = points[points.length - 1]
      pulseMarkerRef.current = new maplibregl.Marker({ element: createPulseMarker() })
        .setLngLat([latest.longitude, latest.latitude])
        .addTo(map)

      if (coords.length === 1) {
        map.flyTo({ center: coords[0], zoom: 14, duration: 800 })
      } else {
        const bounds = coords.reduce(
          (b, c) => b.extend(c),
          new maplibregl.LngLatBounds(coords[0], coords[0]),
        )
        map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 800 })
      }
    }
  }, [mapReady, pointsData])

  // Add known-places markers; show only at zoom >= 8; annotate with visit durations from current window
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const map = mapRef.current

    placeMarkersRef.current.forEach(m => m.remove())
    placeMarkersRef.current = []

    const visitsByPlaceId = {}
    for (const v of pointsData?.visits || []) {
      if (!visitsByPlaceId[v.known_place_id]) visitsByPlaceId[v.known_place_id] = []
      visitsByPlaceId[v.known_place_id].push(v)
    }

    const markerObjs = places.map(place => {
      const placeVisits = visitsByPlaceId[place.id] || null
      const el    = createPlaceChip(place, placeVisits)
      const popup = new maplibregl.Popup({ offset: 10, closeButton: false, maxWidth: '240px' })
        .setHTML(placePopupHtml(place, placeVisits))
        .setLngLat([place.longitude, place.latitude])
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([place.longitude, place.latitude])
        .addTo(map)
      el.addEventListener('mouseenter', () => popup.addTo(map))
      el.addEventListener('mouseleave', () => popup.remove())
      return { marker, popup }
    })
    placeMarkersRef.current = markerObjs.map(o => o.marker)

    function updateVisibility() {
      const show = map.getZoom() >= 8
      markerObjs.forEach(({ marker }) => {
        marker.getElement().style.display = show ? '' : 'none'
      })
    }
    updateVisibility()
    map.on('zoom', updateVisibility)

    return () => {
      map.off('zoom', updateVisibility)
      markerObjs.forEach(({ marker, popup }) => { popup.remove(); marker.remove() })
      placeMarkersRef.current = []
    }
  }, [mapReady, places, pointsData])

  const pts    = pointsData?.points || []
  const latest = pts.length > 0 ? pts[pts.length - 1] : null

  return (
    <>
      <style>{INJECTED_CSS}</style>

      <div className="page-header" style={{ paddingBottom: '12px' }}>

        {/* Title + latest point */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
          <h1>Location</h1>
          {latest && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)' }}>
              {formatTs(latest.timestamp)} · {timeSince(latest.timestamp)}
            </span>
          )}
        </div>

        {/* Controls row — wraps to two lines on narrow screens */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            style={{
              background: 'var(--surface)', border: '1px solid var(--border2)',
              color: 'var(--text-hi)', borderRadius: '5px', padding: '6px 10px',
              fontFamily: 'var(--mono)', fontSize: '12px', outline: 'none',
              cursor: 'pointer', minHeight: '44px',
            }}
          />
          <button className="btn btn-ghost" onClick={() => setSelectedDate(today)}
                  style={{ minHeight: '44px' }}>
            Today
          </button>

          {/* Window toggle */}
          <div style={{ display: 'flex', gap: '3px' }}>
            {WINDOW_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={'level-btn' + (windowHours === opt.value ? ' active' : '')}
                onClick={() => setWindowHours(opt.value)}
                style={{ minHeight: '44px' }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button className="btn btn-ghost" onClick={loadPoints}
                  style={{ minHeight: '44px' }} title="Refresh">
            ↺
          </button>
        </div>

        {/* Stats strip */}
        <div style={{
          marginTop: '8px', fontFamily: 'var(--mono)', fontSize: '11px',
          color: fetching ? 'var(--text-dim)' : error ? 'var(--red)' : 'var(--text-dim)',
          overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
        }}>
          {fetching
            ? 'Loading…'
            : error
              ? `Error: ${error}`
              : pointsData
                ? `${pointsData.simplified_count} pts · ${windowHours}h window · ${fmtDate(pointsData.window_start)} → ${fmtDate(pointsData.window_end)}`
                : '—'
          }
        </div>
      </div>

      {/* Map — fills remaining viewport height; dvh avoids iOS Safari address-bar crop */}
      <div style={{ position: 'relative', height: 'calc(100dvh - 210px)', minHeight: '300px' }}>
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </>
  )
}
