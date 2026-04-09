import { useState, useCallback } from 'react'

/**
 * Returns a { Toast, showToast } pair.
 * Usage:
 *   const { Toast, showToast } = useToast()
 *   showToast('message', 'yellow'|'green'|'red')
 *   ...
 *   <Toast />
 */
export function useToast() {
  const [toast, setToast] = useState(null) // { msg, color }

  const showToast = useCallback((msg, color = 'var(--text-hi)') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 5000)
  }, [])

  function Toast() {
    if (!toast) return null
    return (
      <div style={{
        position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
        background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '6px',
        padding: '10px 16px', fontFamily: 'var(--mono)', fontSize: '12px',
        color: toast.color, zIndex: 300, boxShadow: '0 4px 16px rgba(0,0,0,.4)',
        whiteSpace: 'nowrap',
      }}>
        {toast.msg}
      </div>
    )
  }

  return { Toast, showToast }
}
