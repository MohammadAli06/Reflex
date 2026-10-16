export function Skeleton({ width = '100%', height = 14 }: { width?: string | number; height?: string | number }) {
  return <div className="skel" style={{ width, height }} aria-hidden="true" />
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skel" key={i} style={{ height: 14, width: i === rows - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  )
}
