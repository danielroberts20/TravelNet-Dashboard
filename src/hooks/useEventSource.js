import { useState, useEffect, useRef } from 'react'

/**
 * Opens an SSE connection to `url` and appends each message to a lines array.
 * Closes the connection when the component unmounts or url changes.
 *
 * @param {string|null} url  - SSE endpoint. Pass null to not connect.
 * @returns {{ lines: string[], connected: boolean, reset: function }}
 */
export function useEventSource(url) {
  const [lines, setLines] = useState([])
  const [connected, setConnected] = useState(false)
  const esRef = useRef(null)

  function reset() {
    setLines([])
  }

  useEffect(() => {
    if (!url) return

    setLines([])
    setConnected(false)

    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => setConnected(true)

    es.onmessage = (e) => {
      setLines(prev => [...prev, e.data])
    }

    es.onerror = () => {
      setConnected(false)
      es.close()
    }

    return () => {
      es.close()
      setConnected(false)
    }
  }, [url])

  return { lines, connected, reset }
}
