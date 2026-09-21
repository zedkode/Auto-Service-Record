import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Dialog, Skeleton, formatDate, formatDistance, formatMoney } from '@autoservices/ui'
import { ApiError } from '@autoservices/api-client'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'

export function ServiceDetailDialog({
  serviceId,
  onClose,
  vehicleId,
}: {
  serviceId: string | null
  onClose: () => void
  vehicleId: string
}) {
  const { workspace } = useSession()
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const service = useQuery({
    queryKey: ['service', workspace.id, serviceId],
    queryFn: () => api.services.get(workspace.id, serviceId!),
    enabled: serviceId !== null,
  })

  const remove = useMutation({
    mutationFn: () => api.services.remove(workspace.id, serviceId!),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vehicle-services', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['services', workspace.id] }),
        queryClient.invalidateQueries({ queryKey: ['timeline', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['cost-summary', workspace.id, vehicleId] }),
      ])
      setConfirmDelete(false)
      onClose()
    },
  })

  const s = service.data

  return (
    <Dialog
      open={serviceId !== null}
      onClose={() => {
        setConfirmDelete(false)
        onClose()
      }}
      title={s?.title ?? 'Service'}
      description={
        s
          ? `${formatDate(s.performedOn)}${s.workshopName ? ` · ${s.workshopName}` : ''}`
          : undefined
      }
      size="lg"
    >
      {service.isPending ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : service.error ? (
        <p className="text-[13px] text-status-overdue">
          {service.error instanceof ApiError
            ? service.error.message
            : 'Could not load this service.'}
        </p>
      ) : s ? (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            <Detail label="Date" value={formatDate(s.performedOn)} />
            <Detail
              label="Mileage"
              value={
                s.odometer !== null ? formatDistance(s.odometer, s.odometerUnit ?? 'MILES') : '—'
              }
            />
            <Detail label="Category" value={s.category?.name ?? '—'} />
            <Detail label="Workshop" value={s.workshopName ?? '—'} />
            <Detail label="Mechanic" value={s.mechanicName ?? '—'} />
            <Detail
              label="Warranty"
              value={s.warrantyMonths ? `${s.warrantyMonths} months` : '—'}
            />
          </dl>

          {s.description && (
            <div>
              <p className="text-[11.5px] font-medium uppercase tracking-wide text-content-tertiary">
                Description
              </p>
              <p className="mt-1 whitespace-pre-line text-[13.5px]">{s.description}</p>
            </div>
          )}

          {/* Cost breakdown. The total is authoritative; the parts do not have to sum
              to it, because real invoices carry discounts and rounding. */}
          <div className="rounded-lg border border-border-subtle bg-surface-sunken/40 p-4">
            <p className="mb-2 text-[11.5px] font-medium uppercase tracking-wide text-content-tertiary">
              Cost
            </p>
            <dl className="space-y-1.5 text-[13px]">
              <Row label="Parts" value={formatMoney(s.partsTotal, s.currency)} />
              <Row label="Labour" value={formatMoney(s.labourTotal, s.currency)} />
              <Row label="Tax" value={formatMoney(s.taxTotal, s.currency)} />
              <div className="border-t border-border-default pt-1.5">
                <Row label="Total" value={formatMoney(s.totalAmount, s.currency)} strong />
              </div>
            </dl>
          </div>

          {s.parts.length > 0 && (
            <div>
              <p className="mb-2 text-[11.5px] font-medium uppercase tracking-wide text-content-tertiary">
                Parts fitted
              </p>
              <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
                {s.parts.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{p.name}</p>
                      <p className="text-[12px] text-content-tertiary">
                        {[p.brand, p.partNumber && `no. ${p.partNumber}`, `×${Number(p.quantity)}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <span className="tabular shrink-0 text-[13px]">
                      {formatMoney(p.unitPrice, p.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(s.nextServiceOn || s.nextServiceOdometer) && (
            <div className="rounded-lg border border-accent-border bg-accent-subtle px-4 py-3">
              <p className="text-[12px] font-medium text-accent">Next service recommended</p>
              <p className="mt-0.5 text-[13px]">
                {[
                  s.nextServiceOn && formatDate(s.nextServiceOn),
                  s.nextServiceOdometer !== null &&
                    formatDistance(s.nextServiceOdometer, s.odometerUnit ?? 'MILES'),
                ]
                  .filter(Boolean)
                  .join(' or ')}
              </p>
            </div>
          )}

          {s.notes && (
            <div>
              <p className="text-[11.5px] font-medium uppercase tracking-wide text-content-tertiary">
                Notes
              </p>
              <p className="mt-1 whitespace-pre-line text-[13.5px]">{s.notes}</p>
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-5 flex items-center justify-between gap-2">
        {confirmDelete ? (
          <div className="flex w-full items-center justify-between gap-3">
            <p className="text-[13px] text-content-secondary">
              Remove this record? It is hidden from history but kept for audit.
            </p>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
              Remove record
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </>
        )}
      </div>
    </Dialog>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11.5px] font-medium uppercase tracking-wide text-content-tertiary">
        {label}
      </dt>
      <dd className="mt-0.5 text-[13.5px]">{value}</dd>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className={strong ? 'font-medium' : 'text-content-secondary'}>{label}</dt>
      <dd className={`tabular ${strong ? 'font-semibold' : ''}`}>{value}</dd>
    </div>
  )
}
