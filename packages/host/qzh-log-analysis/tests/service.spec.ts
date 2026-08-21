import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import QzhLogAnalysisService from '../src/index.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { QzhCaseView } from '../src/types.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('QzhLogAnalysisService', () => {
  it('requires explicit internal-destination consent and re-sanitizes accepted evidence', () => {
    const ctx = new Context()
    contexts.push(ctx)
    const service = new QzhLogAnalysisService(ctx, { mirrorRoot: '/tmp/qzh-mirror' })
    const sessionId = 'session-qzh' as SessionId
    const created = service.createCase(sessionId, { productVersion: '3.9.17' })
    const otherSession = 'session-other' as SessionId
    expect(() => service.setEvidence(otherSession, created.id, {
      consent: { approved: true, destination: 'internal-qzh-analysis' }, files: [], clusters: [],
    })).toThrow('does not belong to session')

    expect(() => service.setEvidence(sessionId, created.id, {
      consent: { approved: false, destination: 'internal-qzh-analysis' },
      files: [], clusters: [],
    })).toThrow('consent')

    const saved = service.setEvidence(sessionId, created.id, {
      consent: { approved: true, destination: 'internal-qzh-analysis' },
      files: [{ path: '/data/logs/qzh_web_agent.log', component: 'web-agent', stream: 'log', category: 'server', size: 12 }],
      clusters: [{
        key: 'authorization=secret-value', component: 'web-agent', category: 'server', severity: 'error', count: 1,
        sample: 'Authorization: Bearer secret-value',
      }],
      excerpt: 'cookie=session-secret',
    })

    expect(saved.state).toBe('evidence-ready')
    expect(saved.evidence).toMatchObject({
      consent: { approved: true, destination: 'internal-qzh-analysis' },
      files: [{ path: 'data/logs/qzh_web_agent.log' }],
    })
    expect(saved.evidence?.clusters[0]?.key).toContain('[REDACTED]')
    expect(saved.evidence?.clusters[0]?.sample).toContain('[REDACTED]')
    expect(saved.evidence?.excerpt).toContain('[REDACTED]')
  })

  it('keeps archive-relative evidence paths and exposes the latest session case context', () => {
    const ctx = new Context()
    contexts.push(ctx)
    const service = new QzhLogAnalysisService(ctx, { mirrorRoot: '/tmp/qzh-mirror' })
    const sessionId = 'session-archive-layout' as SessionId
    const created = service.createCase(sessionId, {})
    const saved = service.setEvidence(sessionId, created.id, {
      consent: { approved: true, destination: 'internal-qzh-analysis' },
      files: [{ path: 'services/web/runtime.log', component: 'unknown', stream: 'log', category: 'server', size: 8 }],
      clusters: [],
    })
    expect(saved.evidence?.files[0]?.path).toBe('services/web/runtime.log')
    const toolApi = service as unknown as {
      currentCaseForTool: (id: SessionId) => QzhCaseView
      resolveToolCase: (id: SessionId, requestedId?: string) => QzhCaseView
    }
    const current = toolApi.currentCaseForTool(sessionId)
    expect(current.id).toBe(created.id)
    expect(current.evidence?.files[0]?.path).toBe('services/web/runtime.log')
    expect(toolApi.resolveToolCase(sessionId, 'a-model-guessed-id').id).toBe(created.id)
  })

  it('re-sanitizes per-file layout samples and exposes them to the model-facing list tool', () => {
    const ctx = new Context()
    contexts.push(ctx)
    const service = new QzhLogAnalysisService(ctx, { mirrorRoot: '/tmp/qzh-mirror' })
    const sessionId = 'session-sample' as SessionId
    const created = service.createCase(sessionId, {})
    const saved = service.setEvidence(sessionId, created.id, {
      consent: { approved: true, destination: 'internal-qzh-analysis' },
      files: [{
        path: 'customer-a/bundle/logs/runtime.log',
        component: 'unknown',
        stream: 'log',
        category: 'terminal',
        size: 64,
        sample: '2026-08-21 10:00:00 ERROR Authorization: Bearer secret-value',
      }],
      clusters: [{ key: 'boom', component: 'unknown', category: 'terminal', severity: 'error', count: 1, sample: 'ERROR boom' }],
    })
    const sample = saved.evidence?.files[0]?.sample
    expect(sample).toContain('[REDACTED]')
    expect(sample).not.toContain('secret-value')
    expect(saved.evidence?.files[0]?.category).toBe('terminal')
    const toolApi = service as unknown as {
      evidenceForTool: (record: { id: unknown; evidence?: unknown }) => Record<string, unknown>
    }
    const listed = toolApi.evidenceForTool(saved) as { files: Array<{ path: string; category?: string; sample?: string }> }
    expect(listed.files[0]).toMatchObject({ path: 'customer-a/bundle/logs/runtime.log', component: 'unknown', category: 'terminal' })
    expect(listed.files[0]?.sample).toContain('[REDACTED]')
  })

  it('records and validates the user feedback on a completed case', () => {
    const ctx = new Context()
    contexts.push(ctx)
    const service = new QzhLogAnalysisService(ctx, { mirrorRoot: '/tmp/qzh-mirror' })
    const sessionId = 'session-feedback' as SessionId
    const created = service.createCase(sessionId, {})
    expect(() => service.setFeedback(sessionId, created.id, 'maybe' as never)).toThrow('like or dislike')
    const liked = service.setFeedback(sessionId, created.id, 'like', '  结论准确  ')
    expect(liked.feedback).toBe('like')
    expect(liked.feedbackComment).toBe('结论准确')
    const disliked = service.setFeedback(sessionId, created.id, 'dislike')
    expect(disliked.feedback).toBe('dislike')
    expect(disliked.feedbackComment).toBeUndefined()
  })
})
