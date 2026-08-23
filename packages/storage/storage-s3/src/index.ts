/**
 * S3-compatible storage backend: binary objects addressed by a relative,
 * path-shaped key are stored as S3 objects under a configured prefix. The
 * backend serves the `blob` facet; `kv` is intentionally omitted because a
 * whole-snapshot JSON unit does not fit object-store write semantics — pair
 * this backend with a local `kv` backend when both facets are needed.
 * @module @deepseek-ai/dsh-storage-s3
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command,
  PutObjectCommand, S3Client, type _Object,
} from '@aws-sdk/client-s3'
import z from '@deepseek-ai/schemastery'
import { StorageError, storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import type { BlobFacet, BlobObject, StorageBackend } from '@deepseek-ai/dsh-storage'

/** Cordis plugin name. */
export const name = 'storage-s3'
/** The hub must exist before the backend can register. */
export const inject = ['storage']

/** Plugin configuration. Credentials resolve from the standard AWS chain (env, shared config, IAM) unless overridden. */
export interface Config {
  /** Target bucket. */
  bucket: string
  /** AWS region; defaults to `AWS_REGION`/`AWS_DEFAULT_REGION`, then `us-east-1`. */
  region?: string
  /** S3-compatible endpoint (MinIO, Aliyun OSS, …); omit for AWS proper. */
  endpoint?: string
  /** Object-key prefix; object keys become `<prefix>/<key>` when set. */
  prefix?: string
  /** Force path-style addressing (required for most non-AWS endpoints). */
  forcePathStyle?: boolean
  /** Explicit static credentials; fall back to the ambient chain when omitted. */
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
}

/** Config schema. */
export const Config: z<Config> = z.object({
  bucket: z.string().required(),
  region: z.string(),
  endpoint: z.string(),
  prefix: z.string(),
  forcePathStyle: z.boolean(),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  sessionToken: z.string(),
})

/** Validate one relative path-shaped blob key (mirrors the facet contract). */
function validateBlobKey(key: string): string {
  if (key.length === 0 || key.startsWith('/') || key.includes('\0') || key.includes('\\')) {
    throw new StorageError('malformed-medium', `invalid blob key '${key}'`)
  }
  const segments = key.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new StorageError('malformed-medium', `invalid blob key '${key}'`)
  }
  return key
}

/** S3 backend: owns one bucket under a prefix and serves the `blob` facet. */
export class S3StorageBackend implements StorageBackend {
  private readonly client: S3Client
  private readonly bucket: string
  private readonly prefix: string
  private closed = false
  private readonly blobFacet: BlobFacet

  readonly blob: BlobFacet

  constructor(config: Config) {
    this.bucket = config.bucket
    this.prefix = config.prefix === undefined || config.prefix === '' ? '' : config.prefix.replace(/\/+$/, '')
    const credentials = config.accessKeyId !== undefined && config.secretAccessKey !== undefined
      ? {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        ...(config.sessionToken === undefined ? {} : { sessionToken: config.sessionToken }),
      }
      : undefined
    this.client = new S3Client({
      region: config.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
      ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
      ...(config.forcePathStyle === undefined ? {} : { forcePathStyle: config.forcePathStyle }),
      ...(credentials === undefined ? {} : { credentials }),
    })
    this.blobFacet = this.makeBlobFacet()
    this.blob = this.blobFacet
  }

  private key(blobKey: string): string {
    const clean = validateBlobKey(blobKey)
    return this.prefix === '' ? clean : `${this.prefix}/${clean}`
  }

  private guard(): void {
    if (this.closed) throw new StorageError('closed', 's3 backend is closed')
  }

  private isMissing(error: unknown): boolean {
    return (error as { name?: string; $metadata?: { httpStatusCode?: number } }).name === 'NoSuchKey'
      || (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
  }

  /** Drain an SDK response body, failing loud when the SDK omitted it. */
  private async readBody(response: { Body?: { transformToByteArray(): Promise<Uint8Array> } }): Promise<Uint8Array> {
    if (response.Body === undefined) throw new Error('S3 response has no body')
    return await response.Body.transformToByteArray()
  }

  private makeBlobFacet(): BlobFacet {
    return {
      put: async (blobKey, bytes) => {
        this.guard()
        await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.key(blobKey), Body: bytes }))
      },
      get: async (blobKey) => {
        this.guard()
        try {
          const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(blobKey) }))
          return await this.readBody(response)
        } catch (error) {
          if (this.isMissing(error)) throw new StorageError('not-found', `blob '${blobKey}' does not exist`)
          throw error
        }
      },
      getRange: async (blobKey, offset, length) => {
        this.guard()
        const start = Math.max(0, Math.floor(offset))
        const count = Math.max(0, Math.floor(length))
        const end = count === 0 ? start : start + count - 1
        try {
          const response = await this.client.send(new GetObjectCommand({
            Bucket: this.bucket, Key: this.key(blobKey), Range: `bytes=${start}-${end}`,
          }))
          return await this.readBody(response)
        } catch (error) {
          if (this.isMissing(error)) throw new StorageError('not-found', `blob '${blobKey}' does not exist`)
          throw error
        }
      },
      stat: async (blobKey) => {
        this.guard()
        try {
          const response = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(blobKey) }))
          const size = response.ContentLength
          return size === undefined ? undefined : { size }
        } catch (error) {
          if (this.isMissing(error)) return undefined
          throw error
        }
      },
      list: async (prefix) => {
        this.guard()
        const objects: BlobObject[] = []
        const cleanPrefix = prefix === '' ? '' : prefix.replace(/\/+$/, '')
        const searchPrefix = cleanPrefix === ''
          ? (this.prefix === '' ? '' : `${this.prefix}/`)
          : (this.prefix === '' ? cleanPrefix : `${this.prefix}/${cleanPrefix}`)
        let continuationToken: string | undefined
        do {
          const response = await this.client.send(new ListObjectsV2Command({
            Bucket: this.bucket,
            ...(searchPrefix === '' ? {} : { Prefix: searchPrefix }),
            ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }),
          }))
          for (const item of response.Contents ?? []) {
            if (item.Key === undefined) continue
            const rel = this.prefix === '' ? item.Key : item.Key.startsWith(`${this.prefix}/`) ? item.Key.slice(this.prefix.length + 1) : item.Key
            if (rel === '') continue
            const size = (item as _Object).Size
            objects.push({ key: rel, size: size ?? 0 })
          }
          continuationToken = response.IsTruncated === true ? response.NextContinuationToken : undefined
        } while (continuationToken !== undefined)
        return objects
      },
      delete: async (blobKey) => {
        this.guard()
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(blobKey) }))
      },
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.client.destroy()
  }
}

/**
 * Register the `s3` backend on the storage hub.
 * @param ctx - Plugin context.
 * @param config - Validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const backend = new S3StorageBackend(config)
  ctx.effect(() => {
    const unregister = ctx.storage.backend.register('s3', backend)
    return async () => {
      unregister()
      await backend.close()
    }
  })
  ctx.provide(storageBackendServiceKey('s3'), backend)
}
