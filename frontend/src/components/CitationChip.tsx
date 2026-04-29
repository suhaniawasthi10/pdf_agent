type Props = {
  page: number
  snippet?: string
  onJump: (page: number) => void
}

function CitationChip({ page, snippet, onJump }: Props) {
  return (
    <span className="group relative inline-block align-baseline">
      <button
        type="button"
        onClick={() => onJump(page)}
        title={`Jump to page ${page}`}
        className="font-mono text-[12px] text-ink underline decoration-rule-strong decoration-1 underline-offset-2 hover:bg-elevated hover:px-1 hover:decoration-ink transition-[background,padding] duration-150 mx-0.5"
      >
        [p{page}]
      </button>
      {snippet && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden w-72 -translate-x-1/2 rounded-[4px] border border-rule-strong bg-surface px-3 py-2 text-left group-hover:block"
        >
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-[0.06em] text-mute">
            Page {page}
          </span>
          <span className="block whitespace-pre-wrap break-words text-[12px] leading-snug text-ink">
            {snippet}
          </span>
        </span>
      )}
    </span>
  )
}

export default CitationChip
