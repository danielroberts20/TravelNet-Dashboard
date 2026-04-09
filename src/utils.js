/**
 * Format a timestamp as a human-readable "X ago" string.
 * Accepts a Unix timestamp (seconds), an ISO date string, or a Date-parseable string.
 * Returns '—' for falsy or unparseable input.
 */
export function timeSince(ts) {
  if (!ts) return '—'
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts)
  const mins = Math.floor((Date.now() - d) / 60000)
  if (isNaN(mins)) return '—'
  if (mins < 60)   return mins + 'm ago'
  if (mins < 1440) return Math.floor(mins / 60) + 'h ago'
  return Math.floor(mins / 1440) + 'd ago'
}
