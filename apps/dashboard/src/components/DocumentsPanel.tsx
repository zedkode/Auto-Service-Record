import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { can } from '@autoservices/permissions'
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

/**
 * DOC-107 — the document vault for one vehicle.
 *
 * Files never travel through our API. The browser asks for an upload session, PUTs the
 * bytes straight to object storage with a short-lived signed URL, then asks the API to
 * verify and publish the row. Downloads work the same way in reverse, and the link is
 * valid for five minutes (SECURITY.md §10).
 */

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic'
const MAX_BYTES = 20 * 1024 * 1024

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

/** SHA-256 of the file, computed in the browser so the server can verify what arrived. */
async function checksumOf(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function DocumentsPanel({ vehicleId }: { vehicleId: string }) {
  const { workspace } = useSession()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)

  const mayWrite = can(workspace.role, 'document:write')
  const mayDelete = can(workspace.role, 'document:delete')

  const documents = useQuery({
    queryKey: ['documents', workspace.id, vehicleId],
    queryFn: () => api.documents.list(workspace.id, vehicleId),
  })

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setProgress('Checking the file…')
      const checksumSha256 = await checksumOf(file)

      setProgress('Preparing the upload…')
      const session = await api.documents.createUploadSession(workspace.id, {
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        byteSize: file.size,
        checksumSha256,
        vehicleId,
      })

      setProgress('Uploading…')
      const put = await fetch(session.upload.url, {
        method: 'PUT',
        headers: session.upload.headers,
        body: file,
      })
      if (!put.ok) throw new Error('The upload did not complete. Please try again.')

      setProgress('Verifying…')
      return api.documents.finalise(workspace.id, session.documentId)
    },
    onSuccess: async () => {
      setProgress(null)
      setError(null)
      await queryClient.invalidateQueries({
        queryKey: ['documents', workspace.id, vehicleId],
      })
    },
    onError: (err) => {
      setProgress(null)
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'The upload failed.',
      )
    },
  })

  function onPick(file: File | undefined) {
    if (!file) return
    setError(null)
    // Checked here for a fast, clear message; the server checks again and is the authority.
    if (file.size > MAX_BYTES) {
      setError('Files must be 20 MB or smaller.')
      return
    }
    upload.mutate(file)
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-content-secondary">
          Invoices, certificates and photos, kept with the vehicle. Only you and your workspace can
          open them.
        </p>
        {mayWrite && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              onChange={(e) => {
                onPick(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <Button
              onClick={() => fileInput.current?.click()}
              loading={upload.isPending}
              variant="primary"
            >
              {upload.isPending ? (progress ?? 'Uploading…') : 'Upload a document'}
            </Button>
          </>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-status-overdue/30 bg-status-overdue-subtle px-3 py-2 text-[13px] text-status-overdue"
        >
          {error}
        </div>
      )}

      <Card>
        <CardHeader
          title="Documents"
          description="PDFs and images up to 20 MB. Links you open are valid for five minutes."
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
            requestId={documents.error instanceof ApiError ? documents.error.requestId : undefined}
            onRetry={() => void documents.refetch()}
          />
        ) : documents.data.length === 0 ? (
          <EmptyState
            title="No documents yet"
            description={
              mayWrite
                ? 'Upload the last service invoice or the MOT certificate to keep it with the vehicle.'
                : 'Nothing has been uploaded for this vehicle.'
            }
          />
        ) : (
          <ul className="divide-y divide-border-subtle border-t border-border-subtle">
            {documents.data.map((d) => (
              <DocumentRow key={d.id} document={d} vehicleId={vehicleId} mayDelete={mayDelete} />
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}

function DocumentRow({
  document: doc,
  vehicleId,
  mayDelete,
}: {
  document: VaultDocument
  vehicleId: string
  mayDelete: boolean
}) {
  const { workspace } = useSession()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)

  const remove = useMutation({
    mutationFn: () => api.documents.remove(workspace.id, doc.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['documents', workspace.id, vehicleId] }),
  })

  /**
   * The link is minted on click and expires in five minutes, so it is never rendered
   * into the page and cannot be shared by copying the markup.
   */
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
      <Button variant="secondary" onClick={() => void open()} loading={busy}>
        Open
      </Button>
      {mayDelete && (
        <Button variant="ghost" onClick={() => remove.mutate()} loading={remove.isPending}>
          Delete
        </Button>
      )}
    </li>
  )
}
