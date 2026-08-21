import { randomUUID } from 'node:crypto'
import { realpath, readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import z from '@deepseek-ai/schemastery'
import type {
  QzhCaseId, QzhCaseView, QzhCodeMatch, QzhCodeReadResult,
  QzhCodeSearchResult, QzhCreateCaseRequest, QzhEvidenceSummary, QzhRepository,
  QzhAnalysisStartResult,
} from './types.ts'

export type * from './types.ts'

/** Host mirror configuration. The mirror root is never supplied by the browser. */
export interface Config {
  /** Absolute directory containing `server/`, `terminal/`, and optional `legacy/` mirrors. */
  mirrorRoot: string
  /** Maximum code bytes returned by one read operation. */
  maxReadBytes?: number
  /** Maximum matches returned by one search operation. */
  maxSearchResults?: number
  /** DSH provider route used for QZH analysis. */
  analysisProvider?: string
  /** DSH model id used for QZH analysis. */
  analysisModel?: string
  /** Maximum output tokens for one QZH report turn. */
  analysisMaxTokens?: number
}

type CaseRecord = { -readonly [K in keyof QzhCaseView]: QzhCaseView[K] }

const DEFAULT_MAX_READ_BYTES = 48 * 1024
const DEFAULT_MAX_SEARCH_RESULTS = 100
const COMMAND_GRACE_MS = 3_000
const STDERR_MAX_BYTES = 16 * 1024
const EVIDENCE_DESTINATION = 'internal-qzh-analysis' as const
const DEFAULT_ANALYSIS_PROVIDER = 'deepseek-official'
const DEFAULT_ANALYSIS_MODEL = 'deepseek-v4-flash'
const DEFAULT_ANALYSIS_MAX_TOKENS = 16_384

function caseId(value: string): QzhCaseId {
  return value as QzhCaseId
}

function now(): number {
  return Date.now()
}

function trimOptional(value: string | undefined, maxBytes: number): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  return Buffer.byteLength(trimmed, 'utf8') <= maxBytes
    ? trimmed
    : Buffer.from(trimmed, 'utf8').subarray(0, maxBytes).toString('utf8')
}

const SENSITIVE_TEXT = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|password|passwd|secret)\s*[:=]\s*[^\s,;]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
]

function redactSensitiveText(value: string): string {
  return SENSITIVE_TEXT.reduce((current, pattern) => current.replace(pattern, '[REDACTED]'), value)
}

function evidencePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '')
  if (normalized.includes('\0') || normalized.split('/').some(segment => segment === '..' || segment === '')) {
    throw new Error('QZH evidence path is invalid')
  }
  if (!normalized.startsWith('data/logs/')) {
    throw new Error('QZH evidence path must be under /data/logs')
  }
  return normalized
}

function sanitizeEvidence(evidence: QzhEvidenceSummary): QzhEvidenceSummary {
  const files = evidence.files.slice(0, 500).map(file => ({
    path: evidencePath(file.path),
    component: file.component,
    stream: file.stream,
    size: Number.isSafeInteger(file.size) && file.size >= 0 ? file.size : 0,
  }))
  const clusters = evidence.clusters.slice(0, 500).map(cluster => ({
    key: redactSensitiveText(cluster.key).slice(0, 512),
    component: cluster.component,
    severity: cluster.severity,
    count: Number.isSafeInteger(cluster.count) && cluster.count > 0 ? cluster.count : 1,
    ...cluster.firstTimestamp === undefined ? {} : { firstTimestamp: cluster.firstTimestamp },
    ...cluster.lastTimestamp === undefined ? {} : { lastTimestamp: cluster.lastTimestamp },
    ...cluster.sample === undefined ? {} : { sample: redactSensitiveText(cluster.sample).slice(0, 1_000) },
  }))
  const excerpt = evidence.excerpt === undefined ? undefined : redactSensitiveText(evidence.excerpt).slice(0, 64 * 1024)
  return { consent: { approved: true, destination: EVIDENCE_DESTINATION }, files, clusters, ...(excerpt === undefined ? {} : { excerpt }) }
}

function ensureRepository(value: QzhRepository): QzhRepository {
  if (value === 'server' || value === 'terminal' || value === 'legacy') return value
  throw new Error(`QZH repository ${String(value)} is not supported`)
}

