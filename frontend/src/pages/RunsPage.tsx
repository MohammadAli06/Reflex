import { useSearchParams } from 'react-router-dom'
import { PageHead } from '../components/console'
import { TracePage } from './TracePage'
import { AuditPage } from './AuditPage'

type RunsTab = 'timeline' | 'ledger'

export function RunsPage() {
  const [params, setParams] = useSearchParams()
  const tab: RunsTab = params.get('tab') === 'ledger' ? 'ledger' : 'timeline'

  return (
    <div className="con-page">
      <PageHead
        eyebrow={<span>Runs and their decisions</span>}
        title="Runs"
        subtitle="Event timelines per run, with the audit decision pinned below, and the full decision ledger."
        right={
          <div className="csegment" aria-label="Runs view switcher">
            <button
              type="button"
              className={tab === 'timeline' ? 'on' : ''}
              onClick={() => setParams(tab === 'ledger' ? {} : params)}
            >
              Timeline
            </button>
            <button
              type="button"
              className={tab === 'ledger' ? 'on' : ''}
              onClick={() => setParams({ tab: 'ledger' })}
            >
              Decision ledger
            </button>
          </div>
        }
      />
      {tab === 'ledger' ? <AuditPage /> : <TracePage embedded />}
    </div>
  )
}
