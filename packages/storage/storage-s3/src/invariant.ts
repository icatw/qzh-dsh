/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-storage-s3`.
 * @module @deepseek-ai/dsh-storage-s3/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-storage-s3'

/** Cordis companion plugin name. */
export const name = 'storage-s3-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: correctness here is round-trip equivalence against
 * the S3-compatible endpoint, which requires a live bucket (integration
 * tests), not a continuously observable in-process relation.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
