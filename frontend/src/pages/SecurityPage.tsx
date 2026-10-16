import { PageHead } from '../components/console'
import { SecuritySection } from '../components/SecuritySection'

/**
 * Standalone Security page. Superseded by the merged Settings page
 * (/console/settings); kept for its tests and as a reusable surface, but no
 * longer routed by default.
 */
export function SecurityPage() {
  return (
    <div className="con-page">
      <PageHead
        eyebrow={<span>Provenance and sessions</span>}
        title="Security"
        subtitle="Verify the audit chain, the served schema's signature, and active sessions."
      />
      <SecuritySection />
    </div>
  )
}
