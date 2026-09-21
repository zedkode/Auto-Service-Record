import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button, Card, CardBody, ErrorState, Skeleton } from '@autoservices/ui'
import { ApiError } from '@autoservices/api-client'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'

/**
 * WS-004 — the page an invited person lands on.
 *
 * The preview is public so the workspace can be named before anyone is asked to sign in;
 * accepting requires a session, because an invitation joins an account, not an address.
 */
export function AcceptInvitationPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const { session } = useSession()
  const [error, setError] = useState<string | null>(null)

  const preview = useQuery({
    queryKey: ['invitation-preview', token],
    queryFn: () => api.invitations.preview(token),
    retry: false,
    enabled: token.length > 0,
  })

  const accept = useMutation({
    mutationFn: () => api.invitations.accept(token),
    onSuccess: () => {
      // Hard navigation: the session's workspace list has changed.
      window.location.assign('/')
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not accept this invitation.'),
  })

  if (!token) {
    return (
      <Shell>
        <ErrorState message="This link is missing its invitation code." />
      </Shell>
    )
  }

  if (preview.isPending) {
    return (
      <Shell>
        <Skeleton className="h-24 w-full" />
      </Shell>
    )
  }

  if (preview.error) {
    return (
      <Shell>
        <ErrorState
          title="This invitation is no longer valid"
          message="It may have expired, been revoked, or already been used. Ask whoever invited you to send a new one."
        />
      </Shell>
    )
  }

  const invitation = preview.data
  const addressMatches = invitation.email.toLowerCase() === session.user.email.toLowerCase()

  return (
    <Shell>
      <h1 className="text-lg font-semibold tracking-tight">Join {invitation.workspaceName}</h1>
      <p className="mt-2 text-[13.5px] text-content-secondary">
        You have been invited as{' '}
        <strong>{invitation.role.charAt(0) + invitation.role.slice(1).toLowerCase()}</strong>.
      </p>

      {!addressMatches && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-status-attention/30 bg-status-attention-subtle px-3 py-2 text-[13px] text-status-attention"
        >
          This invitation was sent to <strong>{invitation.email}</strong>, but you are signed in as{' '}
          {session.user.email}. Sign in with the invited address to accept it.
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-status-overdue/30 bg-status-overdue-subtle px-3 py-2 text-[13px] text-status-overdue"
        >
          {error}
        </div>
      )}

      <div className="mt-5 flex gap-2">
        <Button
          variant="primary"
          loading={accept.isPending}
          disabled={!addressMatches}
          onClick={() => accept.mutate()}
        >
          Accept invitation
        </Button>
        <Button variant="ghost" onClick={() => navigate('/')}>
          Not now
        </Button>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <CardBody className="py-6">{children}</CardBody>
      </Card>
    </div>
  )
}
