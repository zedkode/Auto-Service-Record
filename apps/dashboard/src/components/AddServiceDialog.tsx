import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Dialog,
  SelectField,
  TextAreaField,
  TextField,
  formatMoney,
} from '@autoservices/ui'
import { ApiError } from '@autoservices/api-client'
import { createServiceSchema } from '@autoservices/validation'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'

interface PartRow {
  name: string
  brand: string
  partNumber: string
  quantity: string
  unitPrice: string
}

const emptyPart = (): PartRow => ({
  name: '',
  brand: '',
  partNumber: '',
  quantity: '1',
  unitPrice: '',
})

/**
 * The most-used form in the product, so it is deliberately short by default: date,
 * mileage, what was done. Everything else is behind "More details" (UI_UX.md §5.5).
 */
export function AddServiceDialog({
  open,
  onClose,
  vehicleId,
  currentOdometer,
  distanceUnit,
  defaultCurrency,
}: {
  open: boolean
  onClose: () => void
  vehicleId: string
  currentOdometer: number | null
  distanceUnit: 'MILES' | 'KILOMETERS'
  defaultCurrency: string
}) {
  const { workspace } = useSession()
  const queryClient = useQueryClient()
  const today = new Date().toISOString().slice(0, 10)

  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [showMore, setShowMore] = useState(false)
  const [parts, setParts] = useState<PartRow[]>([])

  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setError(null)
      setFieldErrors({})
      setShowMore(false)
      setParts([])
    }
  }

  const categories = useQuery({
    queryKey: ['service-categories', workspace.id],
    queryFn: () => api.services.categories(workspace.id),
    staleTime: 10 * 60_000,
  })

  const create = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.services.create(workspace.id, vehicleId, input),
    onSuccess: async () => {
      // A service touches mileage, maintenance, the timeline and costs — refresh all of
      // them rather than leaving the user looking at stale numbers.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['services', workspace.id] }),
        queryClient.invalidateQueries({ queryKey: ['vehicle-services', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['maintenance', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['maintenance-due', workspace.id] }),
        queryClient.invalidateQueries({ queryKey: ['timeline', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['odometer', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['odometer-current', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['vehicle', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['vehicles', workspace.id] }),
        queryClient.invalidateQueries({ queryKey: ['cost-summary', workspace.id, vehicleId] }),
        // A service with a total projects itself into the expense ledger (OWN-008), so
        // the Expenses tab is stale the moment this succeeds.
        queryClient.invalidateQueries({ queryKey: ['expenses', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', workspace.id] }),
      ])
      onClose()
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const f = err.fieldErrors
        if (Object.keys(f).length) setFieldErrors(f)
        else setError(err.message)
      } else {
        setError('Could not save the service. Please try again.')
      }
    },
  })

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    const fd = new FormData(e.currentTarget)
    const str = (k: string) => String(fd.get(k) ?? '').trim()
    const num = (k: string) => (str(k) ? Number(str(k)) : undefined)

    const input: Record<string, unknown> = {
      performedOn: str('performedOn'),
      title: str('title'),
      currency: str('currency') || defaultCurrency,
    }
    if (str('categoryId')) input.categoryId = str('categoryId')
    if (num('odometer') !== undefined) {
      input.odometer = num('odometer')
      input.odometerUnit = distanceUnit
    }
    for (const k of ['description', 'workshopName', 'mechanicName', 'notes']) {
      if (str(k)) input[k] = str(k)
    }
    for (const k of ['labourTotal', 'partsTotal', 'taxTotal', 'totalAmount']) {
      if (str(k)) input[k] = str(k)
    }
    const validParts = parts.filter((p) => p.name.trim())
    if (validParts.length) {
      input.parts = validParts.map((p) => ({
        name: p.name.trim(),
        ...(p.brand.trim() ? { brand: p.brand.trim() } : {}),
        ...(p.partNumber.trim() ? { partNumber: p.partNumber.trim() } : {}),
        quantity: Number(p.quantity) || 1,
        ...(p.unitPrice.trim() ? { unitPrice: p.unitPrice.trim() } : {}),
      }))
    }

    // Validated with the same schema the server uses.
    const parsed = createServiceSchema.safeParse(input)
    if (!parsed.success) {
      const out: Record<string, string> = {}
      for (const i of parsed.error.issues) {
        const key = i.path.join('.')
        if (key && !out[key]) out[key] = i.message
      }
      setFieldErrors(out)
      return
    }
    create.mutate(input)
  }

  const partsSubtotal = parts.reduce((sum, p) => {
    const q = Number(p.quantity) || 0
    const u = Number(p.unitPrice) || 0
    return sum + q * u
  }, 0)

  return (
    <Dialog open={open} onClose={onClose} title="Record a service" size="lg">
      <form id="add-service-form" onSubmit={onSubmit} noValidate>
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
            name="performedOn"
            label="Date"
            type="date"
            required
            defaultValue={today}
            max={today}
            error={fieldErrors.performedOn}
          />
          <TextField
            name="odometer"
            label={`Mileage (${distanceUnit === 'MILES' ? 'mi' : 'km'})`}
            type="number"
            inputMode="numeric"
            placeholder={currentOdometer !== null ? String(currentOdometer) : undefined}
            hint="Adds a reading to the vehicle's history"
            error={fieldErrors.odometer}
          />
          <TextField
            name="title"
            label="What was done"
            required
            autoFocus
            className="sm:col-span-2"
            placeholder="Engine oil and filter change"
            error={fieldErrors.title}
          />
          <SelectField
            name="categoryId"
            label="Category"
            defaultValue=""
            className="sm:col-span-2"
            hint="Choosing a category advances the matching maintenance item automatically"
            error={fieldErrors.categoryId}
          >
            <option value="">No category</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
          <TextField
            name="workshopName"
            label="Workshop"
            placeholder="Smith & Sons Garage"
            error={fieldErrors.workshopName}
          />
          <TextField
            name="totalAmount"
            label={`Total (${defaultCurrency})`}
            inputMode="decimal"
            placeholder="129.00"
            error={fieldErrors.totalAmount}
          />
        </div>

        <div className="mt-5 border-t border-border-subtle pt-4">
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={showMore}
            className="flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
          >
            <span aria-hidden="true">{showMore ? '−' : '+'}</span>
            {showMore ? 'Hide extra details' : 'More details, parts and cost breakdown'}
          </button>

          {showMore && (
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField
                  name="labourTotal"
                  label="Labour"
                  inputMode="decimal"
                  placeholder="45.00"
                  error={fieldErrors.labourTotal}
                />
                <TextField
                  name="partsTotal"
                  label="Parts"
                  inputMode="decimal"
                  placeholder="84.00"
                  error={fieldErrors.partsTotal}
                />
                <TextField
                  name="taxTotal"
                  label="Tax"
                  inputMode="decimal"
                  error={fieldErrors.taxTotal}
                />
              </div>
              <p className="-mt-2 text-[12px] text-content-tertiary">
                The breakdown is informational — it does not need to add up to the total. Real
                invoices include discounts and rounding.
              </p>

              <TextField name="mechanicName" label="Mechanic" error={fieldErrors.mechanicName} />
              <TextAreaField
                name="description"
                label="Description"
                placeholder="Castrol Edge 5W-30, Mann filter"
                error={fieldErrors.description}
              />
              <TextAreaField name="notes" label="Notes" error={fieldErrors.notes} />

              {/* Parts */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[13px] font-medium">Parts fitted</span>
                  {partsSubtotal > 0 && (
                    <span className="tabular text-[12.5px] text-content-secondary">
                      Subtotal {formatMoney(partsSubtotal.toFixed(2), defaultCurrency)}
                    </span>
                  )}
                </div>
                {parts.length === 0 && (
                  <p className="mb-2 text-[12.5px] text-content-tertiary">
                    Optional. Recording part numbers makes future replacements easy to look up.
                  </p>
                )}
                <div className="space-y-2">
                  {parts.map((p, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2">
                      <input
                        aria-label={`Part ${i + 1} name`}
                        placeholder="Part name"
                        className="col-span-4 h-8 rounded-md border border-border-default bg-surface-raised px-2 text-[13px]"
                        value={p.name}
                        onChange={(e) =>
                          setParts((s) =>
                            s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                          )
                        }
                      />
                      <input
                        aria-label={`Part ${i + 1} brand`}
                        placeholder="Brand"
                        className="col-span-3 h-8 rounded-md border border-border-default bg-surface-raised px-2 text-[13px]"
                        value={p.brand}
                        onChange={(e) =>
                          setParts((s) =>
                            s.map((x, j) => (j === i ? { ...x, brand: e.target.value } : x)),
                          )
                        }
                      />
                      <input
                        aria-label={`Part ${i + 1} number`}
                        placeholder="Part no."
                        className="col-span-2 h-8 rounded-md border border-border-default bg-surface-raised px-2 font-mono text-[12px]"
                        value={p.partNumber}
                        onChange={(e) =>
                          setParts((s) =>
                            s.map((x, j) => (j === i ? { ...x, partNumber: e.target.value } : x)),
                          )
                        }
                      />
                      <input
                        aria-label={`Part ${i + 1} price`}
                        placeholder="Price"
                        inputMode="decimal"
                        className="col-span-2 h-8 rounded-md border border-border-default bg-surface-raised px-2 text-[13px]"
                        value={p.unitPrice}
                        onChange={(e) =>
                          setParts((s) =>
                            s.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)),
                          )
                        }
                      />
                      <button
                        type="button"
                        aria-label={`Remove part ${i + 1}`}
                        className="col-span-1 h-8 rounded-md text-content-tertiary hover:bg-surface-sunken hover:text-status-overdue"
                        onClick={() => setParts((s) => s.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={() => setParts((s) => [...s, emptyPart()])}
                >
                  Add a part
                </Button>
              </div>
            </div>
          )}
        </div>
        <input type="hidden" name="currency" value={defaultCurrency} />
      </form>

      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" form="add-service-form" variant="primary" loading={create.isPending}>
          Save service
        </Button>
      </div>
    </Dialog>
  )
}
