import { useSearchParams } from 'react-router-dom'
import { PageHead } from '../components/console'
import { ResultsPage } from './ResultsPage'
import { RealWorldPage } from './RealWorldPage'
import { EvaluationPage } from './EvaluationPage'

type BenchmarksTab = 'scorecard' | 'real-world' | 'reliability'

const TABS: { key: BenchmarksTab; label: string }[] = [
  { key: 'scorecard', label: 'Scorecard' },
  { key: 'real-world', label: 'Real-world' },
  { key: 'reliability', label: 'Reliability' },
]

function isTab(value: string | null): value is BenchmarksTab {
  return value === 'scorecard' || value === 'real-world' || value === 'reliability'
}

export function BenchmarksPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: BenchmarksTab = isTab(raw) ? raw : 'scorecard'

  return (
    <div className="con-page">
      <PageHead
        eyebrow={<span>Benchmarks and reliability</span>}
        title="Benchmarks"
        subtitle="Aggregate scorecard, real-world drift cases, and split reliability in one place."
        right={
          <div className="csegment" aria-label="Benchmarks view switcher">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={tab === item.key ? 'on' : ''}
                onClick={() => setParams(item.key === 'scorecard' ? {} : { tab: item.key })}
              >
                {item.label}
              </button>
            ))}
          </div>
        }
      />
      {tab === 'scorecard' && <ResultsPage />}
      {tab === 'real-world' && <RealWorldPage />}
      {tab === 'reliability' && <EvaluationPage />}
    </div>
  )
}
