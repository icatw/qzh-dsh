import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { zipSync, strToU8 } from 'fflate'
import { Context } from '@deepseek-ai/cordis'
import { Storage } from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import QzhLogAnalysisService, { assessReport } from '../src/index.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { QzhCaseView } from '../src/types.ts'

const contexts: Context[] = []
const backends: JsonStorageBackend[] = []
const mirrors: string[] = []

/** Build a tiny git mirror with tags v1.0.0 / v2.0.0 and a HEAD commit. */
function makeGitMirror(): { root: string; v2Commit: string } {
  const root = mkdtempSync(join(tmpdir(), 'qzh-mirror-'))
  mirrors.push(root)
  const run = (args: string[]): void => { execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' }) }
  run(['init', '-q'])
  run(['config', 'user.email', 'test@example.com'])
  run(['config', 'user.name', 'test'])
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/service.go'), '// v1\nconst TOKEN_V1 = true\n')
  run(['add', '.'])
  run(['commit', '-qm', 'v1'])
  run(['tag', 'v1.0.0'])
  writeFileSync(join(root, 'src/service.go'), '// v2\nconst TOKEN_V2 = true\n')
  run(['commit', '-qam', 'v2'])
  run(['tag', 'v2.0.0'])
  // HEAD carries a third token so the no-version fallback is distinguishable.
  writeFileSync(join(root, 'src/service.go'), '// head\nconst TOKEN_HEAD = true\n')
  run(['commit', '-qam', 'head'])
  const v2Commit = execFileSync('git', ['-C', root, 'rev-parse', 'v2.0.0'], { encoding: 'utf8' }).trim()
  return { root, v2Commit }
}

afterEach(async () => {
  await Promise.all(backends.splice(0).map(backend => backend.close()))
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function mountStorage(ctx: Context, root: string): void {
  const storage = new Storage(ctx)
  const backend = new JsonStorageBackend(root)
  storage.backend.register('json', backend)
  backends.push(backend)
}

describe('QzhLogAnalysisService', () => {
  it('requires explicit internal-destination consent and re-sanitizes accepted evidence', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const service = new QzhLogAnalysisService(ctx, { mirrorRoot: '/tmp/qzh-mirror' })
    const sessionId = 'session-qzh' as SessionId
    const created = await service.createCase(sessionId, { productVersion: '3.9.17' })
    const otherSession = 'session-other' as SessionId
    await expect(service.setEvidence(otherSession, created.id, {
      consent: { approved: true, destination: 'internal-qzh-analysis' }, files: [], clusters: [],
    })).rejects.toThrow('does not belong to session')

    await expect(service.setEvidence(sessionId, created.id, {
      consent: { approved: false, destination: 'internal-qzh-analysis' },
      files: [], clusters: [],
    })).rejects.toThrow('consent')

    const saved = await service.setEvidence(sessionId, created.id, {
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

  it('keeps archive-relative evidence paths and exposes the latest session case context', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const service = new QzhLogAnalysisService(ctx, { mirrorRoot: '/tmp/qzh-mirror' })
    const sessionId = 'session-archive-layout' as SessionId
    const created = await service.createCase(sessionId, {})
    const saved = await service.setEvidence(sessionId, created.id, {
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

  it('re-sanitizes per-file layout samples and exposes them to the model-facing list tool', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const service = new QzhLogAnalysisService(ctx, { mirrorRoot: '/tmp/qzh-mirror' })
    const sessionId = 'session-sample' as SessionId
    const created = await service.createCase(sessionId, {})
    const saved = await service.setEvidence(sessionId, created.id, {
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

  it('records and validates the user feedback on a completed case', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const service = new QzhLogAnalysisService(ctx, { mirrorRoot: '/tmp/qzh-mirror' })
    const sessionId = 'session-feedback' as SessionId
    const created = await service.createCase(sessionId, {})
    await expect(service.setFeedback(sessionId, created.id, 'maybe' as never)).rejects.toThrow('like or dislike')
    const liked = await service.setFeedback(sessionId, created.id, 'like', '  结论准确  ')
    expect(liked.feedback).toBe('like')
    expect(liked.feedbackComment).toBe('结论准确')
    const disliked = await service.setFeedback(sessionId, created.id, 'dislike')
    expect(disliked.feedback).toBe('dislike')
    expect(disliked.feedbackComment).toBeUndefined()
  })

  it('persists cases durably and restores them on a fresh service instance', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qzh-cases-'))
    // First instance writes through the json backend.
    const ctx1 = new Context()
    contexts.push(ctx1)
    mountStorage(ctx1, root)
    const service1 = new QzhLogAnalysisService(ctx1, { mirrorRoot: '/tmp/qzh-mirror' })
    const sessionId = 'session-persist' as SessionId
    const created = await service1.createCase(sessionId, { productVersion: '3.9.17' })
    await service1.setEvidence(sessionId, created.id, {
      consent: { approved: true, destination: 'internal-qzh-analysis' },
      files: [{ path: 'data/logs/qzh_web_agent.log', component: 'web-agent', stream: 'log', category: 'server', size: 12 }],
      clusters: [],
    })
    await service1.setFeedback(sessionId, created.id, 'like', '有帮助')
    // Second instance on the same root restores the stored case.
    const ctx2 = new Context()
    contexts.push(ctx2)
    mountStorage(ctx2, root)
    const service2 = new QzhLogAnalysisService(ctx2, { mirrorRoot: '/tmp/qzh-mirror' })
    const restored = await service2.getCase(sessionId, created.id)
    expect(restored.id).toBe(created.id)
    expect(restored.productVersion).toBe('3.9.17')
    expect(restored.feedback).toBe('like')
    expect(restored.feedbackComment).toBe('有帮助')
    expect(restored.evidence?.files[0]?.path).toBe('data/logs/qzh_web_agent.log')
    const toolApi = service2 as unknown as {
      currentCaseForTool: (id: SessionId) => QzhCaseView
    }
    expect(toolApi.currentCaseForTool(sessionId).id).toBe(created.id)
  })

  it('searches and reads the git tree pinned by the case product version', async () => {
    const { root, v2Commit } = makeGitMirror()
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalSubprocessRuntime)
    const service = new QzhLogAnalysisService(ctx, { mirrorRoot: root })
    const sessionId = 'session-versioned' as SessionId
    const created = await service.createCase(sessionId, { productVersion: 'v2.0.0' })

    const search = await service.searchCode(sessionId, created.id, 'server', 'TOKEN_V2', undefined)
    expect(search.commit).toBe(v2Commit)
    expect(search.matches.map(match => match.path)).toEqual(['src/service.go'])
    expect(search.matches[0]?.text).toContain('TOKEN_V2')

    const read = await service.readCode(sessionId, created.id, 'server', 'src/service.go', 1, 5)
    expect(read.commit).toBe(v2Commit)
    expect(read.text).toContain('TOKEN_V2')
    expect(read.text).not.toContain('TOKEN_V1')

    // A search term that only exists in the older tag must not leak through.
    const oldOnly = await service.searchCode(sessionId, created.id, 'server', 'TOKEN_V1', undefined)
    expect(oldOnly.matches).toEqual([])
  })

  it('falls back to the checkout HEAD when no product version is set', async () => {
    const { root } = makeGitMirror()
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalSubprocessRuntime)
    const service = new QzhLogAnalysisService(ctx, { mirrorRoot: root })
    const sessionId = 'session-head' as SessionId
    const created = await service.createCase(sessionId, {})
    const search = await service.searchCode(sessionId, created.id, 'server', 'TOKEN_HEAD', undefined)
    expect(search.matches.map(match => match.path)).toEqual(['src/service.go'])
    expect(search.matches[0]?.text).toContain('TOKEN_HEAD')
  })

  it('rejects a product version the mirror does not know', async () => {
    const { root } = makeGitMirror()
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalSubprocessRuntime)
    const service = new QzhLogAnalysisService(ctx, { mirrorRoot: root })
    const sessionId = 'session-badversion' as SessionId
    const created = await service.createCase(sessionId, { productVersion: 'v9.9.9' })
    await expect(service.searchCode(sessionId, created.id, 'server', 'TOKEN_V2', undefined)).rejects.toThrow('不存在')
  })

  it('assesses report structure: conclusion, evidence, and code location', () => {
    const full = assessReport('# 结论\n根因是 X。\n\n## 事实证据\n路径 a.log。\n\n## 代码定位\nserver@abc123 src/a.go:10')
    expect(full).toEqual({ conclusion: true, evidence: true, codeLocation: true })
    const noCode = assessReport('# 结论\n根因是 X。\n\n## 事实证据\n路径 a.log。')
    expect(noCode).toEqual({ conclusion: true, evidence: true, codeLocation: false })
    const onlyConclusion = assessReport('# 结论\n根因是 X。')
    expect(onlyConclusion).toEqual({ conclusion: true, evidence: false, codeLocation: false })
    const empty = assessReport('   ')
    expect(empty).toEqual({ conclusion: false, evidence: false, codeLocation: false })
    // Plain text mentioning the words without headings also counts.
    const inline = assessReport('结论：配置缺失。事实证据见 logs.txt。代码定位见 server@abc123。')
    expect(inline).toEqual({ conclusion: true, evidence: true, codeLocation: true })
  })
})

/** Build an evidence-enabled service against a fresh temp evidence root. */
async function evidenceHarness(): Promise<{
  service: QzhLogAnalysisService
  sessionId: SessionId
  caseId: QzhCaseView['id']
  evidenceRoot: string
}> {
  const ctx = new Context()
  contexts.push(ctx)
  const evidenceRoot = mkdtempSync(join(tmpdir(), 'qzh-evidence-'))
  const service = new QzhLogAnalysisService(ctx, { mirrorRoot: '/tmp/qzh-mirror', evidenceRoot })
  const sessionId = 'session-evidence' as SessionId
  const created = await service.createCase(sessionId, {})
  return { service, sessionId, caseId: created.id, evidenceRoot }
}

/** Encode a zip with the given relative paths as base64. */
function zipOf(files: Record<string, string>): string {
  const data: Record<string, Uint8Array> = {}
  for (const [path, content] of Object.entries(files)) data[path] = strToU8(content)
  return Buffer.from(zipSync(data)).toString('base64')
}

describe('QzhLogAnalysisService evidence archive', () => {
  it('stores an uploaded archive and serves list/search/read from the extracted tree', async () => {
    const { service, sessionId, caseId } = await evidenceHarness()
    const saved = await service.uploadEvidenceArchive(sessionId, caseId, {
      filename: 'bundle.zip',
      contentBase64: zipOf({
        'server/logs/app.log': [
          '2026-08-21 10:00:00 INFO start',
          '2026-08-21 10:00:01 ERROR boom secret=abc',
          '2026-08-21 10:00:02 INFO end',
        ].join('\n'),
        'worker/w.out': 'worker line',
      }),
    })
    expect(saved.state).toBe('evidence-ready')
    expect(saved.archiveFilename).toBe('bundle.zip')

    const tree = await service.listEvidenceTree(sessionId, caseId)
    expect(tree.totalFiles).toBe(2)
    const paths = tree.files.map(file => file.path)
    expect(paths).toContain('server/logs/app.log')
    expect(paths).toContain('worker/w.out')
    const appLog = tree.files.find(file => file.path === 'server/logs/app.log')
    expect(appLog?.sample).toContain('INFO start')

    // The UI projection carries the uploaded bundle's display metadata.
    const view = await service.getEvidenceTree(sessionId, caseId)
    expect(view.summaryOnly).toBe(false)
    expect(view.archive).toMatchObject({ filename: 'bundle.zip' })
    expect(view.archive?.size).toBeGreaterThan(0)

    const hits = await service.searchEvidence(sessionId, caseId, 'ERROR', undefined, 100)
    expect(hits.matches).toEqual([
      { path: 'server/logs/app.log', line: 2, excerpt: '2026-08-21 10:00:01 ERROR boom [REDACTED]' },
    ])
    const filtered = await service.searchEvidence(sessionId, caseId, 'worker', 'worker', 100)
    expect(filtered.matches).toHaveLength(1)

    const read = await service.readEvidenceRange(sessionId, caseId, 'server/logs/app.log', 2, 2)
    expect(read.totalLines).toBe(3)
    expect(read.text).toBe('2026-08-21 10:00:01 ERROR boom [REDACTED]')
    expect(read.path).toBe('server/logs/app.log')
  })

  it('rejects uploads from another session and reads from a foreign case', async () => {
    const { service, sessionId, caseId } = await evidenceHarness()
    const upload = zipOf({ 'a.log': 'content' })
    const other = 'session-other' as SessionId
    await expect(service.uploadEvidenceArchive(other, caseId, {
      filename: 'b.zip', contentBase64: upload,
    })).rejects.toThrow('does not belong to session')
    await expect(service.listEvidenceTree(other, caseId)).rejects.toThrow('does not belong to session')
    expect(sessionId).not.toBe(other)
  })

  it('rejects a non-zip payload and a traversal entry', async () => {
    const { service, sessionId, caseId } = await evidenceHarness()
    await expect(service.uploadEvidenceArchive(sessionId, caseId, {
      filename: 'not.zip', contentBase64: Buffer.from('not a zip').toString('base64'),
    })).rejects.toThrow('must be a zip')

    await expect(service.uploadEvidenceArchive(sessionId, caseId, {
      filename: 'evil.zip', contentBase64: zipOf({ '../escape.log': 'bad' }),
    })).rejects.toThrow('invalid')
  })

  it('refuses a second upload and reports summary-only before any upload', async () => {
    const { service, sessionId, caseId } = await evidenceHarness()
    await expect(service.listEvidenceTree(sessionId, caseId)).rejects.toThrow('summary-only')

    const upload = zipOf({ 'a.log': 'one' })
    await service.uploadEvidenceArchive(sessionId, caseId, { filename: 'a.zip', contentBase64: upload })
    await expect(service.uploadEvidenceArchive(sessionId, caseId, {
      filename: 'b.zip', contentBase64: zipOf({ 'b.log': 'two' }),
    })).rejects.toThrow('already has extracted evidence')
    await expect(service.readEvidenceRange(sessionId, caseId, 'missing.log', undefined, undefined))
      .rejects.toThrow('not found')
  })

  it('caps search hits and bounds line reads', async () => {
    const { service, sessionId, caseId } = await evidenceHarness()
    const lines: string[] = []
    for (let index = 1; index <= 50; index += 1) lines.push(`line ${index} marker`)
    await service.uploadEvidenceArchive(sessionId, caseId, {
      filename: 'big.zip', contentBase64: zipOf({ 'big.log': lines.join('\n') }),
    })
    const capped = await service.searchEvidence(sessionId, caseId, 'marker', undefined, 10)
    expect(capped.matches).toHaveLength(10)
    expect(capped.truncated).toBe(true)

    const read = await service.readEvidenceRange(sessionId, caseId, 'big.log', 1, 500)
    expect(read.endLine).toBe(50)
    expect(read.text.split('\n')).toHaveLength(50)
  })
})

  it('serves the evidence tree via getEvidenceTree, degrading to the summary before upload', async () => {
    const { service, sessionId, caseId } = await evidenceHarness()
    await service.setEvidence(sessionId, caseId, {
      consent: { approved: true, destination: 'internal-qzh-analysis' },
      files: [{ path: 'server/logs/a.log', component: 'web-agent', stream: 'log', category: 'server', size: 5, sample: 'INFO x' }],
      clusters: [],
    })
    const before = await service.getEvidenceTree(sessionId, caseId)
    expect(before.totalFiles).toBe(1)
    expect(before.files[0]?.path).toBe('server/logs/a.log')
    expect(before.files[0]?.sample).toBe('INFO x')

    await service.uploadEvidenceArchive(sessionId, caseId, {
      filename: 'b.zip', contentBase64: zipOf({ 'server/logs/a.log': 'INFO x\nERROR boom' }),
    })
    const after = await service.getEvidenceTree(sessionId, caseId)
    expect(after.files[0]?.sample).toContain('INFO x')
  })
