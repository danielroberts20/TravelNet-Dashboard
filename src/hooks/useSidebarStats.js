import { useState, useEffect } from 'react'
import { apiJson } from '../api'

function timeSince(ts) {
  if (!ts) return '—'
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts)
  const mins = Math.floor((Date.now() - d) / 60000)
  if (isNaN(mins)) return '—'
  if (mins < 60)   return mins + 'm ago'
  if (mins < 1440) return Math.floor(mins / 60) + 'h ago'
  return Math.floor(mins / 1440) + 'd ago'
}

export function useSidebarStats() {
  const [stats, setStats] = useState(null)

  async function load() {
    try {
      const d = await apiJson('/api/status')
      if (d.error) return
      const loc = d.last_upload?.location_overland || d.last_upload?.location_shortcuts
      setStats({
        piUptime:     d.uptime?.pi  || '—',
        appUptime:    d.uptime?.app || '—',
        dbSize:       d.db?.size_mb ? d.db.size_mb + ' MB' : '—',
        pending:      d.pending_digest_records ?? '—',
        lastLocation: timeSince(loc),
      })
    } catch (_) {}
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 60000)
    return () => clearInterval(id)
  }, [])

  return stats
}
