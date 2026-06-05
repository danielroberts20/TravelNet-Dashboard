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

// Domain groupings for the Database page and Overview DB summary.
// Any table not listed here falls into an "Other" group at render time.
export const DOMAIN_GROUPS = [
  { label: 'Daily Summary', tables: ['daily_summary'] },
  { label: 'Location',      tables: ['places', 'location_overland', 'location_shortcuts', 'location_unified', 'known_places', 'place_visits', 'cellular_state', 'country_transitions'] },
  { label: 'Health',        tables: ['health_quantity', 'health_heart_rate', 'health_sleep', 'workouts', 'workout_route', 'state_of_mind'] },
  { label: 'Finance',       tables: ['transactions', 'fx_rates', 'cost_of_living'] },
  { label: 'Weather',       tables: ['weather_hourly', 'weather_daily'] },
  { label: 'ML',            tables: ['ml_location_clusters', 'ml_location_segments', 'ml_day_embeddings', 'ml_anomalies', 'ml_causal_graph'] },
  { label: 'System',        tables: ['api_usage', 'compute', 'trigger_log', 'log_digest', 'cron_results', 'flights'] },
]

const _KNOWN_TABLES = new Set(DOMAIN_GROUPS.flatMap(g => g.tables))

// Maps a flat array of table objects (each with at least .name) into domain groups.
// Tables not in any group are collected into an "Other" group appended at the end.
export function groupTablesByDomain(tables) {
  const byName = Object.fromEntries(tables.map(t => [t.name, t]))
  const groups = DOMAIN_GROUPS.map(g => ({
    label: g.label,
    rows: g.tables.map(n => byName[n]).filter(Boolean),
  }))
  const other = tables.filter(t => !_KNOWN_TABLES.has(t.name))
  if (other.length) groups.push({ label: 'Other', rows: other })
  return groups.filter(g => g.rows.length > 0)
}

// Returns the default expanded state for domain groups.
// Daily Summary starts expanded; everything else starts collapsed.
export function defaultGroupExpanded() {
  const init = {}
  DOMAIN_GROUPS.forEach(g => { init[g.label] = true })
  init['Other'] = false
  return init
}
