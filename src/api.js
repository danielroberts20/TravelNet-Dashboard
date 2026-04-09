/**
 * Thin fetch wrapper.
 * - Always sends cookies (credentials: 'include')
 * - Redirects to /login on 401
 */

export async function apiFetch(url, options = {}) {
  const resp = await fetch(url, { credentials: 'include', ...options })
  if (resp.status === 401) {
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }
  return resp
}

export async function apiJson(url, options = {}) {
  const resp = await apiFetch(url, options)
  return resp.json()
}
