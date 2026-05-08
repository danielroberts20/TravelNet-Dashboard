/**
 * Thin fetch wrapper.
 * - Always sends cookies (credentials: 'include')
 * - Redirects to /login on 401
 * - Dispatches 'backend:offline' custom event on network failure
 *
 * VITE_API_BASE_URL: set this in CF Pages (or .env.local) to point at the
 * external Flask backend, e.g. https://dashboard-api.example.com
 */

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export async function apiFetch(url, options = {}) {
  let resp
  try {
    resp = await fetch(API_BASE + url, { credentials: 'include', ...options })
  } catch {
    window.dispatchEvent(new CustomEvent('backend:offline'))
    throw new Error('Backend unreachable')
  }
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
