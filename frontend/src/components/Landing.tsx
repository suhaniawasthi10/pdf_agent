import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { getPdfStatus, uploadPdf, type PdfStatus } from '../api'
import Mark from './Mark'

type Props = {
  onReady: (status: PdfStatus) => void
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'uploading'; filename: string }
  | { kind: 'processing'; pdfId: string; filename: string }
  | { kind: 'failed'; error: string }

const POLL_MS = 1500
const MAX_BYTES = 50 * 1024 * 1024

const TRANSITION = { duration: 0.24, ease: 'easeOut' as const }
const ENTER = { opacity: 0, y: 6 }
const VISIBLE = { opacity: 1, y: 0 }
const EXIT = { opacity: 0, y: -6 }

const PROGRESS_FRAMES = ['░░░░░░░░░░░░', '████░░░░░░░░', '████████░░░░']
const PROCESSING_STAGES = [
  'extracting text',
  'chunking pages',
  'generating embeddings',
  'indexing',
] as const

const QUERIES = [
  'Summarise this document.',
  'What technologies are mentioned?',
  'क्या इस दस्तावेज़ में Python का उल्लेख है?',
  'Compare the listed projects.',
] as const

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[4px] border border-rule px-2 py-1 font-mono text-[11px] text-mid">
      {children}
    </span>
  )
}

function DividerLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
        {children}
      </span>
      <span aria-hidden className="h-px flex-1 bg-rule" />
    </div>
  )
}

function MonoProgress() {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    const t = window.setInterval(
      () => setIdx((i) => (i + 1) % PROGRESS_FRAMES.length),
      800,
    )
    return () => window.clearInterval(t)
  }, [])
  return (
    <span
      className="font-mono text-[14px] text-mid"
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {PROGRESS_FRAMES[idx]}
    </span>
  )
}

