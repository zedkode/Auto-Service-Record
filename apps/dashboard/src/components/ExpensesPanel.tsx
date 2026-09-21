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
  TextAreaField,
  TextField,
  formatDate,
  formatMoney,
} from '@autoservices/ui'
import { ApiError, type Expense } from '@autoservices/api-client'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'

/**
 * OWN-007/008 — the cost ledger for one vehicle.
 *
 * Rows arrive from two places: costs the user entered, and costs *projected* from a
 * service, policy or tax record. Projections are labelled and read-only — editing one
 * here would be silently undone the next time its source changed — so the panel points
 * at the source record instead of offering an edit that will not stick.
 */
export function ExpensesPanel({ vehicleId }: { vehicleId: string }) {
  const { workspace } = useSession()
  const [addOpen, setAddOpen] = useState(false)
  const mayWrite = can(workspace.role, 'expense:write')

  const expenses = useQuery({
    queryKey: ['expenses', workspace.id, vehicleId],
    queryFn: () => api.expenses.list(workspace.id, { vehicleId }),
  })

  if (expenses.isPending) {
    return (
      <Card>
        <CardBody className="space-y-3 py-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardBody>
      </Card>
    )
  }

  if (expenses.error) {
    return (
      <Card>
        <ErrorState
          message={
            expenses.error instanceof ApiError ? expenses.error.message : 'Could not load costs.'
          }
          requestId={expenses.error instanceof ApiError ? expenses.error.requestId : undefined}
          onRetry={() => void expenses.refetch()}
        />
      </Card>
    )
  }

  const rows = expenses.data
  const currencies = new Set(rows.map((r) => r.currency))
  const total = rows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0)
  const projectedCount = rows.filter((r) => r.isProjected).length

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">
            Total recorded
          </p>
          {currencies.size > 1 ? (
            // Summing across currencies needs a rate the platform does not hold; saying
            // so beats presenting a number that means nothing.
            <p className="mt-1 text-[15px] font-semibold">Multiple currencies</p>
          ) : (
            <p className="tabular mt-1 text-2xl font-semibold leading-none tracking-tight">
              {formatMoney(total.toFixed(2), [...currencies][0] ?? workspace.defaultCurrency)}
            </p>
          )}
          <p className="mt-1.5 text-[12.5px] text-content-secondary">
            {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}
            {projectedCount > 0 && `, ${projectedCount} from service and ownership records`}
          </p>
        </div>
        {mayWrite && <Button onClick={() => setAddOpen(true)}>Add a cost</Button>}
      </div>

      <Card>
        <CardHeader
          title="Costs"
          description="Everything this vehicle has cost, including costs carried over from its service history, insurance and tax."
        />
        {rows.length === 0 ? (
          <EmptyState
            title="No costs recorded"
            description={
              mayWrite
                ? 'Add a cost, or record a service with a total and it will appear here automatically.'
                : 'Nothing has been recorded for this vehicle yet.'
            }
          />
        ) : (
          <ul className="divide-y divide-border-subtle border-t border-border-subtle">
            {rows.map((r) => (
              <ExpenseRow key={r.id} expense={r} vehicleId={vehicleId} mayWrite={mayWrite} />
            ))}
          </ul>
        )}
      </Card>

      <AddExpenseDialog open={addOpen} onClose={() => setAddOpen(false)} vehicleId={vehicleId} />
    </>
  )
}

const SOURCE_LABEL: Record<string, string> = {
  SERVICE: 'From service',
  INSURANCE: 'From insurance',
  TAX: 'From road tax',
  FUEL: 'From fuel',
  OTHER: 'Derived',
}

function ExpenseRow({
  expense,
  vehicleId,
  mayWrite,
}: {
  expense: Expense
  vehicleId: string
  mayWrite: boolean
}) {
  const { workspace } = useSession()
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => api.expenses.remove(workspace.id, expense.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['expenses', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', workspace.id] }),
      ])
    },
  })

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">
          {expense.description ?? expense.categoryName ?? 'Cost'}
        </p>
        <p className="truncate text-[12.5px] text-content-secondary">
          {[expense.categoryName, expense.vendorName].filter(Boolean).join(' · ') || '—'}
        </p>
      </div>
      {expense.isProjected && (
        <Badge className="shrink-0">{SOURCE_LABEL[expense.sourceType] ?? 'Derived'}</Badge>
      )}
      <div className="shrink-0 text-right">
        <p className="tabular text-[13px] font-medium">
          {formatMoney(expense.amount, expense.currency)}
        </p>
        <p className="text-[12px] text-content-secondary">{formatDate(expense.incurredOn)}</p>
      </div>
      {mayWrite && !expense.isProjected && (
        <Button variant="ghost" onClick={() => remove.mutate()} loading={remove.isPending}>
          Remove
        </Button>
      )}
    </li>
  )
}

function AddExpenseDialog({
  open,
  onClose,
  vehicleId,
}: {
  open: boolean
  onClose: () => void
  vehicleId: string
}) {
  const { workspace } = useSession()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const categories = useQuery({
    queryKey: ['expense-categories', workspace.id],
    queryFn: () => api.expenses.categories(workspace.id),
    enabled: open,
  })

  const create = useMutation({
    mutationFn: (input: Record<string, unknown>) => api.expenses.create(workspace.id, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['expenses', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', workspace.id] }),
      ])
      onClose()
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors)
        setError(Object.keys(err.fieldErrors).length ? null : err.message)
      } else {
        setError('Could not save the cost. Please try again.')
      }
    },
  })

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    const fd = new FormData(e.currentTarget)
    const raw = Object.fromEntries(
      [...fd.entries()].map(([k, v]) => [k, typeof v === 'string' ? v.trim() : '']),
    ) as Record<string, string>

    create.mutate({
      vehicleId,
      incurredOn: raw.incurredOn,
      amount: raw.amount,
      currency: raw.currency || workspace.defaultCurrency,
      ...(raw.categoryId ? { categoryId: raw.categoryId } : {}),
      ...(raw.vendorName ? { vendorName: raw.vendorName } : {}),
      ...(raw.description ? { description: raw.description } : {}),
    })
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add a cost" size="md">
      <form onSubmit={onSubmit} noValidate>
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-status-overdue/30 bg-status-overdue-subtle px-3 py-2 text-[13px] text-status-overdue"
          >
            {error}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="incurredOn"
            label="Date"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
            error={fieldErrors.incurredOn}
          />
          <TextField
            name="amount"
            label="Amount"
            inputMode="decimal"
            required
            placeholder="42.50"
            error={fieldErrors.amount}
          />
          <SelectField name="categoryId" label="Category" defaultValue="">
            <option value="">Not categorised</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
          <TextField
            name="currency"
            label="Currency"
            defaultValue={workspace.defaultCurrency}
            className="uppercase"
            error={fieldErrors.currency}
          />
          <TextField name="vendorName" label="Paid to" placeholder="Car wash" />
          <TextAreaField name="description" label="What was it for?" className="sm:col-span-2" />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
