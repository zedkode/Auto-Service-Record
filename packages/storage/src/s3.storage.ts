import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { ObjectStorage, StoredObject, UploadSession } from './types.js'

export interface S3StorageConfig {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** MinIO needs path-style addressing; real S3 does not. */
  forcePathStyle?: boolean
}

/** 15 minutes to upload, 5 to download (SECURITY.md §10). */
export const UPLOAD_TTL_SECONDS = 15 * 60
export const DOWNLOAD_TTL_SECONDS = 5 * 60

/**
 * S3-compatible object storage (MinIO locally, S3 in production).
 *
 * The bucket is private: nothing here ever makes an object public. Every access is a
 * short-lived presigned URL, and the permission check that precedes it lives in the API,
 * not here — this class has no idea who is asking, which is deliberate.
 */
export class S3Storage implements ObjectStorage {
  private readonly client: S3Client
  private readonly bucket: string

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? true,
    })
  }

  async createUploadSession(
    key: string,
    contentType: string,
    byteSize: number,
  ): Promise<UploadSession> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: byteSize,
    })
    const url = await getSignedUrl(this.client, command, { expiresIn: UPLOAD_TTL_SECONDS })
    return {
      url,
      method: 'PUT',
      // Signed into the URL, so the upload fails if the client sends anything else.
      headers: { 'content-type': contentType },
      expiresInSeconds: UPLOAD_TTL_SECONDS,
    }
  }

  async createDownloadUrl(
    key: string,
    filename: string,
    expiresInSeconds = DOWNLOAD_TTL_SECONDS,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      // Forces a download rather than inline rendering, and restores the name the user
      // uploaded — which is metadata, never part of the key.
      ResponseContentDisposition: `attachment; filename="${sanitiseFilename(filename)}"`,
    })
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds })
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return {
        byteSize: Number(res.ContentLength ?? 0),
        contentType: res.ContentType ?? null,
        checksumSha256: res.ChecksumSHA256 ?? null,
      }
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  async readHead(key: string, bytes: number): Promise<Uint8Array> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
    )
    const body = await res.Body?.transformToByteArray()
    return body ?? new Uint8Array()
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
  return e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404
}

/**
 * The filename goes into a response header, so anything that could terminate or inject
 * one is removed. It is presentation only — the object is addressed by its key.
 */
export function sanitiseFilename(filename: string): string {
  return (
    filename
      .replace(/[\r\n"\\]/g, '')
      .replace(/[/\\]/g, '_')
      .slice(0, 200)
      .trim() || 'document'
  )
}
