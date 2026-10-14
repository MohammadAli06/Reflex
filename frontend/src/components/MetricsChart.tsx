import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface ChartDatum {
  name: string
  baseline: number
  healing: number
}

export function MetricsChart({ data }: { data: ChartDatum[] }) {
  if (data.length === 0) {
    return <div className="state state-empty">No metrics to chart yet.</div>
  }
  return (
    <div className="metrics-chart">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Legend />
          <Bar dataKey="baseline" fill="#9ca3af" name="Baseline" />
          <Bar dataKey="healing" fill="#2563eb" name="Self-Healing" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
