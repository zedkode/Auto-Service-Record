import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  formatDate,
} from '@autoservices/ui'
import { ApiError, type VaultDocument } from '@autoservices/api-client'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'
import { PageHeader } from '../components/PageHeader.js'

const TYPE_LABEL: Record<string, string> = {
  INVOICE: 'Invoice',
  RECEIPT: 'Receipt',
  INSURANCE_POLICY: 'Insurance',
  INSPECTION_CERTIFICATE: 'Certificate',
  REGISTRATION: 'Registration',
  WARRANTY: 'Warranty',
  MANUAL: 'Manual',
  PHOTO: 'Photo',
  OTHER: 'Document',
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Every document in the workspace. Uploading happens on the vehicle it belongs to. */
export function DocumentsPage() {
  const { workspace } = useSession()

  const documents = useQuery({
    queryKey: ['documents-all', workspace.id],
    queryFn: () => api.documents.list(workspace.id),
  })
  const vehicles = useQuery({
    queryKey: ['vehicles', workspace.id],
    queryFn: () => api.vehicles.list(workspace.id),
  })

  const vehicleName = (id: string | null) => {
    if (!id) return null
    const v = vehicles.data?.find((x) => x.id === id)
    return v ? `${v.manufacturer} ${v.model}` : null
  }

  return (
    <>
      <PageHeader
        title="Documents"
        description="Everything stored across your vehicles. Files are private and links expire after five minutes."
      />

      <Card>
        <CardHeader
          title="All documents"
          description="Upload from a vehicle's Documents tab so the file stays with the right vehicle."
        />
        {documents.isPending ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : documents.error ? (
          <ErrorState
            message={
              documents.error instanceof ApiError
                ? documents.error.message
                : 'Could not load documents.'
            }
            onRetry={() => void documents.refetch()}
          />
        ) : documents.data.length === 0 ? (
          <EmptyState
            title="No documents yet"
            description="Open a vehicle and use its Documents tab to upload an invoice or certificate."
          />
        ) : (
          <ul className="divide-y divide-border-subtle border-t border-border-subtle">
            {documents.data.map((d) => (
              <DocumentRow key={d.id} document={d} vehicleName={vehicleName(d.vehicleId)} />
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}

function DocumentRow({
  document: doc,
  vehicleName,
}: {
  document: VaultDocument
  vehicleName: string | null
}) {
  const { workspace } = useSession()
  const [busy, setBusy] = useState(false)

  async function open() {
    setBusy(true)
    try {
      const link = await api.documents.downloadUrl(workspace.id, doc.id)
      window.open(link.url, '_blank', 'noopener,noreferrer')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{doc.title ?? doc.filename}</p>
        <p className="truncate text-[12.5px] text-content-secondary">
          {TYPE_LABEL[doc.documentType] ?? 'Document'} · {formatSize(doc.byteSize)}
          {doc.documentDate && ` · ${formatDate(doc.documentDate)}`}
        </p>
      </div>
      {doc.vehicleId && vehicleName && (
        <Link
          to={`/vehicles/${doc.vehicleId}?tab=documents`}
          className="shrink-0 text-[12.5px] font-medium text-accent hover:underline"
        >
          {vehicleName}
        </Link>
      )}
      <Button variant="secondary" onClick={() => void open()} loading={busy}>
        Open
      </Button>
    </li>
  )
}
