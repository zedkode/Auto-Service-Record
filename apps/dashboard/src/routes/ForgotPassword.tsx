import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button, Card, CardBody, TextField, buttonClassName } from '@autoservices/ui'
import { ApiError } from '@autoservices/api-client'
import { api } from '../lib/api.js'
import { AuthShell } from '../components/AuthShell.js'

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const email = String(new FormData(e.currentTarget).get('email') ?? '').trim()
    try {
      await api.auth.forgotPassword(email)
      // Shown regardless of whether the address exists — the server deliberately
      // returns the same response either way (SECURITY.md §4).
      setSent(true)
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not send the reset link. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <AuthShell title="Check your email">
        <Card>
          <CardBody className="flex flex-col items-center pt-6 text-center">
            <span
              className="mb-3 flex size-10 items-center justify-center rounded-full bg-status-healthy-subtle text-[18px] text-status-healthy"
              aria-hidden="true"
            >
              ✓
            </span>
            <h2 className="text-[15px] font-semibold">Reset link sent</h2>
            <p className="mt-1 text-[13px] text-content-secondary">
              If that address has an account, a reset link is on its way. It expires in one hour.
            </p>
            <Link
              to="/sign-in"
              className={buttonClassName({ variant: 'secondary', className: 'mt-5 w-full' })}
            >
              Back to sign in
            </Link>
          </CardBody>
        </Card>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Reset your password" subtitle="We will email you a link to set a new one.">
      <Card>
        <CardBody className="pt-5">
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-status-overdue/30 bg-status-overdue-subtle px-3 py-2 text-[13px] text-status-overdue"
            >
              {error}
            </div>
          )}
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <TextField
              name="email"
              label="Email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              placeholder="you@example.com"
            />
            <Button type="submit" variant="primary" className="w-full" loading={busy}>
              Send reset link
            </Button>
          </form>
          <p className="mt-4 text-center text-[13px]">
            <Link to="/sign-in" className="font-medium text-accent hover:underline">
              Back to sign in
            </Link>
          </p>
        </CardBody>
      </Card>
    </AuthShell>
  )
}
