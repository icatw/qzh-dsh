/** Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-qzh-log-analysis`. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-qzh-log-analysis'

/** Cordis companion plugin name. */
export const name = 'client-ui-qzh-log-analysis-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the browser owns local view state and disposable slot registrations only. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
