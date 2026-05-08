import { API_BASE } from '../api'

export function BackendOffline({ onRetry }) {
  const target = API_BASE || window.location.origin

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '60vh',
    }}>
      <div className="card" style={{ maxWidth: 440, width: '100%', textAlign: 'center' }}>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: 40, color: 'var(--text-dim)',
          marginBottom: 14, lineHeight: 1,
        }}>◌</div>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600,
          letterSpacing: '.12em', textTransform: 'uppercase',
          color: 'var(--text-dim)', marginBottom: 14,
        }}>Backend Unavailable</div>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8, lineHeight: 1.65 }}>
          The TravelNet API is not reachable. The backend may be offline or not yet deployed.
        </p>
        <p style={{
          fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--border2)',
          marginBottom: 22,
        }}>{target}</p>
        <button className="btn btn-ghost" onClick={onRetry} style={{ margin: '0 auto' }}>
          ↺ Retry
        </button>
      </div>
    </div>
  )
}
