import { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { pdfFileUrl } from '../api'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type Props = {
  pdfId: string
  currentPage: number
  jumpToken?: number
  onPageChange: (page: number) => void
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function PdfPreview({ pdfId, currentPage, jumpToken = 0, onPageChange }: Props) {
  const [numPages, setNumPages] = useState<number | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flashKey, setFlashKey] = useState<number>(0)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const pageRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const measure = () => {
      // getBoundingClientRect.width is the laid-out width including padding.
      // px-4 wrapper = 32px total horizontal padding. We then leave 24px of
      // slack for the page container's p-1 + 1px border + scrollbar safety.
      const rect = el.getBoundingClientRect()
      const inner = rect.width - 32
      if (inner > 0) setWidth(Math.max(200, Math.floor(inner) - 24))
    }
    // Defer the first measurement one frame so flex + framer-motion have
    // settled the splitter layout before we read it.
    const raf = window.requestAnimationFrame(measure)
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      window.cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  useEffect(() => {
    pageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [currentPage])

  useEffect(() => {
    if (jumpToken === 0) return
    setFlashKey((k) => k + 1)
  }, [jumpToken])

  const safePage = numPages
    ? Math.min(Math.max(1, currentPage), numPages)
    : currentPage

  const totalLabel = numPages ? pad2(numPages) : '··'

  return (
    <div className="flex h-full min-w-0 flex-col bg-canvas">
      <div className="flex h-[44px] shrink-0 items-center justify-between border-b border-rule px-4">
        <div
          key={flashKey}
          className="rounded-[4px] px-2 py-1 font-mono text-[12px] text-ink"
          style={{
            fontVariantNumeric: 'tabular-nums',
            animation: flashKey === 0 ? 'none' : 'indicator-flash 600ms ease-out',
          }}
        >
          {pad2(safePage)} / {totalLabel}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!numPages || safePage <= 1}
            onClick={() => onPageChange(safePage - 1)}
            className="rounded-[4px] px-2 py-1 text-[12px] font-medium text-ink transition-opacity hover:bg-elevated disabled:opacity-30 disabled:hover:bg-transparent"
          >
            ← Prev
          </button>
          <button
            type="button"
            disabled={!numPages || safePage >= (numPages ?? 1)}
            onClick={() => onPageChange(safePage + 1)}
            className="rounded-[4px] px-2 py-1 text-[12px] font-medium text-ink transition-opacity hover:bg-elevated disabled:opacity-30 disabled:hover:bg-transparent"
          >
            Next →
          </button>
        </div>
      </div>
      <div
        ref={wrapperRef}
        className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4"
      >
        {error ? (
          <div className="font-mono text-[12px] text-[color:var(--color-danger)]">
            {error}
          </div>
        ) : (
          <Document
            file={pdfFileUrl(pdfId)}
            onLoadSuccess={(info) => {
              setNumPages(info.numPages)
              setError(null)
            }}
            onLoadError={(e) => setError(e.message)}
            loading={
              <div className="font-mono text-[12px] text-mute">loading pdf</div>
            }
          >
            <div
              ref={pageRef}
              className="w-full overflow-hidden rounded-[8px] border border-rule bg-surface p-1"
            >
              {width !== null && (
                <Page
                  pageNumber={safePage}
                  width={width - 8}
                  renderAnnotationLayer
                  renderTextLayer
                />
              )}
            </div>
          </Document>
        )}
      </div>
    </div>
  )
}

export default PdfPreview
