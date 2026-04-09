import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import { apiFetch } from '../api'

const DEFAULT_REASONING = 5

export default function Trevor() {
  const [history, setHistory]       = useState([])   // [{role, content}]
  const [input, setInput]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')       // generic error string
  const [warming, setWarming]       = useState(false)    // compute warming up
  const [status, setStatus]         = useState(null) // null | 'ok' | 'error'
  const [reasoning, setReasoning]   = useState(DEFAULT_REASONING)
  const messagesRef                 = useRef(null)
  const textareaRef                 = useRef(null)

  // Check Trevor health on mount
  useEffect(() => {
    apiFetch('/api/trevor/health')
      .then(r => r.json())
      .then(d => setStatus(d.status === 'ok' ? 'ok' : 'error'))
      .catch(() => setStatus('error'))
  }, [])

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [history, loading])

  async function send() {
    const msg = input.trim()
    if (!msg || loading) return

    setInput('')
    setError('')
    setWarming(false)
    setLoading(true)

    const prevHistory = history
    // Optimistically append the user message
    setHistory(prev => [...prev, { role: 'user', content: msg }])

    try {
      const resp = await apiFetch('/api/trevor/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history: prevHistory, reasoning_freedom: reasoning }),
      })
      const d = await resp.json()
      if (!resp.ok) {
        if (d.detail?.error === 'compute_warming_up') {
          setWarming(true)
        } else {
          setError(d.detail?.message || d.error || `HTTP ${resp.status}`)
        }
        setHistory(prevHistory)
        return
      }
      // Server returns updated history including the assistant's reply
      setHistory(d.history)
    } catch (e) {
      setError(e.message)
      // Roll back the optimistic user message
      setHistory(prevHistory)
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  function clearHistory() {
    setHistory([])
    setError('')
  }

  const isEmpty = history.length === 0 && !loading

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div>
              <h1>Trevor</h1>
              <p>Ask questions about your trip data.</p>
            </div>
            {status && (
              <span
                className={'status-dot ' + (status === 'ok' ? 'connected' : 'error')}
                title={status === 'ok' ? 'Trevor online' : 'Trevor unreachable'}
                style={{ marginTop: '2px' }}
              />
            )}
          </div>
          {history.length > 0 && (
            <button className="btn btn-ghost" onClick={clearHistory} style={{ fontSize: '11px' }}>
              ✕ Clear
            </button>
          )}
        </div>
      </div>

      {/* Message history */}
      <div className="trevor-messages" ref={messagesRef}>
        {isEmpty && (
          <div style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono)', fontSize: '13px', textAlign: 'center', paddingTop: '60px' }}>
            Ask Trevor anything about your trip.
          </div>
        )}

        {history.map((msg, i) => (
          <div key={i} className={'trevor-msg trevor-msg--' + msg.role}>
            <div className="trevor-msg-content">
              {msg.role === 'assistant'
                ? <ReactMarkdown>{msg.content}</ReactMarkdown>
                : msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="trevor-msg trevor-msg--assistant">
            <div className="trevor-thinking">Thinking…</div>
          </div>
        )}
      </div>

      {warming && (
        <div style={{
          fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--yellow)',
          background: 'var(--yellow-lo)', border: '1px solid var(--yellow)',
          borderRadius: 'var(--radius)', padding: '9px 12px', margin: '8px 0',
        }}>
          ◑ Compute warming up — a wake signal has been sent to the GPU. Try again in a moment.
        </div>
      )}
      {error && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--red)', margin: '8px 0' }}>
          ✗ {error}
        </div>
      )}

      {/* Controls */}
      <div style={{ marginTop: '8px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <label style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--mono)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          Reasoning freedom
          <input
            type="range"
            min={0} max={10} step={1}
            value={reasoning}
            onChange={e => setReasoning(Number(e.target.value))}
            style={{ width: '100px', accentColor: 'var(--accent)' }}
          />
          <span style={{ color: 'var(--text-hi)', minWidth: '16px' }}>{reasoning}</span>
        </label>
      </div>

      {/* Input row */}
      <div className="trevor-input-row">
        <textarea
          ref={textareaRef}
          className="trevor-textarea"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Trevor… (Enter to send, Shift+Enter for newline)"
          rows={1}
          disabled={loading}
        />
        <button
          className="btn btn-primary"
          onClick={send}
          disabled={loading || !input.trim()}
          style={{ flexShrink: 0 }}
        >
          {loading ? '…' : 'Send'}
        </button>
      </div>
    </>
  )
}