function CyclingStage({ stages }: { stages: readonly string[] }) {
  const [idx, setIdx] = useState(0)
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const t1 = window.setTimeout(() => setVisible(false), 1000)
    const t2 = window.setTimeout(() => {
      setIdx((i) => (i + 1) % stages.length)
      setVisible(true)
    }, 1200)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [idx, stages.length])
  return (
    <span
      className={`font-mono text-[13px] text-mute transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {stages[idx]}
    </span>
  )
}

function LandingHeader() {
  return (
    <header className="border-b border-rule-strong">
      <div className="mx-auto flex h-[52px] w-full max-w-[1200px] items-center justify-between px-12">
        <div className="flex items-center gap-3">
          <Mark size={16} className="text-ink" />
          <span className="text-[14px] font-semibold tracking-[-0.01em] text-ink">
            PDF Agent
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Pill>bge-m3</Pill>
          <Pill>chromadb</Pill>
          <Pill>llama-3.3-70b</Pill>
        </div>
      </div>
    </header>
  )
}

function Step({
  number,
  title,
  body,
}: {
  number: string
  title: string
  body: string
}) {
  return (
    <div>
      <div
        className="font-mono text-[11px] text-mute"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {number}
      </div>
      <div className="mt-1 text-[13px] font-medium text-ink">{title}</div>
      <p className="mt-1 max-w-[28ch] text-[13px] leading-[1.5] text-mid">
        {body}
      </p>
    </div>
  )
}

function Block({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-mute">
        {label}
      </div>
      <div className="mt-1 whitespace-pre-line text-[12px] leading-[1.5] text-ink">
        {body}
      </div>
    </div>
  )
}

function LandingIdle({
  phase,
  onPick,
}: {
  phase: Phase
  onPick: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const errorMsg = phase.kind === 'failed' ? phase.error : null

  return (
    <div className="flex flex-1 flex-col py-10">
      <section className="flex max-w-2xl flex-col gap-5">
          <div
            className="font-mono text-[11px] tracking-[0.06em] text-mute"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            PDF AGENT · v0.1.0
          </div>
          <h1
            className="text-[36px] font-medium leading-[1.15] text-ink"
            style={{ letterSpacing: '-0.02em' }}
          >
            Chat with any PDF.
            <br />
            Grounded answers, every time.
          </h1>
          <p className="max-w-prose text-[15px] leading-[1.6] text-mid">
            A retrieval-augmented agent that answers strictly from your
            document with page-level citations. Refuses when the answer isn't
            in the source.
          </p>
          <div className="mt-1 flex items-center gap-3">
            <label className="cursor-pointer rounded-[4px] bg-ink px-3 py-[6px] font-mono text-[11px] text-surface transition-colors hover:bg-[#262626] active:scale-[0.97]">
              Choose PDF
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onPick(f)
                  if (inputRef.current) inputRef.current.value = ''
                }}
              />
            </label>
            <span className="text-[12px] text-mute">or drop anywhere</span>
          </div>
          {errorMsg && (
            <div className="font-mono text-[12px] text-[color:var(--color-danger)]">
              {errorMsg}
            </div>
          )}
      </section>

      <div aria-hidden className="min-h-12 flex-1" />

      <section className="grid grid-cols-3 gap-12">
        <div className="flex flex-col gap-4">
          <DividerLabel>HOW IT WORKS</DividerLabel>
          <div className="flex flex-col gap-5 pt-1">
            <Step
              number="01"
              title="Upload"
              body="Pick or drop a PDF from your machine. Up to 50MB."
            />
            <Step
              number="02"
              title="Index"
              body="PyMuPDF extracts text per page. Chunks are embedded with bge-m3 and stored in ChromaDB."
            />
            <Step
              number="03"
              title="Ask"
              body="Questions retrieve top-6 chunks. Llama 3.3 answers with [p3]-style citations or refuses if absent."
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <DividerLabel>EXAMPLE QUERIES</DividerLabel>
          <ul className="pt-1">
            {QUERIES.map((q, i) => (
              <li
                key={q}
                className={i < QUERIES.length - 1 ? 'border-b border-rule' : ''}
              >
                <button
                  type="button"
                  disabled
                  className="flex w-full cursor-not-allowed items-center gap-3 py-[14px] text-left text-[13px] text-mute opacity-50"
                  title="Available after upload"
                >
                  <span className="font-mono">→</span>
                  <span>{q}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="font-mono text-[11px] text-mute">
            // click after upload to send
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <DividerLabel>REQUIREMENTS</DividerLabel>
          <div className="flex flex-col gap-4 pt-1">
            <Block label="INPUT" body="PDF · ≤ 50MB · text-extractable" />
            <Block label="OUTPUT" body="Cited answer · or refusal" />
            <Block
              label="SCOPE"
              body={'Single document · single session\nNo persistence · no auth'}
            />
            <Block
              label="GROUNDING"
              body="Strict — outside knowledge refused"
            />
          </div>
        </div>
      </section>
    </div>
  )
}

function LandingProcessing({ phase }: { phase: Phase }) {
  if (phase.kind !== 'uploading' && phase.kind !== 'processing') return null
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <MonoProgress />
      <div className="text-[24px] font-medium leading-tight text-ink">
        {phase.kind === 'uploading' ? 'Uploading' : 'Processing'}
      </div>
      {phase.kind === 'processing' ? (
        <CyclingStage stages={PROCESSING_STAGES} />
      ) : (
        <span className="font-mono text-[13px] text-mute">
          transferring file
        </span>
      )}
      <div className="font-mono text-[12px] text-mute">{phase.filename}</div>
    </div>
  )
}

function DropOverlay() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.12 } }}
      exit={{ opacity: 0, transition: { duration: 0.08 } }}
      className="pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center"
    >
      <div className="text-[24px] font-medium text-ink">Drop to upload</div>
      <div className="mt-2 font-mono text-[13px] text-mute">
        PDF only · ≤ 50MB
      </div>
    </motion.div>
  )
}

function Landing({ onReady }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [dragOver, setDragOver] = useState(false)
  const dragCounterRef = useRef(0)

  useEffect(() => {
    if (phase.kind !== 'processing') return
    let cancelled = false
    const tick = async () => {
      try {
        const status = await getPdfStatus(phase.pdfId)
        if (cancelled) return
        if (status.status === 'ready') {
          onReady(status)
        } else if (status.status === 'failed') {
          setPhase({
            kind: 'failed',
            error: status.error ?? 'ingestion failed',
          })
        } else {
          timer = window.setTimeout(tick, POLL_MS)
        }
      } catch (e) {
        if (cancelled) return
        setPhase({
          kind: 'failed',
          error: e instanceof Error ? e.message : 'status check failed',
        })
      }
    }
    let timer = window.setTimeout(tick, POLL_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [phase, onReady])

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setPhase({ kind: 'failed', error: 'only PDF files are accepted' })
      return
    }
    if (file.size > MAX_BYTES) {
      setPhase({ kind: 'failed', error: 'file too large (≤ 50MB)' })
      return
    }
    setPhase({ kind: 'uploading', filename: file.name })
    try {
      const res = await uploadPdf(file)
      setPhase({
        kind: 'processing',
        pdfId: res.pdf_id,
        filename: res.filename ?? file.name,
      })
    } catch (e) {
      setPhase({
        kind: 'failed',
        error: e instanceof Error ? e.message : 'upload failed',
      })
    }
  }

  useEffect(() => {
    const acceptable = phase.kind === 'idle' || phase.kind === 'failed'
    const hasFiles = (e: DragEvent) =>
      e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes('Files')

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragCounterRef.current += 1
      if (acceptable && dragCounterRef.current === 1) setDragOver(true)
    }
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
    }
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
      if (dragCounterRef.current === 0) setDragOver(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragCounterRef.current = 0
      setDragOver(false)
      if (!acceptable) return
      const file = e.dataTransfer?.files?.[0]
      if (file) void handleFile(file)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [phase])

  const showIdle = phase.kind === 'idle' || phase.kind === 'failed'

  return (
    <>
      <div
        className="flex h-full flex-col bg-canvas"
        style={{
          opacity: dragOver ? 0.3 : 1,
          transition: dragOver
            ? 'opacity 120ms ease-out'
            : 'opacity 80ms ease-out',
        }}
      >
        <LandingHeader />
        <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col px-12">
          <AnimatePresence mode="wait">
            {showIdle ? (
              <motion.div
                key="idle"
                initial={ENTER}
                animate={VISIBLE}
                exit={EXIT}
                transition={TRANSITION}
                className="flex flex-1 flex-col"
              >
                <LandingIdle phase={phase} onPick={handleFile} />
              </motion.div>
            ) : (
              <motion.div
                key="processing"
                initial={ENTER}
                animate={VISIBLE}
                exit={EXIT}
                transition={TRANSITION}
                className="flex flex-1 flex-col"
              >
                <LandingProcessing phase={phase} />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
      <AnimatePresence>{dragOver && <DropOverlay />}</AnimatePresence>
    </>
  )
}

export default Landing
