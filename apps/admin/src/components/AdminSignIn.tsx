import { useState, type FormEvent } from 'react'
import { Button, Card, CardBody, TextField } from '@autoservices/ui'
import { AdminApiError, adminApi, type AdminSession } from '../lib/api.js'

/**
 * ADMIN-001 — staff sign-in.
 *
 * Password and authenticator code together, in one step: there is no state in which the
 * password alone has bought anything, so there is nothing for an attacker to hold.
 */
export function AdminSignIn({ onSignedIn }: { onSignedIn: (session: AdminSession) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const fd = new FormData(e.currentTarget)
    try {
      const session = await adminApi.auth.login(
        String(fd.get('email') ?? '').trim(),
        String(fd.get('password') ?? ''),
        String(fd.get('totpCode') ?? '').trim(),
      )
      onSignedIn(session)
    } catch (err) {
      setError(
        err instanceof AdminApiError
          ? err.message
          : 'Could not sign in. Check your connection and try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-base px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-lg font-semibold tracking-tight">AutoServices</p>
          <p className="mt-1 text-[13px] text-content-secondary">Operations console</p>
        </div>

        <Card>
          <CardBody className="py-6">
            <form onSubmit={onSubmit} noValidate>
              {error && (
                <div
                  role="alert"
                  className="mb-4 rounded-md border border-status-overdue/30 bg-status-overdue-subtle px-3 py-2 text-[13px] text-status-overdue"
                >
                  {error}
                </div>
              )}

              <div className="space-y-4">
                <TextField
                  name="email"
                  label="Email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="username"
                />
                <TextField
                  name="password"
                  label="Password"
                  type="password"
                  required
                  autoComplete="current-password"
                />
                <TextField
                  name="totpCode"
                  label="Authenticator code"
                  inputMode="numeric"
                  required
                  autoComplete="one-time-code"
                  placeholder="000000"
                  hint="Six digits from your authenticator app"
                />
              </div>

              <Button type="submit" variant="primary" loading={busy} className="mt-5 w-full">
                Sign in
              </Button>
            </form>
          </CardBody>
        </Card>

        <p className="mt-4 text-center text-[12px] text-content-tertiary">
          Staff accounts require two-factor authentication. Accounts are created with{' '}
          <code>scripts/create-admin.mjs</code>.
        </p>
      </div>
    </div>
  )
}
