import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { can } from '@autoservices/permissions'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  EmptyState,
  ErrorState,
  SelectField,
  Skeleton,
  TextField,
  formatDate,
} from '@autoservices/ui'
import { ApiError, type MemberSummary } from '@autoservices/api-client'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'
import { PageHeader } from '../components/PageHeader.js'

const ASSIGNABLE = ['ADMIN', 'EDITOR', 'DRIVER', 'VIEWER'] as const

const ROLE_HINT: Record<string, string> = {
  OWNER: 'Full control, including transferring ownership',
  ADMIN: 'Everything except ownership',
  EDITOR: 'Can add and edit vehicles, services and costs',
  DRIVER: 'Can log mileage and fuel; sees no financial detail',
  VIEWER: 'Read-only',
}

/**
 * WS-002/003/005 — who is in the workspace.
 *
 * Affordances are hidden by role, but that is cosmetic: every one of these actions is
 * re-checked on the server against the TARGET's role, because "an ADMIN may change a
 * role" is true in general and false when the target is the owner.
 */
export function MembersPage() {
  const { workspace, session } = useSession()
  const queryClient = useQueryClient()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [transferTarget, setTransferTarget] = useState<MemberSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mayInvite = can(workspace.role, 'member:invite')
  const mayManage = can(workspace.role, 'member:update_role')
  const isOwner = workspace.role === 'OWNER'

  const members = useQuery({
    queryKey: ['members', workspace.id],
    queryFn: () => api.workspace.members(workspace.id),
  })
  const invitations = useQuery({
    queryKey: ['invitations', workspace.id],
    queryFn: () => api.workspace.invitations(workspace.id),
    enabled: mayInvite,
  })

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['members', workspace.id] }),
      queryClient.invalidateQueries({ queryKey: ['invitations', workspace.id] }),
    ])

  const onError = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'That did not work. Please try again.')

  const changeRole = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) =>
      api.workspace.updateMemberRole(workspace.id, memberId, role),
    onSuccess: () => {
      setError(null)
      void refresh()
    },
    onError,
  })

  const removeMember = useMutation({
    mutationFn: (memberId: string) => api.workspace.removeMember(workspace.id, memberId),
    onSuccess: () => {
      setError(null)
      void refresh()
    },
    onError,
  })

  const revokeInvitation = useMutation({
    mutationFn: (id: string) => api.workspace.revokeInvitation(workspace.id, id),
    onSuccess: () => void refresh(),
    onError,
  })

  const transfer = useMutation({
    mutationFn: (memberId: string) => api.workspace.transferOwnership(workspace.id, memberId),
    onSuccess: () => {
      setTransferTarget(null)
      setError(null)
      // The signed-in user is no longer the owner, so the whole session's role is stale.
      window.location.reload()
    },
    onError: (err) => {
      setTransferTarget(null)
      onError(err)
    },
  })

  return (
    <>
      <PageHeader
        title="Members"
        description={`People with access to ${workspace.name}.`}
        action={mayInvite && <Button onClick={() => setInviteOpen(true)}>Invite someone</Button>}
      />

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-status-overdue/30 bg-status-overdue-subtle px-3 py-2 text-[13px] text-status-overdue"
        >
          {error}
        </div>
      )}

      <Card>
        <CardHeader title="Current members" />
        <CardBody className="px-0 pb-0">
          {members.isPending ? (
            <div className="space-y-2 px-5 pb-5">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : members.error ? (
            <ErrorState message="Could not load members." onRetry={() => void members.refetch()} />
          ) : (
            <ul className="divide-y divide-border-subtle border-t border-border-subtle">
              {members.data.map((m) => {
                const isMe = m.user.id === session.user.id
                const isTargetOwner = m.role === 'OWNER'
                // The owner is never editable here — ownership moves by transfer alone.
                const editable = mayManage && !isTargetOwner && !isMe
                return (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-[12px] font-semibold text-accent">
                      {m.user.displayName.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium">
                        {m.user.displayName}
                        {isMe && <span className="ml-2 text-content-tertiary">(you)</span>}
                      </p>
                      <p className="truncate text-[12.5px] text-content-tertiary">{m.user.email}</p>
                    </div>

                    {editable ? (
                      <>
                        <label className="sr-only" htmlFor={`role-${m.id}`}>
                          Role for {m.user.displayName}
                        </label>
                        <select
                          id={`role-${m.id}`}
                          value={m.role}
                          disabled={changeRole.isPending}
                          onChange={(e) =>
                            changeRole.mutate({ memberId: m.id, role: e.target.value })
                          }
                          className="h-9 shrink-0 rounded-md border border-border-default bg-surface-raised px-2 text-[13px]"
                        >
                          {ASSIGNABLE.map((r) => (
                            <option key={r} value={r}>
                              {r.charAt(0) + r.slice(1).toLowerCase()}
                            </option>
                          ))}
                        </select>
                        {isOwner && (
                          <Button variant="ghost" onClick={() => setTransferTarget(m)}>
                            Make owner
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          onClick={() => removeMember.mutate(m.id)}
                          loading={removeMember.isPending && removeMember.variables === m.id}
                        >
                          Remove
                        </Button>
                      </>
                    ) : (
                      <span className="shrink-0" title={ROLE_HINT[m.role]}>
                        <Badge>{m.role.charAt(0) + m.role.slice(1).toLowerCase()}</Badge>
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {mayInvite && (
        <Card className="mt-6">
          <CardHeader
            title="Pending invitations"
            description="Each invitation expires after 7 days."
          />
          <CardBody className="px-0 pb-0">
            {invitations.isPending ? (
              <div className="space-y-2 px-5 pb-5">
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (invitations.data?.length ?? 0) === 0 ? (
              <EmptyState
                title="No pending invitations"
                description="Invite someone and they will appear here until they accept."
              />
            ) : (
              <ul className="divide-y divide-border-subtle border-t border-border-subtle">
                {invitations.data!.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium">{i.email}</p>
                      <p className="text-[12.5px] text-content-tertiary">
                        {i.role.charAt(0) + i.role.slice(1).toLowerCase()} · expires{' '}
                        {formatDate(i.expiresAt)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      onClick={() => revokeInvitation.mutate(i.id)}
                      loading={revokeInvitation.isPending && revokeInvitation.variables === i.id}
                    >
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onDone={() => void refresh()}
      />

      <Dialog
        open={transferTarget !== null}
        onClose={() => setTransferTarget(null)}
        title="Transfer ownership"
        size="sm"
      >
        <p className="text-[13.5px]">
          <strong>{transferTarget?.user.displayName}</strong> will become the owner of{' '}
          {workspace.name}, and you will become an admin.
        </p>
        <p className="mt-2 text-[13px] text-content-secondary">
          You cannot undo this yourself — only the new owner can transfer it back.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setTransferTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={transfer.isPending}
            onClick={() => transferTarget && transfer.mutate(transferTarget.id)}
          >
            Transfer ownership
          </Button>
        </div>
      </Dialog>
    </>
  )
}

function InviteDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  const { workspace } = useSession()
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  const invite = useMutation({
    mutationFn: ({ email, role }: { email: string; role: string }) =>
      api.workspace.invite(workspace.id, email, role),
    onSuccess: (_data, variables) => {
      setError(null)
      setSent(variables.email)
      onDone()
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not send the invitation.'),
  })

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSent(null)
    const fd = new FormData(e.currentTarget)
    invite.mutate({
      email: String(fd.get('email') ?? '').trim(),
      role: String(fd.get('role') ?? 'VIEWER'),
    })
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        setSent(null)
        setError(null)
        onClose()
      }}
      title="Invite someone"
      size="sm"
    >
      {sent ? (
        <>
          <p className="text-[13.5px]">
            An invitation has been sent to <strong>{sent}</strong>. It expires in 7 days.
          </p>
          <div className="mt-5 flex justify-end">
            <Button
              variant="primary"
              onClick={() => {
                setSent(null)
                onClose()
              }}
            >
              Done
            </Button>
          </div>
        </>
      ) : (
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
              label="Email address"
              type="email"
              required
              autoFocus
              placeholder="colleague@example.com"
            />
            <SelectField name="role" label="Role" defaultValue="VIEWER">
              {ASSIGNABLE.map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0) + r.slice(1).toLowerCase()} — {ROLE_HINT[r]}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={invite.isPending}>
              Send invitation
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
