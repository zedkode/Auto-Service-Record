import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Card, CardBody, buttonClassName } from '@autoservices/ui'
import { ApiError } from '@autoservices/api-client'
import { api } from '../lib/api.js'
import { AuthShell } from '../components/AuthShell.js'

type State = 'verifying' | 'verified' | 'already' | 'failed'

export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const token = params.get('token')
  const [state, setState] = useState<State>(token ? 'verifying' : 'failed')
  const [message, setMessage] = useState<string | null>(
    token ? null : 'That link is missing its token.',
  )
  // StrictMode double-invokes effects in development; consuming a single-use token
  // twice would report a spurious failure.
  const consumed = useRef(false)

  useEffect(() => {
    if (!token || consumed.current) return
    consumed.current = true
    void (async () => {
      try {
        const result = await api.auth.verifyEmail(token)
        setState(result.alreadyVerified ? 'already' : 'verified')
        await queryClient.invalidateQueries({ queryKey: ['session'] })
      } catch (err) {
        setState('failed')
        setMessage(err instanceof ApiError ? err.message : 'Could not verify that link.')
      }
    })()
  }, [token, queryClient])

  const content = {
    verifying: { icon: '⋯', title: 'Confirming your email…', body: 'One moment.' },
    verified: { icon: '✓', title: 'Email confirmed', body: 'Your account is fully set up.' },
    already: {
      icon: '✓',
      title: 'Already confirmed',
      body: 'This address was verified previously.',
    },
    failed: {
      icon: '✕',
      title: 'Could not confirm',
      body: message ?? 'That link is invalid or expired.',
    },
  }[state]

  const tone =
    state === 'failed'
      ? 'bg-status-overdue-subtle text-status-overdue'
      : state === 'verifying'
        ? 'bg-surface-sunken text-content-secondary'
        : 'bg-status-healthy-subtle text-status-healthy'

  return (
    <AuthShell title="Email confirmation">
      <Card>
        <CardBody className="flex flex-col items-center pt-6 text-center">
          <span
            className={`mb-3 flex size-10 items-center justify-center rounded-full text-[18px] ${tone}`}
            aria-hidden="true"
          >
            {content.icon}
          </span>
          <h2 className="text-[15px] font-semibold">{content.title}</h2>
          <p className="mt-1 text-[13px] text-content-secondary">{content.body}</p>
          {state !== 'verifying' && (
            <Link
              to="/"
              className={buttonClassName({ variant: 'primary', className: 'mt-5 w-full' })}
            >
              {state === 'failed' ? 'Back to the app' : 'Go to your garage'}
            </Link>
          )}
        </CardBody>
      </Card>
    </AuthShell>
  )
}
