/**
 * @param {string}  label
 * @param {string}  value
 * @param {string}  [sub]
 * @param {number}  [pct]          - 0–100, renders a progress bar when provided
 * @param {string}  [valueStyle]   - extra inline style for the value element
 */
export function StatTile({ label, value, sub, pct, valueStyle }) {
  const barClass = pct > 85 ? 'danger' : pct > 70 ? 'warn' : ''

  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={valueStyle}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
      {pct !== undefined && (
        <div className="progress-wrap">
          <div className="progress-bar-bg">
            <div
              className={`progress-bar-fill${barClass ? ' ' + barClass : ''}`}
              style={{ width: Math.min(pct, 100) + '%' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
