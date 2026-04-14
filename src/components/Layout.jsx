import { useState, useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useSidebarStats } from '../hooks/useSidebarStats'
import { useToast } from './Toast'
import { apiFetch } from '../api'

const NAV_LINKS = [
  { to: '/',        icon: '◈', label: 'Overview',  end: true },
  { to: '/db',      icon: '⊞', label: 'Database' },
  { to: '/crons',   icon: '◷', label: 'Schedule' },
  { to: '/logs',    icon: '≡', label: 'Logs' },
  { to: '/backups', icon: '⊙', label: 'Backups' },
  { to: '/location',icon: '◎', label: 'Location' },
  { to: '/upload',  icon: '↑', label: 'Upload' },
  { to: '/config',  icon: '⚙', label: 'Config' },
  { to: '/trevor',  icon: '◉', label: 'Trevor' },
]

export function Layout() {
  const [navOpen, setNavOpen] = useState(false)
  const [time, setTime]       = useState('')
  const stats                 = useSidebarStats()
  const { Toast, showToast }  = useToast()

  // UTC clock — update every 30s
  useEffect(() => {
    function tick() {
      const now = new Date()
      setTime(now.toUTCString().slice(17, 22) + ' UTC')
    }
    tick()
    const id = setInterval(tick, 30000)
    return () => clearInterval(id)
  }, [])

  function closeNav() {
    setNavOpen(false)
  }

  async function restartContainer(name) {
    showToast(`Restarting ${name}…`, 'var(--yellow)')
    try {
      const resp = await apiFetch('/api/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ container: name }),
      })
      const d = await resp.json()
      if (!resp.ok) throw new Error(d.error)
      showToast(`✓ ${name} restarting…`, 'var(--green)')
      if (name === 'travelnet-dashboard') {
        showToast('✓ Dashboard restarting — reconnecting…', 'var(--green)')
        setTimeout(() => window.location.reload(), 4000)
      }
    } catch (e) {
      showToast(`✗ ${e.message}`, 'var(--red)')
    }
  }

  async function handleLogout() {
    await fetch('/logout', { credentials: 'include' })
    window.location.href = '/login'
  }

  return (
    <>
      {/* Mobile overlay */}
      {navOpen && (
        <div className="nav-overlay open" onClick={closeNav} />
      )}

      {/* Mobile hamburger */}
      {!navOpen && (
        <button className="hamburger" onClick={() => setNavOpen(true)}>☰</button>
      )}

      {/* Sidebar nav */}
      <nav className={navOpen ? 'open' : ''}>
        <div className="nav-logo">
          <div className="wordmark">TravelNet</div>
          <div className="sub">Admin Dashboard</div>
        </div>

        <ul className="nav-links">
          {NAV_LINKS.map(({ to, icon, label, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) => isActive ? 'active' : ''}
                onClick={closeNav}
              >
                <span className="icon">{icon}</span> {label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="nav-footer">
          <button
            onClick={handleLogout}
            style={{ background: 'none', border: 'none', padding: 0,
                     cursor: 'pointer', color: 'var(--text-dim)',
                     fontSize: '11px', fontFamily: 'var(--sans)' }}
          >
            logout
          </button>
          &nbsp;·&nbsp; {time}

          {/* Mobile-only restart buttons */}
          <div className="mobile-restart" style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <button className="btn btn-ghost" onClick={() => restartContainer('travelnet')}
                    style={{ fontSize: '11px', width: '100%', justifyContent: 'center' }}>
              ↺ Restart Server
            </button>
            <button className="btn btn-ghost" onClick={() => restartContainer('travelnet-dashboard')}
                    style={{ fontSize: '11px', width: '100%', justifyContent: 'center' }}>
              ↺ Restart Dashboard
            </button>
          </div>
        </div>
      </nav>

      {/* Main content — React Router fills this via <Outlet /> */}
      <main>
        <Outlet />
      </main>

      {/* Right sidebar */}
      <aside className="right-sidebar">
        <div>
          <div className="rs-section-title">Quick Stats</div>
          <div className="rs-stat">
            <div className="rs-stat-label">Pi Uptime</div>
            <div className="rs-stat-value">{stats?.piUptime ?? '—'}</div>
          </div>
          <div className="rs-stat">
            <div className="rs-stat-label">App Uptime</div>
            <div className="rs-stat-value">{stats?.appUptime ?? '—'}</div>
          </div>
          <div className="rs-stat">
            <div className="rs-stat-label">DB Size</div>
            <div className="rs-stat-value">{stats?.dbSize ?? '—'}</div>
          </div>
          <div className="rs-stat">
            <div className="rs-stat-label">Pending Digest</div>
            <div className="rs-stat-value" style={{
              color: stats?.pending > 0 ? 'var(--yellow)' : (stats ? 'var(--green)' : undefined),
            }}>
              {stats?.pending ?? '—'}
            </div>
          </div>
          <div className="rs-stat">
            <div className="rs-stat-label">Last Location</div>
            <div className="rs-stat-value">{stats?.lastLocation ?? '—'}</div>
          </div>
        </div>

        <hr className="rs-divider" />

        <div>
          <div className="rs-section-title">Restart</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <button className="btn btn-ghost" onClick={() => restartContainer('travelnet')}
                    style={{ fontSize: '11px', width: '100%', justifyContent: 'center' }}>
              ↺ Server
            </button>
            <button className="btn btn-ghost" onClick={() => restartContainer('travelnet-dashboard')}
                    style={{ fontSize: '11px', width: '100%', justifyContent: 'center' }}>
              ↺ Dashboard
            </button>
          </div>
        </div>
      </aside>

      <Toast />
    </>
  )
}
