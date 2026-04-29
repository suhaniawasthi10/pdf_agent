type Props = {
  size?: number
  className?: string
}

function Mark({ size = 16, className = '' }: Props) {
  const stroke = Math.max(1, size / 16)
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      <rect x="1" y="1" width="6" height="6" fill="currentColor" />
      <rect
        x="9"
        y="1"
        width="6"
        height="6"
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
      />
      <rect
        x="1"
        y="9"
        width="6"
        height="6"
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
      />
      <rect
        x="9"
        y="9"
        width="6"
        height="6"
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
      />
    </svg>
  )
}

export default Mark
