import { Navigate, Route, Routes } from 'react-router-dom'
import { currentUser } from './auth'
import { AppShell } from './components/AppShell'
import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'
import { ProfilePage } from './pages/ProfilePage'
import { Dashboard } from './pages/Dashboard'
import { SchemaPage } from './pages/SchemaPage'
import { ComparePage } from './pages/ComparePage'
import { TracePage } from './pages/TracePage'
import { AuditPage } from './pages/AuditPage'
import { ResultsPage } from './pages/ResultsPage'
import { SafetyPage } from './pages/SafetyPage'

export default function App() {
  return (
    <Routes>
      {/* Public landing page (dark theme, no app shell). */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Operational console. */}
      <Route path="/console" element={currentUser() ? <AppShell /> : <Navigate to="/login" replace />}>
        <Route index element={<Dashboard />} />
        <Route path="schema" element={<SchemaPage />} />
        <Route path="compare" element={<ComparePage />} />
        <Route path="trace" element={<TracePage />} />
        <Route path="trace/:runId" element={<TracePage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="results" element={<ResultsPage />} />
        <Route path="safety" element={<SafetyPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
