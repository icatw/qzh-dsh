import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { QzhCaseView, QzhCreateCaseRequest, QzhEvidenceSummary } from '@deepseek-ai/dsh-api-remotes/client'
import { QzhComposer } from './QzhComposer.tsx'
import { QzhEvidenceDock } from './QzhEvidenceDock.tsx'
import { QzhLogAnalysisSection } from './QzhLogAnalysisSection.tsx'
import { QzhSessionHeaderAction } from './QzhSessionHeaderAction.tsx'
import { createQzhSessionStore } from './store.ts'

/** Host and session services used by the current-session QZH surfaces. */
export const inject = ['sessions', 'slots', 'remote']

async function remoteValue<T>(request: Promise<RemoteResult<T>>): Promise<T> {
  const result = await request
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

/** Register QZH evidence UI into the resident conversation, scoped to qzh sessions. */
export function apply(ctx: ClientContext): void {
  const store = createQzhSessionStore()
  const sessions = ctx.get('sessions') as unknown as {
    scope: (sessionId: SessionId) => { conversation: { send: (text: string) => Promise<void> } } | undefined
  }
  const actions = (sessionId: SessionId) => ({
    createCase: (request: QzhCreateCaseRequest): Promise<QzhCaseView> => remoteValue(ctx.remote.qzhLogAnalysis.createCase(sessionId, request)),
    setEvidence: (id: QzhCaseView['id'], evidence: QzhEvidenceSummary): Promise<QzhCaseView> => remoteValue(ctx.remote.qzhLogAnalysis.setEvidence(sessionId, id, evidence)),
    getCase: (id: QzhCaseView['id']): Promise<QzhCaseView> => remoteValue(ctx.remote.qzhLogAnalysis.getCase(sessionId, id)),
    startAnalysis: (id: QzhCaseView['id']): Promise<QzhCaseView> => remoteValue(ctx.remote.qzhLogAnalysis.startAnalysis(sessionId, id)).then(result => result.case),
  })

  const composerFace = (sessionId: SessionId) => ({
    send: async (text: string): Promise<void> => {
      const scope = sessions.scope(sessionId)
      if (scope === undefined) throw new Error(`QZH session ${String(sessionId)} is unavailable`)
      await scope.conversation.send(text)
    },
  })

  ctx.slots.inject('conversation.hero.empty', () => ctx.slots.register({
    name: 'conversation.hero.empty', store,
    inject: (sessionId) => actions(sessionId),
  }, QzhLogAnalysisSection))

  ctx.slots.inject('conversation.composer.qzh', () => ctx.slots.register({
    name: 'conversation.composer.qzh',
    inject: (sessionId) => composerFace(sessionId),
  }, QzhComposer))

  ctx.slots.inject('conversation.composer.qzh.dock', () => ctx.slots.register({
    name: 'conversation.composer.qzh.dock', store,
    inject: (sessionId) => ({ startAnalysis: actions(sessionId).startAnalysis }),
  }, QzhEvidenceDock))

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'qzh-log-analysis', order: 20, store,
  }, QzhSessionHeaderAction))
}
