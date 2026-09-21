import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Button, Card, CardBody, TextField, buttonClassName } from '@autoservices/ui'
import { ApiError } from '@autoservices/api-client'
import { resetPasswordSchema } from '@autoservices/validation'
import { api } from '../lib/api.js'
import { AuthShell } from '../components/AuthShell.js'

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    const fd = new FormData(e.currentTarget)
    const input = {
      token,
      password: String(fd.get('password') ?? ''),
      passwordConfirmation: String(fd.get('passwordConfirmation') ?? ''),
    }
    const parsed = resetPasswordSchema.safeParse(input)
    if (!parsed.success) {
      const out: Record<string, string> = {}
      for (const i of parsed.error.issues) {
        const k = i.path.join('.')
        if (k && !out[k]) out[k] = i.message
      }
      setFieldErrors(out)
      return
    }
    setBusy(true)
    try {
      await api.auth.resetPassword(parsed.data)
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset your password.')
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <AuthShell title="Reset your password">
        <Card>
          <CardBody className="pt-6 text-center">
            <p className="text-[13px] text-content-secondary">
              That link is missing its token. Request a new reset link.
            </p>
            <Link
              to="/forgot-password"
              className={buttonClassName({ variant: 'primary', className: 'mt-4 w-full' })}
            >
              Request a new link
            </Link>
          </CardBody>
        </Card>
      </AuthShell>
    )
  }

  if (done) {
    return (
      <AuthShell title="Password updated">
        <Card>
          <CardBody className="flex flex-col items-center pt-6 text-center">
            <span
              className="mb-3 flex size-10 items-center justify-center rounded-full bg-status-healthy-subtle text-[18px] text-status-healthy"
              aria-hidden="true"
            >
              ✓
            </span>
            <h2 className="text-[15px] font-semibold">Your password has been changed</h2>
            <p className="mt-1 text-[13px] text-content-secondary">
              For your security, every other session has been signed out.
            </p>
            <Link
              to="/sign-in"
              className={buttonClassName({ variant: 'primary', className: 'mt-5 w-full' })}
            >
              Sign in
            </Link>
          </CardBody>
        </Card>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Choose a new password" subtitle="This link can only be used once.">
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
              name="password"
              label="New password"
              type="password"
              required
              autoFocus
              autoComplete="new-password"
              hint="At least 12 characters."
              error={fieldErrors.password}
            />
            <TextField
              name="passwordConfirmation"
              label="Confirm new password"
              type="password"
              required
              autoComplete="new-password"
              error={fieldErrors.passwordConfirmation}
            />
            <Button type="submit" variant="primary" className="w-full" loading={busy}>
              Update password
            </Button>
          </form>
        </CardBody>
      </Card>
    </AuthShell>
  )
}