function ensureRelativePath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  if (normalized.length === 0 || normalized.startsWith('/') || normalized.includes('\0')) {
    throw new Error('QZH source path must be a non-empty relative path')
  }
  const segments = normalized.split('/')
  if (segments.some(segment => segment === '..' || segment === '')) {
    throw new Error('QZH source path may not escape the mirror repository')
  }
  return normalized
}

function parseSearchOutput(output: string, maxResults: number): QzhCodeMatch[] {
  const matches: QzhCodeMatch[] = []
  for (const line of output.split(/\r?\n/)) {
    if (line.length === 0) continue
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const lineEnd = line.indexOf(':', separator + 1)
    if (lineEnd <= separator) continue
    const number = Number(line.slice(separator + 1, lineEnd))
    if (!Number.isInteger(number) || number < 1) continue
    matches.push({ path: line.slice(0, separator), line: number, text: line.slice(lineEnd + 1).slice(0, 1_000) })
    if (matches.length >= maxResults) break
  }
  return matches
}

/** QZH Host case API and read-only source mirror service. */
export class QzhLogAnalysisService extends TypertRemoteService {
  static inject = ['subprocess', 'tools', 'systemPrompt', 'agents']
  static Config: z<Config> = z.object({
    mirrorRoot: z.string().required(),
    maxReadBytes: z.natural().default(DEFAULT_MAX_READ_BYTES),
    maxSearchResults: z.natural().default(DEFAULT_MAX_SEARCH_RESULTS),
    analysisProvider: z.string().default(DEFAULT_ANALYSIS_PROVIDER),
    analysisModel: z.string().default(DEFAULT_ANALYSIS_MODEL),
    analysisMaxTokens: z.natural().default(DEFAULT_ANALYSIS_MAX_TOKENS),
  })

