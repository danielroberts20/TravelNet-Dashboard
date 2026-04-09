import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function Login() {
  const [token, setToken]   = useState('')
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const navigate              = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const resp = await fetch('/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (resp.ok) {
        navigate('/')
      } else {
        const d = await resp.json()
        setError(d.error || 'Invalid token')
      }
    } catch (e) {
      setError('Network error: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      background: 'var(--bg)', minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: '340px', background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: '8px', padding: '36px 32px',
      }}>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: '18px',
          fontWeight: 600, color: 'var(--text-hi)', marginBottom: '4px',
        }}>TravelNet</div>
        <div style={{
          fontSize: '12px', letterSpacing: '.1em', textTransform: 'uppercase',
          color: 'var(--text-dim)', marginBottom: '28px',
        }}>Admin Dashboard</div>

        {error && (
          <div style={{
            background: 'var(--red-lo)', border: '1px solid var(--red)',
            color: 'var(--red)', borderRadius: '5px', padding: '9px 12px',
            fontSize: '12px', fontFamily: 'var(--mono)', marginBottom: '16px',
          }}>{error}</div>
        )}

        <form onSubmit={handleSubmit}>
          <label htmlFor="token-input" style={{
            fontSize: '11px', color: 'var(--text-dim)', display: 'block',
            marginBottom: '6px', letterSpacing: '.06em', textTransform: 'uppercase',
          }}>Token</label>
          <input
            id="token-input"
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            autoComplete="off"
            style={{ marginBottom: '16px' }}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', background: 'var(--accent)', color: '#fff',
              border: 'none', borderRadius: '6px', padding: '10px',
              fontFamily: 'var(--mono)', fontSize: '13px', fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '.04em',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Checking…' : 'Enter'}
          </button>
        </form>

        <p style={{
          fontSize: '11px', color: 'var(--text-dim)',
          textAlign: 'center', marginTop: '16px',
        }}>Tailscale-only access</p>
      </div>
    </div>
  )
}
