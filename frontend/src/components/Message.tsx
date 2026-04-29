import { Fragment, useEffect, useState } from 'react'
import type { ChatMessage } from '../App'
import CitationChip from './CitationChip'

type Props = {
  message: ChatMessage
  onJump: (page: number) => void
}

// [p3] and [p3, p7] / [p3, 7] only — won't match prose like [plug] or [part].
const CITATION_RE = /\[p\d+(?:\s*,\s*p?\d+)*\]/gi
const NUM_RE = /\d+/g

const THINKING_STAGES = [
  'retrieving context',
  'reading sources',
  'composing response',
] as const

type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'cite'; pages: number[] }

function tokenize(text: string): Segment[] {
  const segments: Segment[] = []
  let lastIdx = 0
  for (const match of text.matchAll(CITATION_RE)) {
    const start = match.index ?? 0
    if (start > lastIdx) {
      segments.push({ kind: 'text', text: text.slice(lastIdx, start) })
    }
    const pages = Array.from(match[0].matchAll(NUM_RE), (m) => Number(m[0]))
    if (pages.length > 0) segments.push({ kind: 'cite', pages })
    lastIdx = start + match[0].length
  }
  if (lastIdx < text.length) {
    segments.push({ kind: 'text', text: text.slice(lastIdx) })
  }
  return segments
}

function uniquePages(message: ChatMessage): number[] {
  if (message.citations && message.citations.length > 0) {
    return Array.from(new Set(message.citations.map((c) => c.page))).sort(
      (a, b) => a - b,
    )
  }
  const pages = new Set<number>()
  for (const match of message.content.matchAll(CITATION_RE)) {
    for (const num of match[0].matchAll(NUM_RE)) pages.add(Number(num[0]))
  }
  return Array.from(pages).sort((a, b) => a - b)
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
      {children}
    </div>
  )
}

function ThinkingStages() {
  const [idx, setIdx] = useState(0)
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const showFor = 1000
    const fadeFor = 200
    const t1 = window.setTimeout(() => setVisible(false), showFor)
    const t2 = window.setTimeout(() => {
      setIdx((i) => (i + 1) % THINKING_STAGES.length)
      setVisible(true)
    }, showFor + fadeFor)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [idx])
  return (
    <div
      className={`mt-2 font-mono text-[12px] text-mute transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {THINKING_STAGES[idx]}
    </div>
  )
}

function BlinkingCursor() {
  return (
    <span
      aria-hidden
      className="inline-block h-[1em] w-[0.5em] translate-y-[2px] bg-ink align-baseline"
      style={{ animation: 'cursor-pulse 1s ease-in-out infinite' }}
    />
  )
}

function Message({ message, onJump }: Props) {
  const isUser = message.role === 'user'
  const segments = isUser ? null : tokenize(message.content)
  const sources = isUser ? [] : uniquePages(message)
  const [excerptsOpen, setExcerptsOpen] = useState(false)
  const retrieved = message.retrieved ?? []
  const snippetByPage = new Map<number, string>()
  for (const c of message.citations ?? []) {
    if (!snippetByPage.has(c.page)) snippetByPage.set(c.page, c.snippet)
  }

  return (
    <div>
      <Label>{isUser ? 'YOU' : 'ASSISTANT'}</Label>
      <div className="text-[15px] leading-[1.6] text-ink">
        {isUser ? (
          message.content
        ) : message.streaming && message.content === '' ? (
          <>
            <BlinkingCursor />
            <ThinkingStages />
          </>
        ) : (
          <div>
            {segments!.map((s, i) =>
              s.kind === 'text' ? (
                <Fragment key={i}>{s.text}</Fragment>
              ) : (
                <span key={i}>
                  {s.pages.map((p) => (
                    <CitationChip
                      key={p}
                      page={p}
                      snippet={snippetByPage.get(p)}
                      onJump={onJump}
                    />
                  ))}
                </span>
              ),
            )}
            {message.streaming && <BlinkingCursor />}
          </div>
        )}
      </div>

      {!isUser && sources.length > 0 && !message.streaming && (
        <div className="mt-3 flex items-center gap-3 text-[12px]">
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-mute">
            Sources
          </span>
          <span className="flex flex-wrap items-center gap-1 font-mono text-mid">
            {sources.map((p, i) => (
              <Fragment key={p}>
                {i > 0 && <span className="text-mute">·</span>}
                <button
                  type="button"
                  onClick={() => onJump(p)}
                  className="underline decoration-rule-strong decoration-1 underline-offset-2 hover:text-ink hover:decoration-ink"
                >
                  p{p}
                </button>
              </Fragment>
            ))}
          </span>
        </div>
      )}

      {!isUser && retrieved.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setExcerptsOpen((v) => !v)}
            aria-expanded={excerptsOpen}
            className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.06em] text-mute hover:text-ink"
          >
            <span
              className={`inline-block transition-transform ${
                excerptsOpen ? 'rotate-90' : ''
              }`}
            >
              ›
            </span>
            {excerptsOpen ? 'Hide' : 'Show'} retrieved excerpts ({retrieved.length})
          </button>
          {excerptsOpen && (
            <ol className="mt-3 space-y-3 border-l border-rule pl-3">
              {retrieved.map((c, i) => (
                <li key={c.chunk_id}>
                  <div className="mb-1 flex items-center gap-2 font-mono text-[11px] text-mute">
                    <span>#{String(i + 1).padStart(2, '0')}</span>
                    <button
                      type="button"
                      onClick={() => onJump(c.page)}
                      className="rounded-[4px] border border-rule px-1.5 text-mid hover:bg-elevated hover:text-ink"
                    >
                      p{c.page}
                    </button>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                      d={c.score.toFixed(3)}
                    </span>
                  </div>
                  <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-mid">
                    {c.text}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}

export default Message
