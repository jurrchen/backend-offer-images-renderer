'use client'

export function Sparkline({ data, width = 200, height = 32 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return null

  const max = Math.max(...data, 1)
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - (v / max) * height
    return `${x},${y}`
  })

  return (
    <svg width={width} height={height} className="inline-block">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="text-blue-500"
      />
    </svg>
  )
}
