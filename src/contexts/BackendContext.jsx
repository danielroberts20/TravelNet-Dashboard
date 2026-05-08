import { createContext, useContext, useState, useEffect } from 'react'

const Ctx = createContext(null)

export function BackendProvider({ children }) {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    function onOffline() { setOffline(true) }
    window.addEventListener('backend:offline', onOffline)
    return () => window.removeEventListener('backend:offline', onOffline)
  }, [])

  return (
    <Ctx.Provider value={{ offline, retry: () => setOffline(false) }}>
      {children}
    </Ctx.Provider>
  )
}

export function useBackend() { return useContext(Ctx) }
