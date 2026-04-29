import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { getPdfStatus, type Citation, type PdfStatus, type RetrievedChunk } from './api'
import ChatWindow from './components/ChatWindow'
import Header from './components/Header'
import Landing from './components/Landing'
import PdfPreview from './components/PdfPreview'

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
  retrieved?: RetrievedChunk[]
  route?: 'answered' | 'refused'
  streaming?: boolean
}

type StoredSession = {
  status: PdfStatus
  messages: ChatMessage[]
  currentPage: number
}

const STORAGE_KEY = 'pdf-agent:session'
const TRANSITION = { duration: 0.24, ease: 'easeOut' as const }
const ENTER = { opacity: 0, y: 6 }
const VISIBLE = { opacity: 1, y: 0 }
const EXIT = { opacity: 0, y: -6 }

function readStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StoredSession
  } catch {
    return null
  }
}

function clearStored() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

function App() {
  const [status, setStatus] = useState<PdfStatus | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [jumpToken, setJumpToken] = useState<number>(0)
  const [leftPct, setLeftPct] = useState<number>(50)
  const [dragging, setDragging] = useState<boolean>(false)
  const [hydrated, setHydrated] = useState<boolean>(false)
  const splitRef = useRef<HTMLDivElement | null>(null)

  const pdfId = status?.pdf_id ?? null

  const jumpToCitation = (page: number) => {
    setCurrentPage(page)
    setJumpToken((t) => t + 1)
  }

  const reset = () => {
    setStatus(null)
    setMessages([])
    setCurrentPage(1)
    setJumpToken(0)
    clearStored()
  }

  useEffect(() => {
    let cancelled = false
    const stored = readStored()
    if (!stored) {
      setHydrated(true)
      return
    }
    void getPdfStatus(stored.status.pdf_id)
      .then((live) => {
        if (cancelled) return
        if (live.status === 'ready') {
          setStatus({ ...stored.status, ...live })
          setMessages(
            stored.messages
              .filter((m) => !(m.streaming && m.content === ''))
              .map((m) => ({ ...m, streaming: false })),
          )
          setCurrentPage(stored.currentPage || 1)
        } else {
          clearStored()
        }
      })
      .catch(() => {
        if (cancelled) return
        clearStored()
      })
      .finally(() => {
        if (!cancelled) setHydrated(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    if (!status || status.status !== 'ready') return
    try {
      const payload: StoredSession = {
        status,
        messages: messages
          .filter((m) => !(m.streaming && m.content === ''))
          .map((m) => ({ ...m, streaming: false })),
        currentPage,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch {
      /* quota exceeded or unavailable — silently ignore */
    }
  }, [hydrated, status, messages, currentPage])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      const el = splitRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setLeftPct(Math.min(80, Math.max(20, pct)))
    }
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging])

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {pdfId === null ? (
            <motion.div
              key="empty"
              initial={ENTER}
              animate={VISIBLE}
              exit={EXIT}
              transition={TRANSITION}
              className="h-full"
            >
              <Landing onReady={setStatus} />
            </motion.div>
          ) : (
            <motion.div
              key="loaded"
              initial={ENTER}
              animate={VISIBLE}
              exit={EXIT}
              transition={TRANSITION}
              className="flex h-full flex-col"
            >
              <Header status={status} onReset={reset} />
              <div className="relative min-h-0 flex-1 overflow-hidden">
                <div
                  ref={splitRef}
                  className="flex h-full"
                  style={{ userSelect: dragging ? 'none' : 'auto' }}
                >
                  <section
                    style={{ width: `${leftPct}%` }}
                    className="flex min-w-0 flex-col"
                  >
                    <ChatWindow
                      pdfId={pdfId}
                      filename={status?.filename}
                      messages={messages}
                      setMessages={setMessages}
                      onJump={jumpToCitation}
                    />
                  </section>
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize panes"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setDragging(true)
                    }}
                    onDoubleClick={() => setLeftPct(50)}
                    className={`w-px shrink-0 cursor-col-resize transition-colors ${
                      dragging ? 'bg-ink' : 'bg-rule hover:bg-rule-strong'
                    }`}
                  />
                  <section
                    style={{ width: `${100 - leftPct}%` }}
                    className="flex min-w-0 flex-col"
                  >
                    <PdfPreview
                      pdfId={pdfId}
                      currentPage={currentPage}
                      jumpToken={jumpToken}
                      onPageChange={setCurrentPage}
                    />
                  </section>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

export default App
