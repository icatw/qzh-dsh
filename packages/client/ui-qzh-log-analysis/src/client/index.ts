import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { QzhCaseView, QzhCreateCaseRequest, QzhEvidenceSummary } from '@deepseek-ai/dsh-api-remotes/client'
import { QzhLogAnalysisSection } from './QzhLogAnalysisSection.tsx'

/** Services needed for the settings page and the QZH Host Remote API. */
export const inject = ['slots', 'remote']

async function remoteValue<T>(request: Promise<RemoteResult<T>>): Promise<T> {
  const result = await request
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

/** Register the QZH workbench into the existing settings navigation. @param ctx - browser Cordis context. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'qzh-log-analysis',
    order: 20,
    label: 'QZH 日志分析',
    inject: () => ({
      createCase: (request: QzhCreateCaseRequest): Promise<QzhCaseView> => remoteValue(ctx.remote.qzhLogAnalysis.createCase(request)),
      setEvidence: (id: QzhCaseView['id'], evidence: QzhEvidenceSummary): Promise<QzhCaseView> => remoteValue(ctx.remote.qzhLogAnalysis.setEvidence(id, evidence)),
      startAnalysis: async (id: QzhCaseView['id']): Promise<QzhCaseView> => (await remoteValue(ctx.remote.qzhLogAnalysis.startAnalysis(id))).case,
    }),
  }, QzhLogAnalysisSection))
}
