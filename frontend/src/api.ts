import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

const http = axios.create({ baseURL: BASE_URL })

export type UploadResponse = {
  pdf_id: string
  status: string
  filename?: string
}

export type PdfStatus = {
  pdf_id: string
  status: 'processing' | 'ready' | 'failed'
  filename?: string
  pages?: number
  chunks?: number
  language?: string
  error?: string
}

export type Citation = { page: number; snippet: string; chunk_id: string }

export type RetrievedChunk = {
  text: string
  page: number
  score: number
  chunk_id: string
}

export type ChatResponse = {
  answer: string
  citations: Citation[]
  route_taken: 'answered' | 'refused'
  retrieved_chunks: RetrievedChunk[]
}

export async function uploadPdf(file: File): Promise<UploadResponse> {
  const form = new FormData()
  form.append('file', file)
  const res = await http.post<UploadResponse>('/upload', form)
  return res.data
}

export async function getPdfStatus(pdfId: string): Promise<PdfStatus> {
  const res = await http.get<PdfStatus>(`/pdf/status/${pdfId}`)
  return res.data
}

export type HistoryTurn = { role: 'user' | 'assistant'; content: string }

export async function sendChat(
  pdfId: string,
  message: string,
  history: HistoryTurn[] = [],
): Promise<ChatResponse> {
  const res = await http.post<ChatResponse>('/chat', {
    pdf_id: pdfId,
    message,
    history,
  })
  return res.data
}

export function pdfFileUrl(pdfId: string): string {
  return `${BASE_URL}/pdf/file/${pdfId}`
}

export type StreamCallbacks = {
  onMeta: (chunks: RetrievedChunk[]) => void
  onDelta: (text: string) => void
  onDone: (final: {
    answer: string
    citations: Citation[]
    route_taken: 'answered' | 'refused'
    retrieved_chunks: RetrievedChunk[]
  }) => void
}

export async function streamChat(
  pdfId: string,
  message: string,
  callbacks: StreamCallbacks,
  options?: { signal?: AbortSignal; history?: HistoryTurn[] },
): Promise<void> {
  const res = await fetch(`${BASE_URL}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pdf_id: pdfId,
      message,
      history: options?.history ?? [],
    }),
    signal: options?.signal,
  })
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const event = parseSseEvent(rawEvent)
      if (!event) continue
      if (event.event === 'meta') {
        callbacks.onMeta(
          (event.data as { retrieved_chunks: RetrievedChunk[] }).retrieved_chunks,
        )
      } else if (event.event === 'delta') {
        callbacks.onDelta((event.data as { text: string }).text)
      } else if (event.event === 'done') {
        callbacks.onDone(
          event.data as {
            answer: string
            citations: Citation[]
            route_taken: 'answered' | 'refused'
            retrieved_chunks: RetrievedChunk[]
          },
        )
      }
    }
  }
}

function parseSseEvent(
  raw: string,
): { event: string; data: Record<string, unknown> } | null {
  let event = 'message'
  let data = ''
  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7)
    else if (line.startsWith('data: ')) data += line.slice(6)
  }
  if (!data) return null
  try {
    return { event, data: JSON.parse(data) }
  } catch {
    return null
  }
}
