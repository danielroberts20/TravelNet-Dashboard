import { useState, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { apiJson } from '../api'
import { timeSince } from '../utils'

const BLUE   = '#3d8ef0'
const ORANGE = '#f0913d'
const GREEN  = '#34c47c'

function formatTs(ts) {
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts)
  return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:false })
       + ' ' + d.toLocaleDateString([], { day:'2-digit', month:'short' })
}


function toEpoch(ts) {
  if (typeof ts === 'number') return ts
  return new Date(ts).getTime() / 1000
}

export default function Location() {
  const today = new Date().toISOString().split('T')[0]
  const [date,    setDate]    = useState(today)
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const mapRef                = useRef(null)

  async function load(d) {
    setLoading(true)
    setError(null)
    try {
      const url = d ? `/api/location-points?end_date=${d}` : '/api/location-points'
      const res = await apiJson(url)
      if (res.error) throw new Error(res.error)
      setData(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(date) }, [])

  function handleDateChange(e) {
    setDate(e.target.value)
    load(e.target.value)
  }

  function goToToday() {
    setDate(today)
    load(today)
  }

  const overland  = data?.overland  || []
  const shortcuts = data?.shortcuts || []
  const allPoints = [...overland, ...shortcuts]

  const latest = allPoints.length > 0
    ? allPoints.reduce((a, b) => toEpoch(a.ts) > toEpoch(b.ts) ? a : b)
    : null

  // Compute bounds for auto-fit
  const allCoords = allPoints.map(p => [p.lat, p.lon])
  const center    = allCoords.length > 0
    ? [allCoords.reduce((s, c) => s + c[0], 0) / allCoords.length,
       allCoords.reduce((s, c) => s + c[1], 0) / allCoords.length]
    : [51.5, -0.1]

  return (
    <>
      <div className="page-header">
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'12px' }}>
          <div>
            <h1>Location</h1>
            <p>48 hours ending at selected date — Overland (blue) and Shortcuts (orange)</p>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap' }}>
            <input type="date" value={date} onChange={handleDateChange}
                   style={{ background:'var(--surface)', border:'1px solid var(--border2)',
                            color:'var(--text-hi)', borderRadius:'5px', padding:'6px 10px',
                            fontFamily:'var(--mono)', fontSize:'12px', outline:'none', cursor:'pointer' }} />
            <button className="btn btn-ghost" onClick={goToToday}>Today</button>
            <button className="btn btn-ghost" onClick={() => load(date)}>↺ Refresh</button>
          </div>
        </div>
      </div>

      {/* Stats row */}
      {!loading && !error && data && (
        <div className="map-stats">
          <div className="map-stat">
            <span className="val">{overland.length}</span>
            <span className="lbl">Overland points</span>
          </div>
          <div className="map-stat">
            <span className="val">{shortcuts.length}</span>
            <span className="lbl">Shortcuts points</span>
          </div>
          {latest && (
            <>
              <div className="map-stat">
                <span className="val">{formatTs(latest.ts)}</span>
                <span className="lbl">Latest point</span>
              </div>
              <div className="map-stat">
                <span className="val">{timeSince(latest.ts)}</span>
                <span className="lbl">Since last point</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Map */}
      <div className="map-wrap">
        {(loading || error || allPoints.length === 0) && (
          <div className="loading-overlay">
            {loading ? 'Loading points…'
           : error   ? 'Error loading points: ' + error
           : 'No points found for this date range.'}
          </div>
        )}
        <MapContainer
          center={center} zoom={10}
          style={{ height:'520px', borderRadius:'6px', border:'1px solid var(--border)', background:'var(--bg)' }}
          ref={mapRef}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="© OpenStreetMap contributors"
            maxZoom={19}
          />

          {/* Overland polyline */}
          {overland.length > 1 && (
            <Polyline positions={overland.map(p => [p.lat, p.lon])}
                      color={BLUE} weight={2} opacity={0.5} />
          )}
          {overland.map((p, i) => {
            const isLast = i === overland.length - 1
            const tip = `Overland\n${formatTs(p.ts)}`
                      + (p.activity ? `\nActivity: ${p.activity}` : '')
                      + (p.speed    != null ? `\nSpeed: ${(p.speed * 3.6).toFixed(1)} km/h` : '')
                      + (p.battery  != null ? `\nBattery: ${Math.round(p.battery * 100)}%` : '')
            return (
              <CircleMarker key={p.ts ?? i} center={[p.lat, p.lon]}
                            radius={isLast ? 7 : 4}
                            color={isLast ? GREEN : BLUE}
                            fillColor={isLast ? GREEN : BLUE}
                            fillOpacity={0.75} weight={1}>
                <Tooltip direction="top" offset={[0,-4]}><span style={{ fontFamily:'monospace', fontSize:'12px', whiteSpace:'pre' }}>{tip}</span></Tooltip>
              </CircleMarker>
            )
          })}

          {/* Shortcuts polyline */}
          {shortcuts.length > 1 && (
            <Polyline positions={shortcuts.map(p => [p.lat, p.lon])}
                      color={ORANGE} weight={2} opacity={0.5} />
          )}
          {shortcuts.map((p, i) => {
            const isLast = i === shortcuts.length - 1
            const tip = `Shortcuts\n${formatTs(p.ts)}`
                      + (p.activity ? `\nActivity: ${p.activity}` : '')
                      + (p.battery  != null ? `\nBattery: ${p.battery}%` : '')
                      + (p.device   ? `\nDevice: ${p.device}` : '')
            return (
              <CircleMarker key={p.ts ?? i} center={[p.lat, p.lon]}
                            radius={isLast ? 7 : 4}
                            color={isLast ? GREEN : ORANGE}
                            fillColor={isLast ? GREEN : ORANGE}
                            fillOpacity={0.75} weight={1}>
                <Tooltip direction="top" offset={[0,-4]}><span style={{ fontFamily:'monospace', fontSize:'12px', whiteSpace:'pre' }}>{tip}</span></Tooltip>
              </CircleMarker>
            )
          })}
        </MapContainer>
      </div>

      {/* Legend */}
      <div className="map-legend">
        <div className="legend-item"><div className="legend-dot" style={{ background:BLUE }} /> Overland</div>
        <div className="legend-item"><div className="legend-dot" style={{ background:ORANGE }} /> Shortcuts</div>
        <div className="legend-item"><div className="legend-line" style={{ background:BLUE, opacity:.6 }} /> Overland path</div>
        <div className="legend-item"><div className="legend-line" style={{ background:ORANGE, opacity:.6 }} /> Shortcuts path</div>
        <div className="legend-item" style={{ marginLeft:'auto' }}>
          <div className="legend-dot" style={{ background:GREEN, border:'2px solid #fff' }} /> Most recent
        </div>
      </div>
    </>
  )
}
