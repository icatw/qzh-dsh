/**
 * Local-directory blob facet: binary objects stored as one file per key under
 * `<root>/blobs/`, addressed by a relative path-shaped key. Mirrors the object
 * store semantics of the {@link BlobFacet} contract so the JSON backend can
 * serve both KV units and byte blobs from the same directory root.
 * @module @deepseek-ai/dsh-storage-json/src/blob
 */

import { mkdir, open, readFile, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { StorageError } from '@deepseek-ai/dsh-storage'
import type { BlobFacet, BlobObject } from '@deepseek-ai/dsh-storage'
import { writeAtomicBytes } from './atomic.ts'

/** Validate one relative path-shaped blob key; returns its clean form. */
export function validateBlobKey(key: string): string {
  if (key.length === 0 || key.startsWith('/') || key.includes('\0') || key.includes('\\')) {
    throw new StorageError('malformed-medium', `invalid blob key '${key}'`)
  }
  const segments = key.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new StorageError('malformed-medium', `invalid blob key '${key}'`)
  }
  return key
}

/** Local filesystem implementation of the storage blob facet. */
export class JsonBlobFacet implements BlobFacet {
  private closed = false
  private readonly blobRoot: string

  constructor(root: string) {
    this.blobRoot = join(root, 'blobs')
  }

  private resolve(key: string): string {
    const canonical = join(this.blobRoot, validateBlobKey(key))
    const rel = relative(this.blobRoot, canonical)
    if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..') {
      throw new StorageError('malformed-medium', `blob key '${key}' escapes the backend root`)
    }
    return canonical
  }

  /** Resolve a list prefix: `''` means the whole medium, and a trailing `/` is allowed. */
  private resolvePrefix(prefix: string): string {
    const trimmed = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
    if (trimmed === '') return this.blobRoot
    return this.resolve(trimmed)
  }

  private guard(): void {
    if (this.closed) throw new StorageError('closed', 'json backend is closed')
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    this.guard()
    const target = this.resolve(key)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await writeAtomicBytes(target, bytes)
  }

  async get(key: string): Promise<Uint8Array> {
    this.guard()
    try {
      return await readFile(this.resolve(key))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new StorageError('not-found', `blob '${key}' does not exist`)
      }
      throw error
    }
  }

  async getRange(key: string, offset: number, length: number): Promise<Uint8Array> {
    this.guard()
    const start = Math.max(0, Math.floor(offset))
    const count = Math.max(0, Math.floor(length))
    const handle = await open(this.resolve(key), 'r')
    try {
      const buffer = Buffer.alloc(count)
      const { bytesRead } = await handle.read(buffer, 0, count, start)
      return buffer.subarray(0, bytesRead)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new StorageError('not-found', `blob '${key}' does not exist`)
      }
      throw error
    } finally {
      await handle.close()
    }
  }

  async stat(key: string): Promise<{ size: number } | undefined> {
    this.guard()
    try {
      const info = await stat(this.resolve(key))
      return { size: info.size }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async list(prefix: string): Promise<BlobObject[]> {
    this.guard()
    const base = this.resolvePrefix(prefix)
    const objects: BlobObject[] = []
    const walk = async (dir: string): Promise<void> => {
      let entries: string[] = []
      try {
        entries = await readdir(dir)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      for (const entry of entries) {
        const abs = join(dir, entry)
        const info = await stat(abs)
        if (info.isDirectory()) {
          await walk(abs)
        } else if (info.isFile()) {
          objects.push({ key: relative(this.blobRoot, abs).split(sep).join('/'), size: info.size })
        }
      }
    }
    await walk(base)
    return objects
  }

  async delete(key: string): Promise<void> {
    this.guard()
    await rm(this.resolve(key), { force: true })
  }

  async close(): Promise<void> {
    this.closed = true
  }
}
