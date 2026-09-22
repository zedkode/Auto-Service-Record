import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { can } from '@autoservices/permissions'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  EmptyState,
  ErrorState,
  SelectField,
  Skeleton,
  StatusBadge,
  TextAreaField,
  TextField,
  formatDate,
  formatMoney,
  type TrackingStatus,
} from '@autoservices/ui'
import { ApiError, type ExpiryStatus } from '@autoservices/api-client'
import { WarrantyPanel } from './WarrantyPanel.js'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'

/**
 * OWN-001/002/003 — the "is this vehicle legal to drive?" tab.
 *
 * Inspection, insurance and road tax are three records with one question in common, so
 * they are shown together rather than on three tabs nobody would check individually.
 *
 * Every expiry state shown here is computed by the SERVER. The component does no date
 * arithmetic, so what it shows cannot disagree with the reminder that was emailed
 * (DECISIONS.md D-041).
 */

const STATUS_MAP: Record<ExpiryStatus, TrackingStatus> = {
  EXPIRED: 'OVERDUE',
  EXPIRING_SOON: 'DUE_SOON',
  VALID: 'HEALTHY',
  NONE: 'UNKNOWN',
}

function expiryLabel(status: ExpiryStatus, daysRemaining: number | null): string {
  if (status === 'NONE' || daysRemaining === null) return 'No expiry recorded'
  if (status === 'EXPIRED') {
    const d = Math.abs(daysRemaining)
    return `Expired ${d} day${d === 1 ? '' : 's'} ago`
  }
  if (daysRemaining === 0) return 'Expires today'
  return `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left`
}

const SEVERITY_LABEL = { MINOR: 'Minor', MAJOR: 'Major', DANGEROUS: 'Dangerous' } as const

export function OwnershipPanel({ vehicleId }: { vehicleId: string }) {
  const { workspace } = useSession()
  const [dialog, setDialog] = useState<null | 'inspection' | 'insurance' | 'tax'>(null)
  const mayWrite = can(workspace.role, 'ownership:write')

  const inspections = useQuery({
    queryKey: ['inspections', workspace.id, vehicleId],
    queryFn: () => api.ownership.inspections(workspace.id, vehicleId),
  })
  const insurance = useQuery({
    queryKey: ['insurance', workspace.id, vehicleId],
    queryFn: () => api.ownership.insurance(workspace.id, vehicleId),
  })
  const roadTax = useQuery({
    queryKey: ['road-tax', workspace.id, vehicleId],
    queryFn: () => api.ownership.roadTax(workspace.id, vehicleId),
  })

  const loading = inspections.isPending || insurance.isPending || roadTax.isPending
  if (loading) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <CardBody className="space-y-3 py-5">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </CardBody>
          </Card>
        ))}
      </div>
    )
  }

  const error = inspections.error ?? insurance.error ?? roadTax.error
  if (error) {
    return (
      <Card>
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load ownership records.'}
          requestId={error instanceof ApiError ? error.requestId : undefined}
          onRetry={() => {
            void inspections.refetch()
            void insurance.refetch()
            void roadTax.refetch()
          }}
        />
      </Card>
    )
  }

  // The server already returns newest-first; the first row is the one in force.
  const currentInspection = inspections.data?.[0] ?? null
  const currentInsurance = insurance.data?.[0] ?? null
  const currentTax = roadTax.data?.[0] ?? null

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <SummaryCard
          title="Inspection"
          subtitle={currentInspection?.inspectionType.replace(/_/g, ' ') ?? 'MOT'}
          status={currentInspection?.expiryStatus ?? 'NONE'}
          daysRemaining={currentInspection?.daysRemaining ?? null}
          expiresOn={currentInspection?.expiresOn ?? null}
          detail={currentInspection?.centreName}
          onAdd={mayWrite ? () => setDialog('inspection') : undefined}
          addLabel="Record an inspection"
        />
        <SummaryCard
          title="Insurance"
          subtitle={currentInsurance?.providerName ?? 'No cover recorded'}
          status={currentInsurance?.expiryStatus ?? 'NONE'}
          daysRemaining={currentInsurance?.daysRemaining ?? null}
          expiresOn={currentInsurance?.expiresOn ?? null}
          detail={
            currentInsurance && currentInsurance.premiumAmount !== undefined
              ? `${formatMoney(currentInsurance.premiumAmount, currentInsurance.currency ?? 'GBP')} premium`
              : currentInsurance?.coverType
          }
          onAdd={mayWrite ? () => setDialog('insurance') : undefined}
          addLabel="Add a policy"
        />
        <SummaryCard
          title="Road tax"
          subtitle={
            currentTax
              ? `${currentTax.countryCode} ${currentTax.taxType ?? ''}`.trim()
              : 'Not recorded'
          }
          status={currentTax?.expiryStatus ?? 'NONE'}
          daysRemaining={currentTax?.daysRemaining ?? null}
          expiresOn={currentTax?.expiresOn ?? null}
          detail={
            currentTax && currentTax.amount !== undefined
              ? formatMoney(currentTax.amount, currentTax.currency ?? 'GBP')
              : null
          }
          onAdd={mayWrite ? () => setDialog('tax') : undefined}
          addLabel="Record road tax"
        />
      </div>

      {currentInspection && currentInspection.advisories.length > 0 && (
        <AdvisoriesCard
          vehicleId={vehicleId}
          advisories={currentInspection.advisories}
          mayWrite={mayWrite}
        />
      )}

      <HistoryCard
        title="Inspection history"
        rows={(inspections.data ?? []).map((i) => ({
          id: i.id,
          primary: `${i.inspectionType.replace(/_/g, ' ')} — ${i.result.replace(/_/g, ' ').toLowerCase()}`,
          secondary: i.centreName ?? null,
          date: i.performedOn,
          expiresOn: i.expiresOn,
        }))}
        emptyTitle="No inspections recorded"
        emptyDescription="Add the last MOT or inspection certificate to start tracking its expiry."
      />

      <WarrantyPanel vehicleId={vehicleId} />

      <AddInspectionDialog
        open={dialog === 'inspection'}
        onClose={() => setDialog(null)}
        vehicleId={vehicleId}
      />
      <AddInsuranceDialog
        open={dialog === 'insurance'}
        onClose={() => setDialog(null)}
        vehicleId={vehicleId}
      />
      <AddRoadTaxDialog
        open={dialog === 'tax'}
        onClose={() => setDialog(null)}
        vehicleId={vehicleId}
      />
    </>
  )
}

