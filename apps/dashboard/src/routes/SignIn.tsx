import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Card, CardBody, TextField } from '@autoservices/ui'
import { ApiError } from '@autoservices/api-client'
import { registerSchema, loginSchema } from '@autoservices/validation'
import { api } from '../lib/api.js'
import { AuthShell, FieldErrors } from '../components/AuthShell.js'

const DEV_MODE = import.meta.env.DEV

export function SignInPage() {
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const [mode, setMode] = useState<'signin' | 'register'>(
    params.get('mode') === 'register' ? 'register' : 'signin',
  )
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const reload = () => queryClient.invalidateQueries({ queryKey: ['session'] })

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    const fd = new FormData(e.currentTarget)

    if (mode === 'register') {
      const input = {
        displayName: String(fd.get('displayName') ?? '').trim(),
        email: String(fd.get('email') ?? '').trim(),
        password: String(fd.get('password') ?? ''),
        passwordConfirmation: String(fd.get('passwordConfirmation') ?? ''),
        acceptTerms: fd.get('acceptTerms') === 'on',
      }
      // Same schema the server uses — immediate feedback, and the server still re-validates.
      const parsed = registerSchema.safeParse(input)
      if (!parsed.success) {
        setFieldErrors(toFieldErrors(parsed.error.issues))
        return
      }
      setBusy(true)
      try {
        await api.auth.register(parsed.data as never)
        await reload()
      } catch (err) {
        handleError(err)
      } finally {
        setBusy(false)
      }
      return
    }

    const input = {
      email: String(fd.get('email') ?? '').trim(),
      password: String(fd.get('password') ?? ''),
    }
    const parsed = loginSchema.safeParse(input)
    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error.issues))
      return
    }
    setBusy(true)
    try {
      await api.auth.login(parsed.data.email, parsed.data.password)
      await reload()
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }

  function handleError(err: unknown) {
    if (err instanceof ApiError) {
      const fields = err.fieldErrors
      if (Object.keys(fields).length) setFieldErrors(fields)
      else setError(err.message)
    } else {
      setError('Something went wrong. Please try again.')
    }
  }

  async function devSignIn() {
    setBusy(true)
    setError(null)
    try {
      await api.auth.devLogin('andrei@autoservices.local')
      await reload()
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }

  const isRegister = mode === 'register'

  return (
    <AuthShell
      title={isRegister ? 'Create your account' : 'Sign in to AutoServices'}
      subtitle={
        isRegister
          ? 'You will get a personal garage automatically.'
          : "Your vehicle's history, in one place."
      }
    >
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
            {isRegister && (
              <TextField
                name="displayName"
                label="Your name"
                required
                autoComplete="name"
                placeholder="Andrei"
                error={fieldErrors.displayName}
              />
            )}
            <TextField
              name="email"
              label="Email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              error={fieldErrors.email}
            />
            <TextField
              name="password"
              label="Password"
              type="password"
              required
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              hint={isRegister ? 'At least 12 characters.' : undefined}
              error={fieldErrors.password}
            />
            {isRegister && (
              <>
                <TextField
                  name="passwordConfirmation"
                  label="Confirm password"
                  type="password"
                  required
                  autoComplete="new-password"
                  error={fieldErrors.passwordConfirmation}
                />
                <div>
                  <label className="flex items-start gap-2.5 text-[13px]">
                    <input
                      type="checkbox"
                      name="acceptTerms"
                      className="mt-0.5 size-4 shrink-0 rounded border-border-default accent-[var(--accent)]"
                    />
                    <span className="text-content-secondary">
                      I accept the{' '}
                      <a href="#" className="text-accent hover:underline">
                        terms of service
                      </a>{' '}
                      and{' '}
                      <a href="#" className="text-accent hover:underline">
                        privacy policy
                      </a>
                      .
                    </span>
                  </label>
                  <FieldErrors error={fieldErrors.acceptTerms} />
                </div>
              </>
            )}

            {!isRegister && (
              <div className="flex justify-end -mt-1">
                <Link
                  to="/forgot-password"
                  className="text-[12.5px] font-medium text-accent hover:underline"
                >
                  Forgot your password?
                </Link>
              </div>
            )}

            <Button type="submit" variant="primary" className="w-full" loading={busy}>
              {isRegister ? 'Create account' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-4 text-center text-[13px] text-content-secondary">
            {isRegister ? 'Already have an account?' : 'No account yet?'}{' '}
            <button
              type="button"
              onClick={() => {
                setMode(isRegister ? 'signin' : 'register')
                setError(null)
                setFieldErrors({})
              }}
              className="font-medium text-accent hover:underline"
            >
              {isRegister ? 'Sign in' : 'Create one'}
            </button>
          </p>
        </CardBody>
      </Card>

      {DEV_MODE && (
        <div className="mt-4 rounded-lg border border-dashed border-border-strong bg-surface-sunken/60 p-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-content-tertiary">
            Development only
          </p>
          <p className="mt-1 text-[12.5px] text-content-secondary">
            Sign in as the seeded developer account without a password. This route does not exist
            when <code className="font-mono">DEV_AUTH_ENABLED</code> is off, and is blocked outright
            in production.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3 w-full"
            onClick={() => void devSignIn()}
            loading={busy}
          >
            Sign in as andrei@autoservices.local
          </Button>
        </div>
      )}
    </AuthShell>
  )
}

function toFieldErrors(issues: Array<{ path: PropertyKey[]; message: string }>) {
  const out: Record<string, string> = {}
  for (const i of issues) {
    const key = i.path.join('.')
    if (key && !out[key]) out[key] = i.message
  }
  return out
}
