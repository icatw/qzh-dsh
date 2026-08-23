import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import Storage, { storageBackendServiceKey, StorageError } from '@deepseek-ai/dsh-storage'
import { Config, S3StorageBackend } from '../src/index.ts'
import * as StorageS3Invariant from '../src/invariant.ts'

const send = vi.hoisted(() => vi.fn())
const destroy = vi.hoisted(() => vi.fn())

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = send
    destroy = destroy
  },
  PutObjectCommand: class { constructor(readonly input: unknown) {} },
  GetObjectCommand: class { constructor(readonly input: unknown) {} },
  HeadObjectCommand: class { constructor(readonly input: unknown) {} },
  ListObjectsV2Command: class { constructor(readonly input: unknown) {} },
  DeleteObjectCommand: class { constructor(readonly input: unknown) {} },
}))

function backend(overrides: Partial<Config> = {}): S3StorageBackend {
  return new S3StorageBackend(new Config({ bucket: 'bkt', ...overrides }))
}

function sentCommand(instance: { constructor: { name: string }; input: unknown }): { name: string; input: Record<string, unknown> } {
  return { name: instance.constructor.name, input: instance.input as Record<string, unknown> }
}

beforeEach(() => {
  send.mockReset()
  destroy.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('S3 storage backend blob facet', () => {
  it('maps put/get/stat/list/delete onto the S3 command surface', async () => {
    const b = backend()
    await b.blob.put('case/files/server/a.log', new Uint8Array([1, 2, 3]))
    expect(sentCommand(send.mock.calls[0]![0] as never)).toMatchObject({
      name: 'PutObjectCommand', input: { Bucket: 'bkt', Key: 'case/files/server/a.log', Body: expect.anything() },
    })

    send.mockResolvedValueOnce({ Body: { transformToByteArray: async () => new Uint8Array([9, 8, 7]) } })
    expect(await b.blob.get('case/files/server/a.log')).toEqual(new Uint8Array([9, 8, 7]))
    expect(sentCommand(send.mock.calls[1]![0] as never)).toMatchObject({
      name: 'GetObjectCommand', input: { Bucket: 'bkt', Key: 'case/files/server/a.log' },
    })

    send.mockResolvedValueOnce({ ContentLength: 42 })
    expect(await b.blob.stat('case/files/server/a.log')).toEqual({ size: 42 })
    expect(sentCommand(send.mock.calls[2]![0] as never).name).toBe('HeadObjectCommand')

    send.mockResolvedValueOnce({ Contents: [{ Key: 'case/files/server/a.log', Size: 11 }, { Key: 'case/archive.zip', Size: 22 }], IsTruncated: false })
    const listed = await b.blob.list('case')
    expect(listed.map(o => o.key).sort()).toEqual(['case/archive.zip', 'case/files/server/a.log'])

    await b.blob.delete('case/files/server/a.log')
    expect(sentCommand(send.mock.calls[4]![0] as never)).toMatchObject({
      name: 'DeleteObjectCommand', input: { Bucket: 'bkt', Key: 'case/files/server/a.log' },
    })
    await b.close()
  })

  it('applies a configured prefix to object keys and strips it back in list', async () => {
    const b = backend({ prefix: 'qzh' })
    await b.blob.put('case/a.log', new Uint8Array([1]))
    expect(sentCommand(send.mock.calls[0]![0] as never)).toMatchObject({
      name: 'PutObjectCommand', input: { Key: 'qzh/case/a.log' },
    })
    send.mockResolvedValueOnce({ Contents: [{ Key: 'qzh/case/a.log', Size: 1 }], IsTruncated: false })
    const listed = await b.blob.list('case')
    expect(listed.map(o => o.key)).toEqual(['case/a.log'])
    await b.close()
  })

  it('issues a range read for getRange', async () => {
    const b = backend()
    send.mockResolvedValueOnce({ Body: { transformToByteArray: async () => new Uint8Array([5, 6]) } })
    await b.blob.getRange('case/a.log', 10, 2)
    expect(sentCommand(send.mock.calls[0]![0] as never)).toMatchObject({
      name: 'GetObjectCommand', input: { Range: 'bytes=10-11' },
    })
    await b.close()
  })

  it('turns NoSuchKey/404 into not-found and surfaces other failures', async () => {
    const b = backend()
    send.mockRejectedValueOnce(Object.assign(new Error('missing'), { name: 'NoSuchKey' }))
    await expect(b.blob.get('missing')).rejects.toMatchObject({ code: 'not-found' })

    send.mockRejectedValueOnce(Object.assign(new Error('gone'), { $metadata: { httpStatusCode: 404 } }))
    expect(await b.blob.stat('missing')).toBeUndefined()

    send.mockRejectedValueOnce(new Error('auth failure'))
    await expect(b.blob.get('x')).rejects.toThrow('auth failure')
    await b.close()
  })

  it('rejects escaping blob keys and closed access', async () => {
    const b = backend()
    for (const bad of ['', '/abs', 'a/../b', 'a\\b', 'a\0b']) {
      await expect(b.blob.put(bad, new Uint8Array([1]))).rejects.toMatchObject({ code: 'malformed-medium' })
    }
    await b.close()
    await expect(b.blob.put('a', new Uint8Array([1]))).rejects.toMatchObject({ code: 'closed' })
    expect(destroy).toHaveBeenCalled()
  })
})

describe('S3 storage backend registration', () => {
  it('registers as backend "s3" and closes on dispose', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const fiber = await ctx.plugin({ apply: (await import('../src/index.ts')).apply, Config, inject: ['storage'] }, { bucket: 'bkt' })
    expect(ctx.storage.backend.get('s3')).toBeDefined()
    expect(ctx.get(storageBackendServiceKey('s3'))).toBeDefined()
    await fiber.dispose()
    expect(() => ctx.storage.backend.get('s3')).toThrow(StorageError)
  })
})

describe('invariant companion', () => {
  it('registers under the package name with an explained-empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(StorageS3Invariant).await()).resolves.toBeDefined()
  })
})
