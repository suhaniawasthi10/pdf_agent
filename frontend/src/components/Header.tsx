import type { PdfStatus } from '../api'
import Mark from './Mark'

type Props = {
  status: PdfStatus | null
  onReset: () => void
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[4px] border border-rule px-2 py-1 font-mono text-[11px] text-mid transition-colors hover:bg-elevated">
      {children}
    </span>
  )
}

function Header({ status, onReset }: Props) {
  return (
    <header
      className="flex h-[52px] shrink-0 items-center justify-between gap-4 border-b border-rule-strong bg-canvas px-5"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Mark size={16} className="text-ink shrink-0" />
        <span className="text-[14px] font-semibold text-ink tracking-[-0.01em]">
          PDF Agent
        </span>
        {status && (
          <>
            <span className="h-4 w-px bg-rule shrink-0" aria-hidden />
            <span
              className="truncate font-mono text-[12px] text-mid"
              title={status.filename}
            >
              {status.filename ?? '—'}
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        {status?.pages !== undefined && (
          <Pill>
            {status.pages} {status.pages === 1 ? 'page' : 'pages'}
          </Pill>
        )}
        {status?.chunks !== undefined && (
          <Pill>
            {status.chunks} {status.chunks === 1 ? 'chunk' : 'chunks'}
          </Pill>
        )}
        {status?.language && <Pill>lang: {status.language}</Pill>}
        {status && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-[4px] bg-ink px-3 py-[6px] font-mono text-[11px] text-surface transition-colors active:scale-[0.97] hover:bg-[#262626]"
          >
            New PDF
          </button>
        )}
      </div>
    </header>
  )
}

export default Header
