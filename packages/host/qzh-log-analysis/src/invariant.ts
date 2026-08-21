/** Package-owned invariant companion for the QZH Host analysis service. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-qzh-log-analysis'

/** Cordis companion plugin name. */
export const name = 'host-qzh-log-analysis-invariant'
/** Service required before registering package ownership. */
export const inject = ['invariants']

/** No runtime invariant: case state is process-local and source reads project no mutable QZH state. */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
