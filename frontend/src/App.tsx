import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { Dashboard } from './pages/Dashboard'
import { SchemaPage } from './pages/SchemaPage'
import { ComparePage } from './pages/ComparePage'
import { TracePage } from './pages/TracePage'
import { AuditPage } from './pages/AuditPage'
import { ResultsPage } from './pages/ResultsPage'
import { SafetyPage } from './pages/SafetyPage'

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/schema" element={<SchemaPage />} />
        <Route path="/compare" element={<ComparePage />} />
        <Route path="/trace" element={<TracePage />} />
        <Route path="/trace/:runId" element={<TracePage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/results" element={<ResultsPage />} />
        <Route path="/safety" element={<SafetyPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}
