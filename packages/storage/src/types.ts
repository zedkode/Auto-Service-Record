export interface UploadSession {
  /** Presigned PUT. Short-lived by design (SECURITY.md §10). */
  url: string
  method: 'PUT'
  headers: Record<string, string>
  expiresInSeconds: number
}

export interface StoredObject {
  byteSize: number
  contentType: string | null
  checksumSha256: string | null
}

export interface ObjectStorage {
  /** Presigned PUT for the client to upload directly. */
  createUploadSession(key: string, contentType: string, byteSize: number): Promise<UploadSession>
  /** Presigned GET, issued only after a permission check. */
  createDownloadUrl(key: string, filename: string, expiresInSeconds: number): Promise<string>
  /** Metadata for finalisation, or null when nothing was uploaded. */
  head(key: string): Promise<StoredObject | null>
  /** First `bytes` of the object, for magic-byte verification. */
  readHead(key: string, bytes: number): Promise<Uint8Array>
  remove(key: string): Promise<void>
}
