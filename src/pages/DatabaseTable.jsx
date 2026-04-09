import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { apiJson, apiFetch } from '../api'
import { Badge } from '../components/Badge'
import { Modal } from '../components/Modal'

export default function DatabaseTable() {
  const { table }                       = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data,   setData]               = useState(null)
  const [loading, setLoading]           = useState(true)
  const [error,  setError]              = useState(null)
  const [schemaOpen,  setSchemaOpen]    = useState(false)
  const [resetOpen,   setResetOpen]     = useState(false)
  const [resetInput,  setResetInput]    = useState('')
  const [resetStatus, setResetStatus]   = useState(null)

  const page      = parseInt(searchParams.get('page')      || '1')
  const page_size = parseInt(searchParams.get('page_size') || '50')
  const order     = searchParams.get('order') || 'rowid'
  const dir       = searchParams.get('dir')   || 'desc'

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams({ page, page_size, order, dir })
    apiJson(`/api/db/table/${table}?${qs}`)
      .then(d => { if (d.error) throw new Error(d.error); setData(d) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [table, page, page_size, order, dir])

  useEffect(() => { load() }, [load])

  function setParam(key, val, resetPage = true) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set(key, val)
      if (resetPage) next.set('page', '1')
      return next
    })
  }

  function sortBy(col) {
    if (order === col) {
      setParam('dir', dir === 'asc' ? 'desc' : 'asc')
    } else {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev)
        next.set('order', col); next.set('dir', 'desc'); next.set('page', '1')
        return next
      })
    }
  }

  async function doReset() {
    if (resetInput !== table) return
    setResetStatus({ loading: true })
    try {
      const resp = await apiFetch(`/api/db/reset/${table}`, { method: 'POST' })
      const d    = await resp.json()
      if (resp.ok) {
        setResetStatus({ ok: true, msg: d.message })
        setResetOpen(false)
        load()
      } else {
        setResetStatus({ ok: false, msg: d.error })
      }
    } catch (e) {
      setResetStatus({ ok: false, msg: e.message })
    }
  }

  const cols       = data?.columns || []
  const rows       = data?.rows    || []
  const total      = data?.total   || 0
  const totalPages = data?.total_pages || 1

  // Pagination window
  const window_  = 3
  const winStart = Math.max(1, page - window_)
  const winEnd   = Math.min(totalPages, page + window_)
  const pageNums = Array.from({ length: winEnd - winStart + 1 }, (_, i) => winStart + i)

  return (
    <>
      <div className="page-header">
        <div style={{ fontSize:'12px', color:'var(--text-dim)', marginBottom:'6px' }}>
          <Link to="/db" style={{ color:'var(--text-dim)', textDecoration:'none' }}>Database</Link>
          <span style={{ margin:'0 6px' }}>›</span>
          <span style={{ color:'var(--text-hi)', fontFamily:'var(--mono)' }}>{table}</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'12px' }}>
          <div>
            <h1>{table}</h1>
            <p>{total} rows · {cols.length} columns</p>
          </div>
          <div style={{ display:'flex', gap:'8px' }}>
            <a href={`/db/table/${table}/download`} className="btn btn-ghost">↓ Download CSV</a>
            {data?.resettable && (
              <button className="btn btn-danger" onClick={() => { setResetInput(''); setResetStatus(null); setResetOpen(true) }}
                      style={{ fontSize:'11px' }}>
                ⚠ Reset table
              </button>
            )}
          </div>
        </div>
      </div>

      {error && <div style={{ color:'var(--red)', fontFamily:'var(--mono)', fontSize:'13px', marginBottom:'16px' }}>{error}</div>}

      {/* Schema panel */}
      <div className="schema-panel">
        <button className={`schema-toggle${schemaOpen ? ' open' : ''}`} onClick={() => setSchemaOpen(o => !o)}>
          <span className="arrow">▶</span>
          Schema — {cols.length} columns
        </button>
        {schemaOpen && (
          <div className="schema-body open">
            <table>
              <thead><tr><th>#</th><th>Name</th><th>Type</th><th>Not Null</th><th>Default</th><th>PK</th></tr></thead>
              <tbody>
                {cols.map(col => (
                  <tr key={col.cid}>
                    <td className="dim">{col.cid}</td>
                    <td style={{ color:'var(--text-hi)' }}>
                      {col.name}{col.pk && <> &nbsp;<Badge variant="blue">PK</Badge></>}
                    </td>
                    <td><Badge variant="dim">{col.type}</Badge></td>
                    <td>{col.notnull ? <Badge variant="green">NOT NULL</Badge> : <span className="dim">nullable</span>}</td>
                    <td className="dim">{col.default ?? '—'}</td>
                    <td>{col.pk ? <span style={{ color:'var(--accent)' }}>✓</span> : <span className="dim">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="browse-toolbar">
        <span style={{ fontSize:'12px', color:'var(--text-dim)', fontFamily:'var(--mono)' }}>Rows per page:</span>
        <select className="browse-select" value={page_size} onChange={e => setParam('page_size', e.target.value)}>
          {[25,50,100,250,500].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="toolbar-sep">·</span>
        <span style={{ fontSize:'12px', color:'var(--text-dim)', fontFamily:'var(--mono)' }}>Sort by:</span>
        <select className="browse-select" value={order} onChange={e => setParam('order', e.target.value)}>
          <option value="rowid">rowid</option>
          {cols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <select className="browse-select" value={dir} onChange={e => setParam('dir', e.target.value)}>
          <option value="desc">DESC</option>
          <option value="asc">ASC</option>
        </select>
        {loading && <span style={{ fontSize:'11px', color:'var(--text-dim)', fontFamily:'var(--mono)' }}>Loading…</span>}
      </div>

      {/* Data table */}
      {rows.length > 0 ? (
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                {cols.map(col => (
                  <th key={col.name}
                      className={`sortable${order === col.name ? ' sort-active' : ''}`}
                      onClick={() => sortBy(col.name)}>
                    {col.name}
                    {order === col.name && <span className="sort-icon">{dir === 'desc' ? '↓' : '↑'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} title={cell !== null ? String(cell) : undefined}
                        className={cell === null ? 'null-cell' : ''}>
                      {cell === null ? 'NULL' : String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !loading ? (
        <div className="card">
          <p style={{ fontFamily:'var(--mono)', fontSize:'13px', color:'var(--text-dim)' }}>(no rows)</p>
        </div>
      ) : null}

      {/* Pagination */}
      {rows.length > 0 && (
        <div className="pagination">
          <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setParam('page', 1, false)}
                  style={{ padding:'5px 10px', fontSize:'12px' }}>«</button>
          <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setParam('page', page - 1, false)}
                  style={{ padding:'5px 10px', fontSize:'12px' }}>‹ Prev</button>

          {winStart > 1 && <span style={{ fontFamily:'var(--mono)', fontSize:'12px', padding:'5px 8px', color:'var(--text-dim)' }}>…</span>}
          {pageNums.map(p => (
            <button key={p} onClick={() => setParam('page', p, false)}
                    style={{
                      fontFamily:'var(--mono)', fontSize:'12px', padding:'5px 10px',
                      borderRadius:'4px', border:'1px solid var(--border2)',
                      background: p === page ? 'var(--accent)' : 'transparent',
                      color: p === page ? '#fff' : 'var(--text-dim)',
                      cursor:'pointer',
                    }}>{p}</button>
          ))}
          {winEnd < totalPages && <span style={{ fontFamily:'var(--mono)', fontSize:'12px', padding:'5px 8px', color:'var(--text-dim)' }}>…</span>}

          <button className="btn btn-ghost" disabled={page >= totalPages} onClick={() => setParam('page', page + 1, false)}
                  style={{ padding:'5px 10px', fontSize:'12px' }}>Next ›</button>
          <button className="btn btn-ghost" disabled={page >= totalPages} onClick={() => setParam('page', totalPages, false)}
                  style={{ padding:'5px 10px', fontSize:'12px' }}>»</button>
          <span className="pagination-info">
            {(page - 1) * page_size + 1}–{Math.min(page * page_size, total)} of {total}
          </span>
        </div>
      )}

      {/* Reset modal */}
      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="⚠ Reset table">
        <p style={{ fontSize:'13px', color:'var(--text-dim)', marginBottom:'16px', lineHeight:'1.5' }}>
          Permanently delete all rows from{' '}
          <strong style={{ color:'var(--text-hi)', fontFamily:'var(--mono)' }}>{table}</strong>.
          This cannot be undone.
        </p>
        <div style={{ fontSize:'12px', color:'var(--text-dim)', marginBottom:'6px' }}>Type the table name to confirm:</div>
        <input type="text" value={resetInput} onChange={e => setResetInput(e.target.value)}
               placeholder={table} autoComplete="off"
               style={{ marginBottom:'14px', borderColor: resetInput === table ? 'var(--red)' : undefined }} />
        {resetStatus?.msg && (
          <div style={{ color: resetStatus.ok ? 'var(--green)' : 'var(--red)',
                        fontFamily:'var(--mono)', fontSize:'12px', marginBottom:'12px' }}>
            {resetStatus.msg}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => setResetOpen(false)}>Cancel</button>
          <button className="btn btn-danger" disabled={resetInput !== table || resetStatus?.loading}
                  onClick={doReset}>
            {resetStatus?.loading ? 'Deleting…' : 'Delete all rows'}
          </button>
        </div>
      </Modal>
    </>
  )
}
