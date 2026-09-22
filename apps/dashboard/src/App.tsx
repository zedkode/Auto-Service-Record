import { Navigate, Route, Routes } from 'react-router'
import { ErrorState } from '@autoservices/ui'
import { SessionProvider } from './lib/session.js'
import { useSessionQuery } from './lib/use-session.js'
import { AppShell } from './components/AppShell.js'
import { SignInPage } from './routes/SignIn.js'
import { VerifyEmailPage } from './routes/VerifyEmail.js'
import { ForgotPasswordPage } from './routes/ForgotPassword.js'
import { ResetPasswordPage } from './routes/ResetPassword.js'
import { OverviewPage } from './routes/Overview.js'
import { VehiclesPage } from './routes/Vehicles.js'
import { NewVehiclePage } from './routes/NewVehicle.js'
import { VehicleDetailPage } from './routes/VehicleDetail.js'
import { MembersPage } from './routes/Members.js'
import { ServicesPage } from './routes/Services.js'
import { MaintenancePage } from './routes/Maintenance.js'
import { RemindersPage } from './routes/Reminders.js'
import { ComingSoonPage } from './routes/ComingSoon.js'
import { AcceptInvitationPage } from './routes/AcceptInvitation.js'
import { FuelPage } from './routes/Fuel.js'
import { ExpensesPage } from './routes/Expenses.js'
import { DocumentsPage } from './routes/Documents.js'
import { ApiError } from '@autoservices/api-client'

export function App() {
  const { data: session, isPending, error, refetch } = useSessionQuery()

  if (isPending) return <FullPageLoading />

  // 401 is the expected unauthenticated path, not an error to shout about.
  if (error instanceof ApiError && error.status === 401) {
    return (
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<Navigate to="/sign-in" replace />} />
      </Routes>
    )
  }

  if (error || !session) {
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <ErrorState
          title="Cannot reach the API"
          message={
            error instanceof ApiError ? error.message : 'The dashboard could not load your session.'
          }
          requestId={error instanceof ApiError ? error.requestId : undefined}
          onRetry={() => void refetch()}
        />
      </div>
    )
  }

  return (
    <SessionProvider session={session}>
      <AppShell>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/vehicles" element={<VehiclesPage />} />
          <Route path="/vehicles/new" element={<NewVehiclePage />} />
          <Route path="/vehicles/:vehicleId" element={<VehicleDetailPage />} />
          <Route path="/members" element={<MembersPage />} />
          <Route path="/invitations/accept" element={<AcceptInvitationPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/sign-in" element={<Navigate to="/" replace />} />
          <Route path="/forgot-password" element={<Navigate to="/" replace />} />
          <Route path="/service" element={<ServicesPage />} />
          <Route path="/maintenance" element={<MaintenancePage />} />
          <Route path="/reminders" element={<RemindersPage />} />
          <Route path="/fuel" element={<FuelPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/reports" element={<ComingSoonPage title="Reports" phase="Phase 10" />} />
          <Route
            path="/settings"
            element={<ComingSoonPage title="Workspace settings" phase="Phase 2" />}
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppShell>
    </SessionProvider>
  )
}

function FullPageLoading() {
  return (
    <div className="grid min-h-dvh place-items-center bg-surface-base">
      <div className="flex flex-col items-center gap-3">
        <svg
          className="size-6 animate-spin text-accent"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="8"
            cy="8"
            r="6.5"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="2"
          />
          <path
            d="M14.5 8A6.5 6.5 0 0 0 8 1.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <p className="text-[13px] text-content-secondary">Loading your garage…</p>
      </div>
    </div>
  )
}

function NotFound() {
  return (
    <div className="py-20">
      <ErrorState title="Page not found" message="That page does not exist." />
    </div>
  )
}
