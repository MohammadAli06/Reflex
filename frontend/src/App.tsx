import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { api } from './api/client'
import { useApi } from './hooks/useApi'
import { LoadingState } from './components/StateViews'
import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'
import { Dashboard } from './pages/Dashboard'
import { SchemaPage } from './pages/SchemaPage'
import { ComparePage } from './pages/ComparePage'
import { RunsPage } from './pages/RunsPage'
import { BenchmarksPage } from './pages/BenchmarksPage'
import { SafetyPage } from './pages/SafetyPage'
import { RepairSettingsPage } from './pages/RepairSettingsPage'
import { SpecWatchPage } from './pages/SpecWatchPage'
import { PaymentsSandboxPage } from './pages/PaymentsSandboxPage'
import { ErrorBoundary } from './components/ErrorBoundary'

/**
 * Planned surfaces (Spec Watch, Payments Sandbox) are honest "not available"
 * pages kept out of the nav and routing by default. Evaluated at render time
 * so tests can stub the env var.
 */
function showPlanned() {
  return import.meta.env.VITE_SHOW_PLANNED === 'true'
}

function RequireAuth() {
  const session = useApi(() => api.me(), [])
  if (session.loading) return <LoadingState label="Checking your session…" />
  return session.data ? (
    <AppShell user={session.data} />
  ) : (
    <Navigate to="/login" replace />
  )
}

function RedirectRun() {
  const { runId } = useParams<{ runId: string }>()
  return <Navigate to={`/console/runs/${runId}`} replace />
}

function Planned({ page }: { page: 'spec-watch' | 'payments' }) {
  const Page = page === 'spec-watch' ? <SpecWatchPage /> : <PaymentsSandboxPage />
  if (showPlanned()) return <>{Page}</>
  return <Navigate to="/console" replace />
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        {/* Public landing page (dark theme, no app shell). */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />

        {/* Operational console. */}
        <Route path="/console" element={<RequireAuth />}>
          <Route index element={<Dashboard />} />
          <Route path="schema" element={<SchemaPage />} />
          <Route path="compare" element={<ComparePage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="runs/:runId" element={<RunsPage />} />
          <Route path="benchmarks" element={<BenchmarksPage />} />
          <Route path="safety" element={<SafetyPage />} />
          <Route path="settings" element={<RepairSettingsPage />} />

          {/* Old routes redirect to their merged homes. */}
          <Route path="trace" element={<Navigate to="/console/runs" replace />} />
          <Route path="trace/:runId" element={<RedirectRun />} />
          <Route path="audit" element={<Navigate to="/console/runs?tab=ledger" replace />} />
          <Route path="results" element={<Navigate to="/console/benchmarks" replace />} />
          <Route path="real-world" element={<Navigate to="/console/benchmarks?tab=real-world" replace />} />
          <Route path="realworld" element={<Navigate to="/console/benchmarks?tab=real-world" replace />} />
          <Route path="evaluation" element={<Navigate to="/console/benchmarks?tab=reliability" replace />} />
          <Route path="security" element={<Navigate to="/console/settings" replace />} />
          <Route path="profile" element={<Navigate to="/console" replace />} />

          {/* Planned pages: readable only with VITE_SHOW_PLANNED. */}
          <Route path="spec-watch" element={<Planned page="spec-watch" />} />
          <Route path="specwatch" element={<Navigate to="/console/spec-watch" replace />} />
          <Route path="payments-sandbox" element={<Planned page="payments" />} />
          <Route path="payments" element={<Navigate to="/console/payments-sandbox" replace />} />

          <Route path="*" element={<Navigate to="/console" replace />} />
        </Route>

        {/* Root-level legacy redirects */}
        <Route path="/realworld" element={<Navigate to="/console/benchmarks?tab=real-world" replace />} />
        <Route path="/real-world" element={<Navigate to="/console/benchmarks?tab=real-world" replace />} />
        <Route path="/evaluation" element={<Navigate to="/console/benchmarks?tab=reliability" replace />} />
        <Route path="/spec-watch" element={<Navigate to="/console/spec-watch" replace />} />
        <Route path="/security" element={<Navigate to="/console/settings" replace />} />
        <Route path="/payments" element={<Navigate to="/console/payments-sandbox" replace />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  )
}
