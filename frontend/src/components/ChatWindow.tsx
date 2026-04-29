import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../App'
import { streamChat, type HistoryTurn } from '../api'
import Message from './Message'

type Props = {
  pdfId: string
  filename?: string
  messages: ChatMessage[]
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
  onJump: (page: number) => void
}

const SUGGESTIONS = [
  'Summarise this document.',
  'What topics does it cover?',
  'मुख्य विषय क्या है?',
] as const

const MAX_LINES = 5
const LINE_HEIGHT_PX = 24

function updateLast(
  messages: ChatMessage[],
  patch: (m: ChatMessage) => ChatMessage,
): ChatMessage[] {
  if (messages.length === 0) return messages
  const next = messages.slice(0, -1)
  next.push(patch(messages[messages.length - 1]))
  return next
}

function ChatWindow({
  pdfId,
  filename,
  messages,
  setMessages,
  onJump,
}: Props) {
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = scrollerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, pending])

  useEffect(() => {
    const ta = inputRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const max = LINE_HEIGHT_PX * MAX_LINES
    const next = Math.min(ta.scrollHeight, max)
    ta.style.height = `${next}px`
    ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden'
  }, [input])

  const submit = async () => {
    const text = input.trim()
    if (!text || pending) return
    setError(null)
    setInput('')

    // Capture last 6 completed messages BEFORE appending the new turn so the
    // backend has prior context. We exclude any in-flight streaming placeholder
    // and trim the array to keep prompt token cost bounded.
    const history: HistoryTurn[] = messages
      .filter((m) => !m.streaming || m.content.length > 0)
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }))

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text },
      { role: 'assistant', content: '', streaming: true },
    ])
    setPending(true)
    try {
      await streamChat(
        pdfId,
        text,
        {
          onMeta: (chunks) => {
            setMessages((prev) =>
              updateLast(prev, (m) => ({ ...m, retrieved: chunks })),
            )
          },
          onDelta: (delta) => {
            setMessages((prev) =>
              updateLast(prev, (m) => ({ ...m, content: m.content + delta })),
            )
          },
          onDone: ({ answer, citations, route_taken, retrieved_chunks }) => {
            setMessages((prev) =>
              updateLast(prev, (m) => ({
                ...m,
                content: answer,
                citations,
                retrieved: retrieved_chunks,
                route: route_taken,
                streaming: false,
              })),
            )
          },
        },
        { history },
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed')
      setMessages((prev) => {
        if (prev.length === 0) return prev
        const last = prev[prev.length - 1]
        return last.role === 'assistant' && last.streaming
          ? prev.slice(0, -1)
          : prev
      })
    } finally {
      setPending(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const canSend = input.trim().length > 0 && !pending

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-8 py-8">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
            <div className="text-[18px] font-medium text-ink">
              Ask anything about{' '}
              <span className="font-mono">{filename ?? 'this PDF'}</span>.
            </div>
            <div className="flex max-w-md flex-wrap items-center justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setInput(s)
                    inputRef.current?.focus()
                  }}
                  className="group inline-flex items-center gap-2 rounded-[6px] border border-rule bg-transparent px-3 py-[6px] text-[13px] text-ink hover:border-rule-strong hover:bg-elevated"
                >
                  <span className="font-mono text-mute transition-transform duration-150 ease-out group-hover:translate-x-[2px]">
                    →
                  </span>
                  <span>{s}</span>
                </button>
              ))}
            </div>
            <div className="font-mono text-[11px] text-mute">
              // or type your own
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-7">
            {messages.map((m, i) => (
              <Message key={i} message={m} onJump={onJump} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-rule px-6 py-4">
        <div
          className={`flex items-end gap-2 rounded-[6px] border bg-surface px-3 py-2 transition-colors ${
            focused ? 'border-ink' : 'border-rule-strong'
          }`}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Ask the document..."
            disabled={pending}
            rows={1}
            className="flex-1 resize-none bg-transparent font-sans text-[15px] leading-[1.6] text-ink placeholder:text-mute focus:outline-none disabled:opacity-50"
            style={{ height: `${LINE_HEIGHT_PX}px` }}
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSend}
            title="Send (Enter)"
            className="shrink-0 rounded-[4px] bg-ink px-3 py-[6px] font-mono text-[11px] text-surface transition-colors hover:bg-[#262626] active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-elevated disabled:text-mute disabled:hover:bg-elevated disabled:active:scale-100"
          >
            {pending ? 'sending…' : 'Send'}
          </button>
        </div>
        {error && (
          <div className="mt-2 font-mono text-[12px] text-[color:var(--color-danger)]">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

export default ChatWindow
