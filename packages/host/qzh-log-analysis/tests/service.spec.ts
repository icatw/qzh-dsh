import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import QzhLogAnalysisService from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('QzhLogAnalysisService', () => {
  it('requires explicit internal-destination consent and re-sanitizes accepted evidence', () => {
    const ctx = new Context()
    contexts.push(ctx)
    const service = new QzhLogAnalysisService(ctx, { mirrorRoot: '/tmp/qzh-mirror' })
    const created = service.createCase({ productVersion: '3.9.17' })

    expect(() => service.setEvidence(created.id, {
      consent: { approved: false, destination: 'internal-qzh-analysis' },
      files: [], clusters: [],
    })).toThrow('consent')

    const saved = service.setEvidence(created.id, {
      consent: { approved: true, destination: 'internal-qzh-analysis' },
      files: [{ path: '/data/logs/qzh_web_agent.log', component: 'web-agent', stream: 'log', size: 12 }],
      clusters: [{
        key: 'authorization=secret-value', component: 'web-agent', severity: 'error', count: 1,
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
})
