/**
 * @param {'green'|'red'|'yellow'|'blue'|'dim'} variant
 */
export function Badge({ variant = 'dim', children }) {
  return <span className={`badge badge-${variant}`}>{children}</span>
}