  private readonly cases = new Map<QzhCaseId, CaseRecord>()
  private readonly maxReadBytes: number
  private readonly maxSearchResults: number
  private readonly mirrorRoot: string
  private readonly analysisProvider: string
  private readonly analysisModel: string
  private readonly analysisMaxTokens: number
  private readonly ownerCtx: Context
  private readonly analysisRuns = new Map<QzhCaseId, Promise<void>>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'qzhLogAnalysis')
    this.ownerCtx = ctx
    if (!isAbsolute(config.mirrorRoot)) throw new Error('QZH mirrorRoot must be absolute')
    this.mirrorRoot = resolve(config.mirrorRoot)
    this.maxReadBytes = config.maxReadBytes ?? DEFAULT_MAX_READ_BYTES
    this.maxSearchResults = config.maxSearchResults ?? DEFAULT_MAX_SEARCH_RESULTS
    this.analysisProvider = config.analysisProvider ?? DEFAULT_ANALYSIS_PROVIDER
    this.analysisModel = config.analysisModel ?? DEFAULT_ANALYSIS_MODEL
    this.analysisMaxTokens = config.analysisMaxTokens ?? DEFAULT_ANALYSIS_MAX_TOKENS
    const service = this
    const tools = ctx.get('tools')
    const systemPrompt = ctx.get('systemPrompt')
    if (tools === undefined || systemPrompt === undefined) return
    ctx.effect(() => {
      const promptDispose = systemPrompt.section({
        name: 'qzh:analysis-methodology',
        order: -20,
        text: '你是 QZH 故障分析 Agent。只使用 qzh_search_code、qzh_read_code、qzh_compare_legacy 读取 QZH 代码；不得修改代码、执行 Shell 或猜测未提供的事实。先对齐日志时间和错误链，再定位调用路径，最后输出中文报告，明确区分事实、推断、证据引用、可信度、信息缺口和人工验证步骤。报告中的代码引用必须包含仓库、commit、文件路径和行号。',
      })
      const searchDispose = tools.register(defineTool({
        name: 'qzh_search_code',
        description: '在固定 QZH Git mirror 中进行只读固定字符串搜索。返回命中的仓库、commit、路径、行号和代码行。',
        parameters: {
          case_id: { type: 'string', required: true, description: '当前 QZH 案例 ID。' },
          repository: { type: 'string', required: true, enum: ['server', 'terminal', 'legacy'], description: 'server、terminal 或 legacy。' },
          query: { type: 'string', required: true, description: '要搜索的错误文本、函数名或路径片段。' },
        },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
          return await service.searchCode(caseId(args.case_id), args.repository, args.query, exec.signal) as unknown as Record<string, JsonValue>
        },
      }))
      const readDispose = tools.register(defineTool({
        name: 'qzh_read_code',
        description: '从固定 QZH Git mirror 读取有限行号范围的源码；只读且返回实际 commit。',
        parameters: {
          case_id: { type: 'string', required: true, description: '当前 QZH 案例 ID。' },
          repository: { type: 'string', required: true, enum: ['server', 'terminal', 'legacy'], description: 'server、terminal 或 legacy。' },
          path: { type: 'string', required: true, description: '仓库内相对路径。' },
          start_line: { type: 'number', description: '起始行号，默认 1。' },
          end_line: { type: 'number', description: '结束行号，最多读取 500 行。' },
        },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
          return await service.readCode(caseId(args.case_id), args.repository, args.path, args.start_line, args.end_line, exec.signal) as unknown as Record<string, JsonValue>
        },
      }))
      const compareDispose = tools.register(defineTool({
        name: 'qzh_compare_legacy',
        description: '读取 server/terminal 当前实现与 legacy 同路径源码，帮助判断迁移差异；只读。',
        parameters: {
          case_id: { type: 'string', required: true, description: '当前 QZH 案例 ID。' },
          path: { type: 'string', required: true, description: '同时存在于当前仓库和 legacy 仓库的相对路径。' },
          start_line: { type: 'number', description: '起始行号，默认 1。' },
          end_line: { type: 'number', description: '结束行号，最多读取 500 行。' },
        },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
          const path = args.path
          const current = await service.readCode(caseId(args.case_id), 'server', path, args.start_line, args.end_line, exec.signal)
          const legacy = await service.readCode(caseId(args.case_id), 'legacy', path, args.start_line, args.end_line, exec.signal)
          return { path, current, legacy } as unknown as Record<string, JsonValue>
        },
      }))
      return () => { promptDispose(); searchDispose(); readDispose(); compareDispose() }
    }, 'qzh-log-analysis:agent-capabilities')
  }

  /** Create an in-memory case record for the current Host process.
   * @param request - case metadata supplied by the browser.
   * @returns newly created case view.
   */
  @Remote('createCase')
  createCase(request: QzhCreateCaseRequest): QzhCaseView {
    const timestamp = now()
    const id = caseId(`qzh-case-${randomUUID()}`)
    const customerLabel = trimOptional(request.customerLabel, 256)
    const productVersion = trimOptional(request.productVersion, 128)
    const failureDescription = trimOptional(request.failureDescription, 8_192)
    const record: CaseRecord = {
      id,
      state: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp,
      ...customerLabel === undefined ? {} : { customerLabel },
      ...productVersion === undefined ? {} : { productVersion },
      ...failureDescription === undefined ? {} : { failureDescription },
    }
    this.cases.set(id, record)
    return { ...record }
  }

  /** Attach browser-approved parsed evidence; raw logs remain opt-in.
   * @param id - case identifier.
   * @param evidence - browser-approved evidence summary.
   * @returns updated case view.
   */
  @Remote('setEvidence')
  setEvidence(id: QzhCaseId, evidence: QzhEvidenceSummary): QzhCaseView {
    const record = this.requireCase(id)
    if (!evidence.consent.approved || evidence.consent.destination !== EVIDENCE_DESTINATION) {
      throw new Error('QZH evidence consent must approve the internal analysis destination')
    }
    const timestamp = now()
    const sanitized = sanitizeEvidence(evidence)
    const next: CaseRecord = {
      ...record,
      state: 'evidence-ready',
      updatedAt: timestamp,
      evidence: sanitized,
    }
    this.cases.set(id, next)
    return { ...next }
  }

  /** Start one DSH Agent Loop turn using the case evidence as logged context.
   * @param id - case identity.
   * @returns the admitted DSH analysis session and updated case.
   */
  @Remote('startAnalysis')
  async startAnalysis(id: QzhCaseId): Promise<QzhAnalysisStartResult> {
    const record = this.requireCase(id)
    if (record.evidence?.consent.approved !== true) throw new Error('QZH analysis requires approved evidence consent')
    if ((record.state === 'analyzing' || record.state === 'completed') && record.analysisSessionId !== undefined) {
      return { case: { ...record }, sessionId: record.analysisSessionId }
    }
    const existing = this.analysisRuns.get(id)
    if (existing !== undefined) return { case: { ...record }, sessionId: record.analysisSessionId ?? '' }
    const sessionId = SessionId(`qzh-analysis-${id}`)
    const next: CaseRecord = { ...record, state: 'analyzing', updatedAt: now(), analysisSessionId: sessionId }
    delete next.report
    delete next.analysisError
    this.cases.set(id, next)
    const run = this.runAnalysis(id, sessionId).finally(() => { this.analysisRuns.delete(id) })
    this.analysisRuns.set(id, run)
    return { case: { ...next }, sessionId }
  }

  /** Read one case summary without exposing the internal mutable record.
   * @param id - case identifier.
   * @returns detached case view.
   */
  @Remote('getCase')
  getCase(id: QzhCaseId): QzhCaseView {
    return { ...this.requireCase(id) }
  }

  /** Search one configured mirror with the packaged ripgrep binary.
   * @param id - case identifier authorizing the lookup.
   * @param repository - configured QZH repository.
   * @param query - fixed-string search query.
   * @param signal - optional cancellation signal.
   * @returns bounded matches and the exact mirror commit.
   */
  @Remote('searchCode')
  async searchCode(id: QzhCaseId, repository: QzhRepository, query: string, signal?: AbortSignal): Promise<QzhCodeSearchResult> {
    this.requireCase(id)
    const repo = ensureRepository(repository)
    const root = await this.repositoryRoot(repo)
    const text = query.trim()
    if (text.length === 0 || text.length > 512) throw new Error('QZH code query must contain 1-512 characters')
    const rgPath = await import('@vscode/ripgrep').then(module => module.rgPath)
    const handle = this.ctx.subprocess.spawn({
      argv: [rgPath, '--no-config', '--fixed-strings', '--line-number', '--no-heading', '--color', 'never', text, '.'],
      cwd: root,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 2 * 1024 * 1024 }, stderr: { maxBytes: STDERR_MAX_BYTES } },
      graceMs: COMMAND_GRACE_MS,
      signal,
    } satisfies SubprocessSpawnSpec)
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0)
    const stderr = handle.collected.stderr?.readFrom(0)
    if (stdout === undefined || stderr === undefined) throw new Error('QZH source search did not return collected output')
    if (outcome.signal !== null || (outcome.exitCode !== 0 && outcome.exitCode !== 1)) {
      throw new Error(`QZH source search failed: ${stderr.text.trim() || `exit ${String(outcome.exitCode)}`}`)
    }
    const commit = await this.currentCommit(root, signal)
    return { repository: repo, commit, query: text, matches: parseSearchOutput(stdout.text, this.maxSearchResults) }
  }

  /** Read a bounded source slice from the configured mirror.
   * @param id - case identifier authorizing the lookup.
   * @param repository - configured QZH repository.
   * @param path - repository-relative source path.
   * @param startLine - one-based first line, defaulting to one.
   * @param endLine - one-based inclusive last line.
   * @param signal - optional cancellation signal.
   * @returns bounded source text and the exact mirror commit.
   */
  @Remote('readCode')
  async readCode(id: QzhCaseId, repository: QzhRepository, path: string, startLine?: number, endLine?: number, signal?: AbortSignal): Promise<QzhCodeReadResult> {
    this.requireCase(id)
    const repo = ensureRepository(repository)
    const safePath = ensureRelativePath(path)
    const requestedStart = startLine ?? 1
    const first = Number.isInteger(requestedStart) && requestedStart > 0 ? requestedStart : 1
    const requestedEnd = endLine ?? first + 119
    const last = Number.isInteger(requestedEnd) && requestedEnd >= first ? Math.min(requestedEnd, first + 499) : first + 119
    const root = await this.repositoryRoot(repo)
    const filePath = resolve(root, safePath)
    const canonical = await realpath(filePath)
    if (!this.isWithin(root, canonical)) throw new Error('QZH source path resolves outside the configured mirror')
    const info = await stat(canonical)
    if (!info.isFile()) throw new Error('QZH source path is not a regular file')
    const bytes = await readFile(canonical)
    if (bytes.byteLength > this.maxReadBytes) throw new Error(`QZH source file exceeds ${String(this.maxReadBytes)} bytes`)
    const lines = bytes.toString('utf8').split(/\r?\n/)
    const text = lines.slice(first - 1, last).join('\n')
    return { repository: repo, commit: await this.currentCommit(root, signal), path: safePath, startLine: first, endLine: Math.min(last, lines.length), text }
  }

  private requireCase(id: QzhCaseId): CaseRecord {
    const record = this.cases.get(id)
    if (record === undefined) throw new Error(`QZH case ${String(id)} was not found`)
    return record
  }

  private async runAnalysis(id: QzhCaseId, sessionId: string): Promise<void> {
    try {
      const record = this.requireCase(id)
      const agent = (await this.ownerCtx.agents.create({
        sessionId: SessionId(sessionId),
        agentOptions: { provider: this.analysisProvider, model: this.analysisModel, maxTokens: this.analysisMaxTokens },
        meta: { cwd: this.mirrorRoot },
        setup: (agentCtx) => {
          agentCtx.tools.restrict({ allow: ['qzh_search_code', 'qzh_read_code', 'qzh_compare_legacy'] })
        },
      })).agent
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: this.analysisPrompt(record) }],
        source: { kind: 'plugin', plugin: 'qzh-log-analysis', form: 'instructions' },
      }))
      await agent.whenIdle()
      const report = agent.session.events
        .filter(event => event.type === 'assistant/message')
        .map(event => event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join(''))
        .filter(text => text.length > 0)
        .at(-1)
      const latest = this.requireCase(id)
      const completed: CaseRecord = {
        ...latest,
        state: report === undefined ? 'failed' : 'completed',
        updatedAt: now(),
        ...(report === undefined ? { analysisError: 'DSH Agent 未返回文本报告' } : { report }),
      }
      if (report === undefined) delete completed.report
      else delete completed.analysisError
      this.cases.set(id, completed)
    } catch (error: unknown) {
      const latest = this.requireCase(id)
      const failed: CaseRecord = {
        ...latest,
        state: 'failed',
        updatedAt: now(),
        analysisError: error instanceof Error ? error.message : String(error),
      }
      delete failed.report
      this.cases.set(id, failed)
    }
  }

  private analysisPrompt(record: CaseRecord): string {
    const evidence = record.evidence
    if (evidence === undefined) throw new Error('QZH case has no evidence')
    return [
      '请分析下面这个 QZH 故障案例。日志摘要已经过 Host 二次脱敏；不得要求完整日志，也不得执行写操作。',
      `案例 ID：${record.id}`,
      `QZH 版本：${record.productVersion ?? '未知'}`,
      `故障描述：${record.failureDescription ?? '未提供'}`,
      `日志文件：${JSON.stringify(evidence.files)}`,
      `异常聚类：${JSON.stringify(evidence.clusters)}`,
      `日志短样例：${evidence.excerpt ?? '未提供'}`,
      '请按以下结构输出中文报告：结论；事实证据；代码定位（仓库/commit/路径/行号）；根因推断；可信度；信息缺口；现场验证步骤；修复建议（只描述，不修改代码）。',
    ].join('\n')
  }

  private isWithin(root: string, candidate: string): boolean {
    const prefix = relative(root, candidate)
    return prefix === '' || (!prefix.startsWith(`..${sep}`) && prefix !== '..' && !isAbsolute(prefix))
  }

  private async repositoryRoot(repository: QzhRepository): Promise<string> {
    const root = await realpath(resolve(this.mirrorRoot, repository))
    if (!this.isWithin(this.mirrorRoot, root)) throw new Error('QZH repository resolves outside the configured mirror root')
    return root
  }

  private async currentCommit(root: string, signal?: AbortSignal): Promise<string> {
    const git = await this.ctx.subprocess.resolveExecutable('git', undefined, signal)
    const handle = this.ctx.subprocess.spawn({
      argv: [git, '-C', root, 'rev-parse', 'HEAD'],
      cwd: root,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 128 }, stderr: { maxBytes: STDERR_MAX_BYTES } },
      graceMs: COMMAND_GRACE_MS,
      signal,
    } satisfies SubprocessSpawnSpec)
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0)
    if (outcome.exitCode !== 0 || outcome.signal !== null || stdout === undefined) throw new Error('QZH mirror is not a readable Git checkout')
    const commit = stdout.text.trim()
    if (!/^[0-9a-f]{7,64}$/i.test(commit)) throw new Error('QZH mirror returned an invalid Git commit')
    return commit
  }
}

export default QzhLogAnalysisService
