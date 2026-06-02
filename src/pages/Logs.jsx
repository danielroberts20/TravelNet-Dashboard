import { useState, useEffect, useRef, useCallback } from 'react'
import { apiJson } from '../api'

const LEVEL_RANK = { debug: 10, info: 20, important: 25, warn: 30, err: 40, critical: 50 }
const LEVEL_COLORS = {
  important: '#38bdf8',
  err:       '#e05252',
  warn:      '#f0b83d',
  debug:     '#00b8b8',
  info:      '#34c47c',
  critical:  '#b05ed4',
  prefect:   '#f97316',
}

const LEVEL_BTNS = [
  { label: 'All',        rank: 0 },
  { label: 'INFO+',      rank: 20 },
  { label: 'IMPORTANT+', rank: 25 },
  { label: 'WARNING+',   rank: 30 },
  { label: 'ERROR+',     rank: 40 },
]

function levelForLine(line) {
  const clean = line.replace(/\x1b\[[0-9;]*m/g, '')
  const parts = clean.split('|').map(s => s.trim())
  if (parts.length >= 2) {
    const level = parts[1].trim().toUpperCase()
    if (['ERROR', 'CRITICAL'].includes(level)) return 'err'
    if (level === 'WARNING')                    return 'warn'
    if (level === 'IMPORTANT')                  return 'important'
    if (level === 'DEBUG')                      return 'debug'
    if (level === 'INFO')                       return 'info'
  }
  const l = clean.toLowerCase()
  if (l.includes('traceback') || l.includes('exception')) return 'err'
  return 'info'
}

function MessageWithPrefect({ text }) {
  const match = text.match(/^(.*?)(\[PREFECT\])(.*)$/)
  if (!match) return <>{text}</>
  return <>{match[1]}<span style={{ color: LEVEL_COLORS.prefect }}>{match[2]}</span>{match[3]}</>
}

function LogLine({ text, level }) {
  const parts = text.split('|')
  if (parts.length >= 2) {
    const message = parts.slice(2).join(' |')
    return (
      <span className="log-line">
        {parts[0]}{'| '}
        <span style={{ color: LEVEL_COLORS[level] ?? '#a8b8d0' }}>{parts[1].trim()}</span>
        {' |'}<MessageWithPrefect text={message} />
      </span>
    )
  }
  return (
    <span className="log-line" style={{ color: level === 'err' ? LEVEL_COLORS.err : undefined }}>
      {text}
    </span>
  )
}

const WATCHDOG = 'watchdog'

export default function Logs() {
  const [config, setConfig]           = useState(null)
  const [configError, setConfigError] = useState(null)
  const [activeContainer, setActive]  = useState(null)
  const [lines, setLines]             = useState([])   // [{ text, level }]
  const [status, setStatus]           = useState('disconnected') // connected | disconnected | error
  const [connected, setConnected]     = useState(false)
  const [minRank, setMinRank]         = useState(20)
  const [autoScroll, setAutoScroll]   = useState(true)
  const [linesCount, setLinesCount]   = useState(200)
  const [watchdogError, setWatchdogError]       = useState(null)
  const [watchdogLastFetch, setWatchdogLastFetch] = useState(null)

  const esRef           = useRef(null)
  const pollRef         = useRef(null)
  const outputRef       = useRef(null)
  const activeRef       = useRef(null)
  const linesCountRef   = useRef(linesCount)

  useEffect(() => { linesCountRef.current = linesCount }, [linesCount])
  useEffect(() => { activeRef.current = activeContainer }, [activeContainer])

  useEffect(() => {
    apiJson('/api/logs/config').then(d => {
      setConfig(d)
      setActive(d.container)
    }).catch(() => setConfigError('Failed to load log config'))
  }, [])

  // Auto-scroll whenever lines change
  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [lines, autoScroll])

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const disconnect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    setConnected(false)
    setStatus('disconnected')
  }, [])

  const fetchWatchdog = useCallback(async () => {
    try {
      const data = await apiJson(`/api/watchdog/logs?lines=${linesCountRef.current}`)
      if (activeRef.current !== WATCHDOG) return
      if (data.error) {
        setWatchdogError(data.error)
        setLines([])
      } else {
        setWatchdogError(null)
        setLines((data.lines ?? []).map(text => ({ text, level: levelForLine(text) })))
        const now = new Date()
        setWatchdogLastFetch(
          now.toTimeString().slice(0, 8)
        )
      }
    } catch {
      if (activeRef.current !== WATCHDOG) return
      setWatchdogError('Watchdog unavailable')
      setLines([])
    }
  }, [])

  const startWatchdogPoll = useCallback(() => {
    disconnect()
    setLines([])
    setWatchdogError(null)
    setWatchdogLastFetch(null)
    fetchWatchdog()
    pollRef.current = setInterval(fetchWatchdog, 5000)
  }, [disconnect, fetchWatchdog])

  const connect = useCallback(() => {
    stopPoll()
    disconnect()
    setLines([])
    setStatus('connected')
    setConnected(true)

    const url = `/logs/stream?lines=${linesCount}&container=${encodeURIComponent(activeContainer)}`
    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => { setStatus('connected'); setConnected(true) }

    es.onmessage = (e) => {
      const level = levelForLine(e.data)
      setLines(prev => [...prev, { text: e.data, level }])
    }

    es.onerror = () => {
      setStatus('error')
      setConnected(false)
      es.close()
      esRef.current = null
    }
  }, [activeContainer, linesCount, disconnect, stopPoll])

  function switchContainer(name) {
    setLines([])
    if (name === WATCHDOG) {
      setActive(WATCHDOG)
    } else {
      stopPoll()
      setActive(name)
    }
  }

  // When activeContainer changes: connect SSE or start watchdog poll
  useEffect(() => {
    if (!activeContainer) return
    if (activeContainer === WATCHDOG) {
      startWatchdogPoll()
    } else {
      connect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeContainer])

  useEffect(() => {
    return () => {
      disconnect()
      stopPoll()
    }
  }, [disconnect, stopPoll])

  const isWatchdog = activeContainer === WATCHDOG
  const visibleLines = isWatchdog
    ? lines
    : lines.filter(l => (LEVEL_RANK[l.level] ?? 20) >= minRank)

  return (
    <>
      <div className="page-header">
        <h1>Logs</h1>
        <p>
          {isWatchdog
            ? 'Polling Watchdog Pi every 5 seconds'
            : <>Live stream from{' '}
                <code style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>
                  docker logs --follow {activeContainer ?? '…'}
                </code>
              </>
          }
        </p>
      </div>

      {configError && (
        <div style={{ fontFamily:'var(--mono)', fontSize:'12px', color:'var(--red)', marginBottom:'12px' }}>
          {configError}
        </div>
      )}

      <div className="log-toolbar">
        {/* Service toggle */}
        <div className="service-toggle">
          <button
            className={'svc-btn' + (activeContainer === config?.container ? ' active' : '')}
            onClick={() => switchContainer(config?.container)}
          >TravelNet</button>
          <button
            className={'svc-btn' + (activeContainer === config?.trevor_container ? ' active' : '')}
            onClick={() => switchContainer(config?.trevor_container)}
          >Trevor</button>
          <button
            className={'svc-btn' + (activeContainer === WATCHDOG ? ' active' : '')}
            onClick={() => switchContainer(WATCHDOG)}
          >Watchdog</button>
        </div>

        {/* Lines input */}
        <label style={{ margin: 0 }}>Lines:</label>
        <input
          type="number"
          value={linesCount}
          min={10} max={2000} step={50}
          onChange={e => setLinesCount(parseInt(e.target.value) || 200)}
          style={{ width: 'auto', minWidth: '80px' }}
        />

        {/* Level filter — hidden for Watchdog */}
        {!isWatchdog && (
          <div className="level-filter">
            {LEVEL_BTNS.map(({ label, rank }) => (
              <button
                key={rank}
                className={'level-btn' + (minRank === rank ? ' active' : '')}
                onClick={() => setMinRank(rank)}
              >{label}</button>
            ))}
          </div>
        )}

        {/* Status + controls */}
        <div className="log-controls">
          {isWatchdog ? (
            <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-dim)' }}>
              {watchdogLastFetch ? `Last fetched: ${watchdogLastFetch}` : 'Fetching…'}
            </span>
          ) : (
            <>
              <span>
                <span className={'status-dot ' + status} />
                <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-dim)' }}>
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </span>
              </span>
              <button className="btn btn-primary" onClick={connect}>
                {connected ? 'Reconnect' : 'Connect'}
              </button>
            </>
          )}
          <button className="btn btn-ghost" onClick={() => setLines([])}>Clear</button>
          <button
            className="btn btn-ghost"
            style={{ color: autoScroll ? undefined : 'var(--yellow)' }}
            onClick={() => {
              const next = !autoScroll
              setAutoScroll(next)
              if (next && outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
            }}
          >{autoScroll ? '↓ Auto-scroll' : '⏸ Paused'}</button>
        </div>
      </div>

      <div className="log-output" ref={outputRef}>
        {isWatchdog && watchdogError
          ? <span style={{ color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: '12px' }}>
              {watchdogError}
            </span>
          : visibleLines.length === 0
            ? <span style={{ color: 'var(--text-dim)' }}>
                {isWatchdog
                  ? '(waiting for Watchdog logs…)'
                  : connected ? '(waiting for log lines…)' : '(Press Connect to stream logs)'}
              </span>
            : visibleLines.map((l, i) => (
                <div key={i} data-level={l.level}>
                  <LogLine text={l.text} level={l.level} />
                </div>
              ))
        }
      </div>
    </>
  )
}