function SummaryCard({
  title,
  subtitle,
  status,
  daysRemaining,
  expiresOn,
  detail,
  onAdd,
  addLabel,
}: {
  title: string
  subtitle: string
  status: ExpiryStatus
  daysRemaining: number | null
  expiresOn: string | null
  detail?: string | null
  onAdd?: () => void
  addLabel: string
}) {
  return (
    <Card className="flex min-w-0 flex-col">
      <CardBody className="flex flex-1 flex-col py-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">
            {title}
          </p>
          <StatusBadge status={STATUS_MAP[status]} />
        </div>
        <p className="mt-2 truncate text-[15px] font-semibold" title={subtitle}>
          {subtitle}
        </p>
        <p className="mt-1 text-[13px] text-content-secondary">
          {expiryLabel(status, daysRemaining)}
          {expiresOn && <span className="text-content-tertiary"> · {formatDate(expiresOn)}</span>}
        </p>
        {detail && <p className="mt-1 truncate text-[12.5px] text-content-tertiary">{detail}</p>}
        {onAdd && (
          <div className="mt-4 pt-1">
            <Button variant="secondary" onClick={onAdd}>
              {addLabel}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function AdvisoriesCard({
  vehicleId,
  advisories,
  mayWrite,
}: {
  vehicleId: string
  advisories: {
    id: string
    severity: keyof typeof SEVERITY_LABEL
    text: string
    isResolved: boolean
  }[]
  mayWrite: boolean
}) {
  const { workspace } = useSession()
  const queryClient = useQueryClient()
  const resolve = useMutation({
    mutationFn: ({ id, isResolved }: { id: string; isResolved: boolean }) =>
      api.ownership.resolveAdvisory(workspace.id, id, isResolved),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['inspections', workspace.id, vehicleId] }),
  })

  const open = advisories.filter((a) => !a.isResolved)
  return (
    <Card className="mt-6">
      <CardHeader
        title="Advisories"
        description={
          open.length
            ? `${open.length} outstanding from the latest inspection.`
            : 'All advisories from the latest inspection have been dealt with.'
        }
      />
      <ul className="divide-y divide-border-subtle border-t border-border-subtle">
        {advisories.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span
              className={
                a.severity === 'DANGEROUS'
                  ? 'rounded bg-status-overdue-subtle px-1.5 py-0.5 text-[11px] font-medium text-status-overdue'
                  : a.severity === 'MAJOR'
                    ? 'rounded bg-status-attention-subtle px-1.5 py-0.5 text-[11px] font-medium text-status-attention'
                    : 'rounded bg-surface-sunken px-1.5 py-0.5 text-[11px] font-medium text-content-secondary'
              }
            >
              {SEVERITY_LABEL[a.severity]}
            </span>
            <p
              className={`min-w-0 flex-1 text-[13px] ${a.isResolved ? 'text-content-tertiary line-through' : ''}`}
            >
              {a.text}
            </p>
            {mayWrite && (
              <Button
                variant="ghost"
                onClick={() => resolve.mutate({ id: a.id, isResolved: !a.isResolved })}
                loading={resolve.isPending && resolve.variables?.id === a.id}
              >
                {a.isResolved ? 'Reopen' : 'Mark done'}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

function HistoryCard({
  title,
  rows,
  emptyTitle,
  emptyDescription,
}: {
  title: string
  rows: {
    id: string
    primary: string
    secondary: string | null
    date: string | null
    expiresOn: string | null
  }[]
  emptyTitle: string
  emptyDescription: string
}) {
  return (
    <Card className="mt-6">
      <CardHeader title={title} />
      {rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <ul className="divide-y divide-border-subtle border-t border-border-subtle">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium capitalize">{r.primary}</p>
                {r.secondary && (
                  <p className="truncate text-[12.5px] text-content-secondary">{r.secondary}</p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[12.5px] text-content-secondary">{formatDate(r.date)}</p>
                {r.expiresOn && (
                  <p className="text-[12px] text-content-tertiary">
                    expires {formatDate(r.expiresOn)}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** Shared submit plumbing: the three add-forms differ only in their fields. */
function useOwnershipMutation(
  vehicleId: string,
  key: string,
  submit: (ws: string, vehicleId: string, input: Record<string, unknown>) => Promise<unknown>,
  onDone: () => void,
) {
  const { workspace } = useSession()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const mutation = useMutation({
    mutationFn: (input: Record<string, unknown>) => submit(workspace.id, vehicleId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [key, workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['reminders', workspace.id] }),
        // A premium or tax amount projects into the expense ledger (OWN-008).
        queryClient.invalidateQueries({ queryKey: ['expenses', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', workspace.id] }),
      ])
      onDone()
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors)
        setError(Object.keys(err.fieldErrors).length ? null : err.message)
      } else {
        setError('Could not save. Please try again.')
      }
    },
  })
  return { mutation, error, setError, fieldErrors, setFieldErrors }
}

/** Trims, drops empties, and returns a plain object ready for the API. */
function formValues(form: HTMLFormElement): Record<string, string> {
  const fd = new FormData(form)
  const out: Record<string, string> = {}
  for (const [k, v] of fd.entries()) {
    const value = typeof v === 'string' ? v.trim() : ''
    if (value) out[k] = value
  }
  return out
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="mb-4 rounded-md border border-status-overdue/30 bg-status-overdue-subtle px-3 py-2 text-[13px] text-status-overdue"
    >
      {message}
    </div>
  )
}

function DialogForm({
  onSubmit,
  pending,
  onCancel,
  children,
}: {
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  pending: boolean
  onCancel: () => void
  children: ReactNode
}) {
  return (
    <form onSubmit={onSubmit} noValidate>
      {children}
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          Save
        </Button>
      </div>
    </form>
  )
}

function AddInspectionDialog({
  open,
  onClose,
  vehicleId,
}: {
  open: boolean
  onClose: () => void
  vehicleId: string
}) {
  const { mutation, error, fieldErrors } = useOwnershipMutation(
    vehicleId,
    'inspections',
    (ws, v, input) => api.ownership.createInspection(ws, v, input),
    onClose,
  )
  const [advisories, setAdvisories] = useState<{ severity: string; text: string }[]>([])

  return (
    <Dialog open={open} onClose={onClose} title="Record an inspection" size="md">
      <DialogForm
        pending={mutation.isPending}
        onCancel={onClose}
        onSubmit={(e) => {
          e.preventDefault()
          const raw = formValues(e.currentTarget)
          mutation.mutate({
            inspectionType: raw.inspectionType,
            result: raw.result,
            performedOn: raw.performedOn,
            ...(raw.expiresOn ? { expiresOn: raw.expiresOn } : {}),
            ...(raw.odometer ? { odometer: Number(raw.odometer) } : {}),
            ...(raw.centreName ? { centreName: raw.centreName } : {}),
            ...(raw.certificateNumber ? { certificateNumber: raw.certificateNumber } : {}),
            ...(advisories.length ? { advisories: advisories.filter((a) => a.text.trim()) } : {}),
          })
        }}
      >
        <FormError message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField name="inspectionType" label="Type" defaultValue="MOT">
            <option value="MOT">MOT (UK)</option>
            <option value="ITP">ITP (Romania)</option>
            <option value="TUV">TÜV (Germany)</option>
            <option value="CT">CT (France)</option>
            <option value="STATE_INSPECTION">State inspection</option>
            <option value="EMISSIONS">Emissions</option>
            <option value="OTHER">Other</option>
          </SelectField>
          <SelectField name="result" label="Result" defaultValue="PASS">
            <option value="PASS">Pass</option>
            <option value="PASS_WITH_ADVISORIES">Pass with advisories</option>
            <option value="FAIL">Fail</option>
            <option value="UNKNOWN">Not recorded</option>
          </SelectField>
          <TextField
            name="performedOn"
            label="Date tested"
            type="date"
            required
            error={fieldErrors.performedOn}
          />
          <TextField
            name="expiresOn"
            label="Expires"
            type="date"
            hint="When the certificate runs out"
            error={fieldErrors.expiresOn}
          />
          <TextField name="odometer" label="Mileage" type="number" inputMode="numeric" />
          <TextField name="centreName" label="Test centre" />
          <TextField
            name="certificateNumber"
            label="Certificate number"
            className="sm:col-span-2"
          />
        </div>

        <div className="mt-5 border-t border-border-subtle pt-4">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium">Advisories</p>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAdvisories((a) => [...a, { severity: 'MINOR', text: '' }])}
            >
              Add advisory
            </Button>
          </div>
          {advisories.length === 0 && (
            <p className="mt-1 text-[12.5px] text-content-secondary">
              Anything the tester noted but did not fail the vehicle for.
            </p>
          )}
          {advisories.map((a, i) => (
            <div key={i} className="mt-3 flex gap-2">
              <select
                aria-label={`Advisory ${i + 1} severity`}
                value={a.severity}
                onChange={(e) =>
                  setAdvisories((prev) =>
                    prev.map((p, j) => (j === i ? { ...p, severity: e.target.value } : p)),
                  )
                }
                className="h-11 shrink-0 rounded-md border border-border-default bg-surface-raised px-2 text-sm"
              >
                <option value="MINOR">Minor</option>
                <option value="MAJOR">Major</option>
                <option value="DANGEROUS">Dangerous</option>
              </select>
              <input
                aria-label={`Advisory ${i + 1} description`}
                value={a.text}
                placeholder="Nearside front tyre close to the limit"
                onChange={(e) =>
                  setAdvisories((prev) =>
                    prev.map((p, j) => (j === i ? { ...p, text: e.target.value } : p)),
                  )
                }
                className="h-11 min-w-0 flex-1 rounded-md border border-border-default bg-surface-raised px-3 text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() => setAdvisories((prev) => prev.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      </DialogForm>
    </Dialog>
  )
}

function AddInsuranceDialog({
  open,
  onClose,
  vehicleId,
}: {
  open: boolean
  onClose: () => void
  vehicleId: string
}) {
  const { mutation, error, fieldErrors } = useOwnershipMutation(
    vehicleId,
    'insurance',
    (ws, v, input) => api.ownership.createInsurance(ws, v, input),
    onClose,
  )
  return (
    <Dialog open={open} onClose={onClose} title="Add an insurance policy" size="md">
      <DialogForm
        pending={mutation.isPending}
        onCancel={onClose}
        onSubmit={(e) => {
          e.preventDefault()
          const raw = formValues(e.currentTarget)
          mutation.mutate({
            providerName: raw.providerName,
            startsOn: raw.startsOn,
            ...(raw.expiresOn ? { expiresOn: raw.expiresOn } : {}),
            ...(raw.policyNumber ? { policyNumber: raw.policyNumber } : {}),
            ...(raw.coverType ? { coverType: raw.coverType } : {}),
            ...(raw.premiumAmount ? { premiumAmount: raw.premiumAmount } : {}),
            ...(raw.excessAmount ? { excessAmount: raw.excessAmount } : {}),
            ...(raw.renewalType ? { renewalType: raw.renewalType } : {}),
            ...(raw.coverageNotes ? { coverageNotes: raw.coverageNotes } : {}),
          })
        }}
      >
        <FormError message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="providerName"
            label="Insurer"
            required
            placeholder="Direct Line"
            error={fieldErrors.providerName}
          />
          <TextField name="policyNumber" label="Policy number" />
          <TextField
            name="startsOn"
            label="Starts"
            type="date"
            required
            error={fieldErrors.startsOn}
          />
          <TextField name="expiresOn" label="Expires" type="date" error={fieldErrors.expiresOn} />
          <TextField name="coverType" label="Cover" placeholder="Comprehensive" />
          <SelectField name="renewalType" label="Renewal" defaultValue="UNKNOWN">
            <option value="UNKNOWN">Not sure</option>
            <option value="MANUAL">I renew it myself</option>
            <option value="AUTOMATIC">Renews automatically</option>
          </SelectField>
          <TextField
            name="premiumAmount"
            label="Premium"
            inputMode="decimal"
            placeholder="499.99"
            error={fieldErrors.premiumAmount}
          />
          <TextField name="excessAmount" label="Excess" inputMode="decimal" placeholder="250.00" />
          <TextAreaField name="coverageNotes" label="Notes" className="sm:col-span-2" />
        </div>
      </DialogForm>
    </Dialog>
  )
}

function AddRoadTaxDialog({
  open,
  onClose,
  vehicleId,
}: {
  open: boolean
  onClose: () => void
  vehicleId: string
}) {
  const { mutation, error, fieldErrors } = useOwnershipMutation(
    vehicleId,
    'road-tax',
    (ws, v, input) => api.ownership.createRoadTax(ws, v, input),
    onClose,
  )
  return (
    <Dialog open={open} onClose={onClose} title="Record road tax" size="md">
      <DialogForm
        pending={mutation.isPending}
        onCancel={onClose}
        onSubmit={(e) => {
          e.preventDefault()
          const raw = formValues(e.currentTarget)
          mutation.mutate({
            countryCode: raw.countryCode || 'GB',
            startsOn: raw.startsOn,
            ...(raw.expiresOn ? { expiresOn: raw.expiresOn } : {}),
            ...(raw.taxType ? { taxType: raw.taxType } : {}),
            ...(raw.reference ? { reference: raw.reference } : {}),
            ...(raw.amount ? { amount: raw.amount } : {}),
            ...(raw.notes ? { notes: raw.notes } : {}),
          })
        }}
      >
        <FormError message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="countryCode"
            label="Country"
            defaultValue="GB"
            hint="Two-letter code"
            className="uppercase"
            error={fieldErrors.countryCode}
          />
          <TextField name="taxType" label="Type" placeholder="Vehicle Excise Duty" />
          <TextField
            name="startsOn"
            label="Starts"
            type="date"
            required
            error={fieldErrors.startsOn}
          />
          <TextField name="expiresOn" label="Expires" type="date" error={fieldErrors.expiresOn} />
          <TextField name="amount" label="Amount" inputMode="decimal" placeholder="180.00" />
          <TextField name="reference" label="Reference" />
          <TextAreaField name="notes" label="Notes" className="sm:col-span-2" />
        </div>
      </DialogForm>
    </Dialog>
  )
}
