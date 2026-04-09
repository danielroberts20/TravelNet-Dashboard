/**
 * Generic modal overlay.
 * @param {boolean}  open
 * @param {function} onClose
 * @param {string}   title
 * @param {node}     children
 * @param {string}   [width]  - CSS width, default 480px
 */
export function Modal({ open, onClose, title, children, width = '480px' }) {
  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border2)',
        borderRadius: '8px', padding: '24px', width, maxWidth: '90vw',
        maxHeight: '80vh', overflowY: 'auto',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '16px',
        }}>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: '14px',
            fontWeight: 600, color: 'var(--text-hi)',
          }}>{title}</div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: 'var(--text-dim)',
              fontSize: '18px', cursor: 'pointer', lineHeight: 1,
            }}
          >✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
