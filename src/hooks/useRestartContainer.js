import { useToast } from '../components/Toast'
import { apiFetch } from '../api'

export function useRestartContainer() {
  const { Toast, showToast } = useToast()

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

  return { restartContainer, Toast }
}
