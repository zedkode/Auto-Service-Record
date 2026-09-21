import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  buttonClassName,
  Card,
  CardBody,
  SelectField,
  TextAreaField,
  TextField,
} from '@autoservices/ui'
import { ApiError } from '@autoservices/api-client'
import { createVehicleSchema } from '@autoservices/validation'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'
import { PageHeader } from '../components/PageHeader.js'

const FUEL_TYPES = [
  'PETROL',
  'DIESEL',
  'HYBRID',
  'PLUGIN_HYBRID',
  'ELECTRIC',
  'LPG',
  'CNG',
  'HYDROGEN',
  'OTHER',
]
const TRANSMISSIONS = ['MANUAL', 'AUTOMATIC', 'SEMI_AUTOMATIC', 'CVT', 'DCT', 'OTHER']

const label = (v: string) =>
  v
    .split('_')
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(' ')

export function NewVehiclePage() {
  const { workspace } = useSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [showMore, setShowMore] = useState(false)

  const create = useMutation({
    mutationFn: (input: Record<string, unknown>) => api.vehicles.create(workspace.id, input),
    onSuccess: async (vehicle) => {
      await queryClient.invalidateQueries({ queryKey: ['vehicles', workspace.id] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard', workspace.id] })
      navigate(`/vehicles/${vehicle.id}`)
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors)
        // A field-level error is already shown next to its input; only surface the
        // banner when there is nothing more specific to point at.
        setFormError(Object.keys(err.fieldErrors).length ? null : err.message)
      } else {
        setFormError('Could not save the vehicle. Please try again.')
      }
    },
  })

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    setFormError(null)

    const fd = new FormData(e.currentTarget)
    const raw = Object.fromEntries(
      [...fd.entries()].map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]),
    ) as Record<string, string>

    const input: Record<string, unknown> = {
      manufacturer: raw.manufacturer,
      model: raw.model,
      distanceUnit: raw.distanceUnit || 'MILES',
    }
    // Optional fields are omitted entirely rather than sent as empty strings, which the
    // schema would (correctly) reject.
    const optionalText = [
      'trim',
      'generation',
      'registrationNumber',
      'vin',
      'engineName',
      'engineCode',
      'colour',
      'bodyType',
      'notes',
    ]
    for (const k of optionalText) if (raw[k]) input[k] = raw[k]
    const optionalEnum = ['fuelType', 'transmission']
    for (const k of optionalEnum) if (raw[k]) input[k] = raw[k]
    const optionalNum = ['modelYear', 'displacementCc', 'powerKw', 'currentOdometer']
    for (const k of optionalNum) if (raw[k]) input[k] = Number(raw[k])

    // Validate client-side with the SAME schema the server uses, so the user gets
    // immediate feedback and the server still re-validates.
    const parsed = createVehicleSchema.safeParse(input)
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.')
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message
      }
      setErrors(fieldErrors)
      return
    }

    create.mutate(input)
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Add a vehicle"
        description="Only the make and model are required. You can fill in the rest later."
      />

      <form onSubmit={onSubmit} noValidate>
        <Card>
          <CardBody className="pt-5">
            {formError && (
              <div
                role="alert"
                className="mb-4 rounded-md border border-status-overdue/30 bg-status-overdue-subtle px-3 py-2 text-[13px] text-status-overdue"
              >
                {formError}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                name="manufacturer"
                label="Manufacturer"
                required
                autoFocus
                placeholder="Ford"
                error={errors.manufacturer}
              />
              <TextField
                name="model"
                label="Model"
                required
                placeholder="Mondeo"
                error={errors.model}
              />
              <TextField
                name="trim"
                label="Trim"
                placeholder="Titanium X Sport"
                error={errors.trim}
              />
              <TextField
                name="modelYear"
                label="Year"
                type="number"
                inputMode="numeric"
                placeholder="2016"
                error={errors.modelYear}
              />
              <TextField
                name="registrationNumber"
                label="Registration"
                placeholder="AB16 CDE"
                error={errors.registrationNumber}
                className="uppercase"
              />
              <TextField
                name="vin"
                label="VIN"
                hint="17 characters, if you have it"
                placeholder="WF0EXXGBBEGR12345"
                error={errors.vin}
              />
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <TextField
                name="currentOdometer"
                label="Current mileage"
                type="number"
                inputMode="numeric"
                hint="Recorded as your first reading"
                placeholder="131260"
                error={errors.currentOdometer}
              />
              <SelectField
                name="distanceUnit"
                label="Units"
                defaultValue="MILES"
                error={errors.distanceUnit}
              >
                <option value="MILES">Miles</option>
                <option value="KILOMETERS">Kilometres</option>
              </SelectField>
            </div>

            <div className="mt-5 border-t border-border-subtle pt-4">
              <button
                type="button"
                onClick={() => setShowMore((v) => !v)}
                aria-expanded={showMore}
                className="flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
              >
                <span aria-hidden="true">{showMore ? '−' : '+'}</span>
                {showMore ? 'Hide extra details' : 'More details'}
              </button>

              {showMore && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <SelectField
                    name="fuelType"
                    label="Fuel type"
                    defaultValue=""
                    error={errors.fuelType}
                  >
                    <option value="">Not specified</option>
                    {FUEL_TYPES.map((f) => (
                      <option key={f} value={f}>
                        {label(f)}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField
                    name="transmission"
                    label="Transmission"
                    defaultValue=""
                    error={errors.transmission}
                  >
                    <option value="">Not specified</option>
                    {TRANSMISSIONS.map((t) => (
                      <option key={t} value={t}>
                        {label(t)}
                      </option>
                    ))}
                  </SelectField>
                  <TextField
                    name="engineName"
                    label="Engine"
                    placeholder="2.0 TDCi"
                    error={errors.engineName}
                  />
                  <TextField
                    name="engineCode"
                    label="Engine code"
                    placeholder="T8CC"
                    error={errors.engineCode}
                  />
                  <TextField
                    name="displacementCc"
                    label="Displacement (cc)"
                    type="number"
                    placeholder="1997"
                    error={errors.displacementCc}
                  />
                  <TextField
                    name="powerKw"
                    label="Power (kW)"
                    type="number"
                    placeholder="132"
                    error={errors.powerKw}
                  />
                  <TextField
                    name="colour"
                    label="Colour"
                    placeholder="Magnetic Grey"
                    error={errors.colour}
                  />
                  <TextField
                    name="bodyType"
                    label="Body type"
                    placeholder="Estate"
                    error={errors.bodyType}
                  />
                  <TextAreaField
                    name="notes"
                    label="Notes"
                    className="sm:col-span-2"
                    error={errors.notes}
                  />
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Link to="/vehicles" className={buttonClassName({ variant: 'ghost' })}>
            Cancel
          </Link>
          <Button type="submit" variant="primary" loading={create.isPending}>
            {create.isPending ? 'Saving…' : 'Add vehicle'}
          </Button>
        </div>
      </form>
    </div>
  )
}
