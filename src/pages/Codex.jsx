import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { apiFetch } from '../api'

export default function Codex() {
  const [tree,          setTree]          = useState(null)
  const [activeSection, setActiveSection] = useState(null)
  const [selectedSlug,  setSelectedSlug]  = useState(null)
  const [content,       setContent]       = useState(null)
  const [loadingTree,   setLoadingTree]   = useState(true)
  const [loadingFile,   setLoadingFile]   = useState(false)
  const [treeError,     setTreeError]     = useState(null)
  const [fileError,     setFileError]     = useState(null)

  useEffect(() => {
    apiFetch('/api/codex/tree')
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setTree(d)
        if (d.sections.length > 0) setActiveSection(d.sections[0].name)
      })
      .catch(e => setTreeError(e.message))
      .finally(() => setLoadingTree(false))
  }, [])

  function selectTab(name) {
    setActiveSection(name)
    setSelectedSlug(null)
    setContent(null)
    setFileError(null)
  }

  function selectFile(slug) {
    const section = slug.split('/')[0]
    setActiveSection(section)
    setSelectedSlug(slug)
    setContent(null)
    setFileError(null)
    setLoadingFile(true)
    apiFetch(`/api/codex/file/${slug}`)
      .then(r => {
        if (r.status === 404) throw new Error('Document not found.')
        return r.json()
      })
      .then(d => {
        if (d.error) throw new Error(d.error)
        setContent(d.content)
      })
      .catch(e => setFileError(e.message))
      .finally(() => setLoadingFile(false))
  }

  function goBack() {
    setSelectedSlug(null)
    setContent(null)
    setFileError(null)
  }

  const linkComponents = {
    a({ href, children }) {
      if (!href) return <span>{children}</span>
      if (href.startsWith('http://') || href.startsWith('https://')) {
        return <a href={href} target="_blank" rel="noreferrer">{children}</a>
      }
      return (
        <span
          onClick={() => selectFile(href)}
          style={{ color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}
        >
          {children}
        </span>
      )
    },
  }

  const currentSection = tree?.sections.find(s => s.name === activeSection)

  return (
    <>
      <style>{`
        .codex-tabs::-webkit-scrollbar { display: none; }
        .codex-content table { display: block; overflow-x: auto; width: 100%; border-collapse: collapse; margin: 0 0 16px; font-size: 13px; }
        .codex-content table th { background: rgba(255,255,255,.04); color: var(--text-hi); font-weight: 600; text-align: left; padding: 8px 12px; border: 1px solid var(--border2); font-family: var(--mono); font-size: 12px; }
        .codex-content table td { padding: 7px 12px; border: 1px solid var(--border); color: var(--text); vertical-align: top; }
        .codex-content table tr:nth-child(even) td { background: rgba(255,255,255,.02); }
      `}</style>

      <div className="page-header">
        <h1>Codex</h1>
        <p>Recovery runbooks and reference documentation.</p>
      </div>

      {/* Loading / error / empty states */}
      {loadingTree && (
        <div style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono)', fontSize: '13px' }}>
          Loading…
        </div>
      )}
      {treeError && (
        <div style={{ color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: '13px' }}>
          ✗ {treeError}
        </div>
      )}
      {tree && tree.sections.length === 0 && (
        <div style={{
          color: 'var(--text-dim)', fontFamily: 'var(--mono)', fontSize: '13px',
          marginTop: '48px', textAlign: 'center',
        }}>
          No documents found. Add .md files to /home/dan/services/codex/ on the Pi.
        </div>
      )}

      {/* Tab bar */}
      {tree && tree.sections.length > 0 && (
        <div
          className="codex-tabs"
          style={{
            display: 'flex', gap: '3px', overflowX: 'auto',
            scrollbarWidth: 'none', marginBottom: '20px',
          }}
        >
          {tree.sections.map(s => (
            <button
              key={s.name}
              className={'svc-btn' + (activeSection === s.name ? ' active' : '')}
              onClick={() => selectTab(s.name)}
            >
              {s.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </button>
          ))}
        </div>
      )}

      {/* STATE A — file list */}
      {tree && !selectedSlug && currentSection && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
          {currentSection.files.length === 0 && (
            <div style={{
              padding: '16px', color: 'var(--text-dim)',
              fontFamily: 'var(--mono)', fontSize: '13px',
            }}>
              No files in this section.
            </div>
          )}
          {currentSection.files.map((file, i) => (
            <button
              key={file.slug}
              onClick={() => selectFile(file.slug)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', background: 'none', border: 'none',
                borderBottom: i < currentSection.files.length - 1 ? '1px solid var(--border)' : 'none',
                cursor: 'pointer', padding: '12px 16px',
                color: 'var(--text-hi)', fontFamily: 'var(--mono)', fontSize: '13px',
                textAlign: 'left',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <span>{file.title}</span>
              <span style={{ color: 'var(--text-dim)', fontSize: '16px', lineHeight: 1 }}>›</span>
            </button>
          ))}
        </div>
      )}

      {/* STATE B — file viewer */}
      {selectedSlug && (
        <>
          <div style={{ marginBottom: '20px' }}>
            <button className="btn btn-ghost" onClick={goBack} style={{ fontSize: '12px' }}>
              ← Back
            </button>
          </div>
          {loadingFile && (
            <div style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono)', fontSize: '13px' }}>
              Loading…
            </div>
          )}
          {fileError && !loadingFile && (
            <div style={{ color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: '13px' }}>
              {fileError}
            </div>
          )}
          {content != null && !loadingFile && (
            <div className="codex-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={linkComponents}>
                {content}
              </ReactMarkdown>
            </div>
          )}
        </>
      )}
    </>
  )
}
