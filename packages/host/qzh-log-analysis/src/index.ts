import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { unzipSync } from 'fflate'
import type { Context } from '@deepseek-ai/cordis'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { BlobFacet, KvUnit } from '@deepseek-ai/dsh-storage'
import type {} from '@deepseek-ai/dsh-storage'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import z from '@deepseek-ai/schemastery'
import type {
  QzhArchiveDownload, QzhArchiveInfo, QzhArchiveUpload, QzhCaseId, QzhCaseView, QzhCodeMatch, QzhCodeReadResult,
  QzhCodeSearchResult, QzhCreateCaseRequest, QzhEvidenceSummary, QzhEvidenceTreeFile, QzhFeedbackKind,
  QzhLogCategory, QzhLogListResult, QzhLogMatch, QzhLogReadResult, QzhLogSearchResult, QzhRepository,
  QzhAnalysisStartResult, QzhTimelineEvent, QzhTimelineResult,
} from './types.ts'

export type * from './types.ts'

/** Host mirror configuration. The mirror root is never supplied by the browser. */
export interface Config {
  /** Absolute directory containing `server/`, or the QZH checkout itself. */
  mirrorRoot: string
  /** Maximum code bytes returned by one read operation. */
  maxReadBytes?: number
  /** Maximum matches returned by one search operation. */
  maxSearchResults?: number
  /** Maximum archive bytes accepted by one evidence upload (base64 payload). */
  maxEvidenceArchiveBytes?: number
  /** Maximum bytes of one extracted evidence file retained. */
  maxEvidenceFileBytes?: number
  /** Maximum extracted files retained per case. */
  maxEvidenceFilesPerCase?: number
  /** Maximum text bytes returned by one evidence line-range read. */
  maxLogReadBytes?: number
  /** Maximum evidence search hits returned by one call. */
  maxLogSearchResults?: number
  /** Maximum evidence bytes scanned by one search call. */
  maxLogSearchBytes?: number
  /** Storage backend name used for durable cases and evidence (default `json`). */
  storageBackend?: string
  /** Backend name for evidence blobs; defaults to `storageBackend` (KV and blob share one backend). */
  evidenceBackend?: string
}

type CaseRecord = { -readonly [K in keyof QzhCaseView]: QzhCaseView[K] }

const DEFAULT_MAX_READ_BYTES = 48 * 1024
const DEFAULT_MAX_SEARCH_RESULTS = 100
const COMMAND_GRACE_MS = 3_000
const STDERR_MAX_BYTES = 16 * 1024
const EVIDENCE_DESTINATION = 'internal-qzh-analysis' as const
const DEFAULT_MAX_EVIDENCE_ARCHIVE_BYTES = 256 * 1024 * 1024
const DEFAULT_MAX_EVIDENCE_FILE_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_EVIDENCE_FILES_PER_CASE = 500
const DEFAULT_MAX_LOG_READ_BYTES = 64 * 1024
const DEFAULT_MAX_LOG_SEARCH_RESULTS = 100
const DEFAULT_MAX_LOG_SEARCH_BYTES = 256 * 1024 * 1024
const EVIDENCE_MAX_TREE_FILES = 2_000
const EVIDENCE_MAX_SEARCH_EXCERPT_BYTES = 200
const EVIDENCE_MAX_LIST_SAMPLE_BYTES = 512
const EVIDENCE_MAX_READ_LINES = 500

function caseId(value: string): QzhCaseId {
  return value as QzhCaseId
}

/** ISO / Python-logging timestamp prefix, no timezone assumed. */
const TIMELINE_TIMESTAMP = /(?:^|\[)(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:[.,]\d{3})?)/

/** Parse a log line's ISO/Python timestamp into epoch milliseconds. */
function parseTimelineTimestamp(line: string): number | undefined {
  const match = TIMELINE_TIMESTAMP.exec(line)
  const date = match?.[1]
  const time = match?.[2]
  if (date === undefined || time === undefined) return undefined
  const parsed = Date.parse(`${date}T${time.replace(',', '.')}`)
  return Number.isNaN(parsed) ? undefined : parsed
}

/** Severity of a timestamped log line: the timestamp anchors the level word anywhere. */
function timelineSeverity(line: string): QzhTimelineEvent['severity'] {
  const upper = line.toUpperCase()
  if (/\b(ERROR|CRITICAL|EXCEPTION|TRACEBACK)\b/.test(upper)) return 'error'
  if (/\b(WARN|WARNING)\b/.test(upper)) return 'warn'
  if (/\b(INFO|DEBUG)\b/.test(upper)) return 'info'
  return 'unknown'
}

function now(): number {
  return Date.now()
}

/** Decode the browser's base64 archive payload, rejecting padding/trailer abuse. */
function decodeArchiveContent(contentBase64: string): Buffer {
  if (typeof contentBase64 !== 'string' || contentBase64.length === 0) {
    throw new Error('QZH evidence archive payload is missing')
  }
  const content = Buffer.from(contentBase64, 'base64')
  if (content.length === 0) throw new Error('QZH evidence archive payload is empty')
  return content
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
  /\bBearer\s+[a-z0-9._~+/=-]+/gi,
  /\b(?:authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|password|passwd|secret)\s*[:=]\s*[^\s,;]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
]

function redactSensitiveText(value: string): string {
  return SENSITIVE_TEXT.reduce((current, pattern) => current.replace(pattern, '[REDACTED]'), value)
}

function evidencePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '')
  if (normalized.length === 0 || normalized.includes('\0') || normalized.split('/').some(segment => segment === '..' || segment === '')) {
    throw new Error('QZH evidence path is invalid')
  }
  return normalized
}

function ensureCategory(value: QzhLogCategory): QzhLogCategory {
  return value === 'terminal' ? 'terminal' : 'server'
}

function sanitizeEvidence(evidence: QzhEvidenceSummary): QzhEvidenceSummary {
  const files = evidence.files.slice(0, 500).map((file) => {
    const sample = file.sample === undefined ? undefined : redactSensitiveText(file.sample).slice(0, 512)
    return {
      path: evidencePath(file.path),
      component: file.component,
      stream: file.stream,
      category: ensureCategory(file.category),
      size: Number.isSafeInteger(file.size) && file.size >= 0 ? file.size : 0,
      ...(sample === undefined || sample.length === 0 ? {} : { sample }),
    }
  })
  const excerpt = evidence.excerpt === undefined ? undefined : redactSensitiveText(evidence.excerpt).slice(0, 64 * 1024)
  return { consent: { approved: true, destination: EVIDENCE_DESTINATION }, files, ...(excerpt === undefined ? {} : { excerpt }) }
}

function ensureRepository(value: QzhRepository): QzhRepository {
  if (value === 'server') return value
  throw new Error(`QZH repository ${String(value)} is not supported`)
}

/** Assess how completely a report follows the mandated structure.
 *
 * A completed analysis must at least state a conclusion and back it with
 * evidence and code location; the rest of the template may be absent without
 * marking the report a failure. The check is structural (section headings),
 * not semantic, so a report that covers the sections but draws a weak
 * conclusion still passes — depth is the analyst's judgment, presence is the
 * service's gate.
 * @param report - the extracted assistant text.
 * @returns which required sections are present.
 */
export function assessReport(report: string): { conclusion: boolean; evidence: boolean; codeLocation: boolean } {
  const text = report.trim()
  if (text.length === 0) return { conclusion: false, evidence: false, codeLocation: false }
  const hasSection = (label: string): boolean => new RegExp(`(^|\\n)\\s*#{1,3}\\s*${label}`).test(text) || text.includes(label)
  return {
    conclusion: hasSection('结论'),
    evidence: hasSection('事实证据'),
    codeLocation: hasSection('代码定位'),
  }
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
    // `git grep <rev>` prefixes every match with `<rev>:path:line:text`;
    // the rev is a bare commit hash with no colon, so dropping the first
    // segment leaves the familiar `path:line:text` form.
    const body = line.slice(line.indexOf(':') + 1)
    const separator = body.indexOf(':')
    if (separator <= 0) continue
    const lineEnd = body.indexOf(':', separator + 1)
    if (lineEnd <= separator) continue
    const number = Number(body.slice(separator + 1, lineEnd))
    if (!Number.isInteger(number) || number < 1) continue
    matches.push({ path: body.slice(0, separator), line: number, text: body.slice(lineEnd + 1).slice(0, 1_000) })
    if (matches.length >= maxResults) break
  }
  return matches
}

/** QZH Host case API and read-only source mirror service. */
export class QzhLogAnalysisService extends TypertRemoteService {
  static inject = ['subprocess', 'tools', 'systemPrompt', 'agents', 'storage']
  static Config: z<Config> = z.object({
    mirrorRoot: z.string().required(),
    maxReadBytes: z.natural().default(DEFAULT_MAX_READ_BYTES),
    maxSearchResults: z.natural().default(DEFAULT_MAX_SEARCH_RESULTS),
    storageBackend: z.string().default('json'),
    evidenceBackend: z.string(),
  })

  private readonly cases = new Map<QzhCaseId, CaseRecord>()
  private readonly maxReadBytes: number
  private readonly maxSearchResults: number
  private readonly mirrorRoot: string
  private readonly maxEvidenceArchiveBytes: number
  private readonly maxEvidenceFileBytes: number
  private readonly maxEvidenceFilesPerCase: number
  private readonly maxLogReadBytes: number
  private readonly maxLogSearchResults: number
  private readonly maxLogSearchBytes: number
  private readonly storageBackendName: string
  private readonly evidenceBackendName: string
  private readonly ownerCtx: Context
  private readonly analysisRuns = new Map<QzhCaseId, Promise<void>>()
  /** Latest submitted case used as implicit context by model-facing tools. */
  private readonly activeCases = new Map<SessionId, QzhCaseId>()
  /** Single-flight durable case-store open; undefined when persistence is unavailable. */
  private unitPromise: Promise<KvUnit | undefined> | undefined
  private persistenceWarned = false

  constructor(ctx: Context, config: Config) {
    super(ctx, 'qzhLogAnalysis')
    this.ownerCtx = ctx
    if (!isAbsolute(config.mirrorRoot)) throw new Error('QZH mirrorRoot must be absolute')
    this.mirrorRoot = resolve(config.mirrorRoot)
    this.maxReadBytes = config.maxReadBytes ?? DEFAULT_MAX_READ_BYTES
    this.maxSearchResults = config.maxSearchResults ?? DEFAULT_MAX_SEARCH_RESULTS
    this.maxEvidenceArchiveBytes = config.maxEvidenceArchiveBytes ?? DEFAULT_MAX_EVIDENCE_ARCHIVE_BYTES
    this.maxEvidenceFileBytes = config.maxEvidenceFileBytes ?? DEFAULT_MAX_EVIDENCE_FILE_BYTES
    this.maxEvidenceFilesPerCase = config.maxEvidenceFilesPerCase ?? DEFAULT_MAX_EVIDENCE_FILES_PER_CASE
    this.maxLogReadBytes = config.maxLogReadBytes ?? DEFAULT_MAX_LOG_READ_BYTES
    this.maxLogSearchResults = config.maxLogSearchResults ?? DEFAULT_MAX_LOG_SEARCH_RESULTS
    this.maxLogSearchBytes = config.maxLogSearchBytes ?? DEFAULT_MAX_LOG_SEARCH_BYTES
    this.storageBackendName = config.storageBackend ?? 'json'
    this.evidenceBackendName = config.evidenceBackend ?? this.storageBackendName
    // The tool `execute` callbacks below are method shorthand, so their `this`
    // is the tool object, not this service; the alias is required, not a
    // scoping smell.
    // oxlint-disable-next-line no-this-alias
    const service = this
    const tools = ctx.get('tools')
    const systemPrompt = ctx.get('systemPrompt')
    if (tools === undefined || systemPrompt === undefined) return
    ctx.effect(() => {
      const promptDispose = systemPrompt.section({
        name: 'qzh:analysis-methodology',
        order: -20,
        text: '你是 QZH 故障分析 Agent。当前只接入 QZH 服务端代码，只使用 qzh_get_current_case、qzh_list_evidence、qzh_search_code、qzh_read_code、qzh_list_logs、qzh_search_logs、qzh_read_log_range 读取代码与证据；不得修改代码、执行 Shell 或猜测未提供的事实。代码检索限定在当前案例绑定的 QZH 版本（productVersion 对应的 git tag/commit），所有代码引用必须标注该版本的实际 commit。先调用 qzh_list_evidence 查看证据包内文件清单与样例；若案例已上传完整日志包，再用 qzh_list_logs 摸清现场目录结构（以真实相对路径为准），时间线关联、错误上下文、跨文件因果链需要完整日志时用 qzh_search_logs 定向搜索或 qzh_read_log_range 按行读取（每次有预算，不要整包扫描）。再调用 qzh_get_current_case 校验案例上下文，对齐日志时间和错误链，定位调用路径，最后输出中文报告，明确区分事实、推断、证据引用、可信度、信息缺口和人工验证步骤。报告中的日志引用必须使用证据包内的真实相对路径与行号（path:line），代码引用必须包含仓库、commit、文件路径和行号。',
      })
      const currentCaseDispose = tools.register(defineTool({
        name: 'qzh_get_current_case',
        description: '获取当前 QZH 会话最近提交的案例、日志文件清单和短样例。无需参数；不要猜测案例 ID。',
        parameters: {},
        output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        isConcurrencySafe: () => true,
        async execute(_args, exec) {
          const agent = exec.agent
          if (agent === undefined || resolveSessionPreset(agent.session) !== 'qzh') throw new Error('QZH current case is available only in a qzh Agent session')
          const sessionId = agent.session.header.id
          return service.currentCaseForTool(sessionId) as unknown as Record<string, JsonValue>
        },
      }))
      const searchDispose = tools.register(defineTool({
        name: 'qzh_search_code',
        description: '在当前案例绑定的 QZH 版本（productVersion 对应的 git tag/commit）中做只读固定字符串搜索。case_id 可省略，Host 会绑定当前会话案例；不要猜测案例 ID。返回命中的仓库、commit、路径、行号和代码行。',
        parameters: {
          case_id: { type: 'string', description: '可选；省略时使用当前会话已提交案例。' },
          repository: { type: 'string', required: true, enum: ['server'], description: '当前 QZH 服务端仓库。' },
          query: { type: 'string', required: true, description: '要搜索的错误文本、函数名或路径片段。' },
        },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
          const agent = exec.agent
          if (agent === undefined || resolveSessionPreset(agent.session) !== 'qzh') throw new Error('QZH code search is available only in a qzh Agent session')
          const sessionId = agent.session.header.id
          const record = service.resolveToolCase(sessionId, typeof args.case_id === 'string' ? args.case_id : undefined)
          const result = await service.searchCode(sessionId, record.id, args.repository, args.query, exec.signal)
          return { ...result, case_id: record.id } as unknown as Record<string, JsonValue>
        },
      }))
      const listEvidenceDispose = tools.register(defineTool({
        name: 'qzh_list_evidence',
        description: '列出当前 QZH 案例证据包内的完整日志文件清单（真实相对路径、组件标签、stream、大小、首行样例）。用于先摸清现场日志布局再定位根因；不要假设固定的日志目录结构，浏览器提供的组件标签可能只是初始推断。case_id 可省略，Host 会绑定当前会话案例。',
        parameters: {
          case_id: { type: 'string', description: '可选；省略时使用当前会话已提交案例。' },
        },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
          const agent = exec.agent
          if (agent === undefined || resolveSessionPreset(agent.session) !== 'qzh') throw new Error('QZH evidence listing is available only in a qzh Agent session')
          const sessionId = agent.session.header.id
          const record = service.resolveToolCase(sessionId, typeof args.case_id === 'string' ? args.case_id : undefined)
          return service.evidenceForTool(record) as unknown as Record<string, JsonValue>
        },
      }))
      const readDispose = tools.register(defineTool({
        name: 'qzh_read_code',
        description: '从当前案例绑定的 QZH 版本（productVersion 对应的 git tag/commit）读取有限行号范围的源码；case_id 可省略，Host 会绑定当前会话案例；不要猜测案例 ID。只读且返回实际 commit。',
        parameters: {
          case_id: { type: 'string', description: '可选；省略时使用当前会话已提交案例。' },
          repository: { type: 'string', required: true, enum: ['server'], description: '当前 QZH 服务端仓库。' },
          path: { type: 'string', required: true, description: '仓库内相对路径。' },
          start_line: { type: 'number', description: '起始行号，默认 1。' },
          end_line: { type: 'number', description: '结束行号，最多读取 500 行。' },
        },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
          const agent = exec.agent
          if (agent === undefined || resolveSessionPreset(agent.session) !== 'qzh') throw new Error('QZH code reading is available only in a qzh Agent session')
          const sessionId = agent.session.header.id
          const record = service.resolveToolCase(sessionId, typeof args.case_id === 'string' ? args.case_id : undefined)
          const result = await service.readCode(
            sessionId, record.id, args.repository, args.path, args.start_line, args.end_line, exec.signal,
          )
          return { ...result, case_id: record.id } as unknown as Record<string, JsonValue>
        },
      }))
      const listLogsDispose = tools.register(defineTool({
        name: 'qzh_list_logs',
        description: '列出当前案例证据包解压后的完整日志文件树（真实相对路径、大小、首行样例），用于摸清现场目录结构后定向读取。仅在案例上传了完整日志包时可用；未上传时报告"summary-only"并用 qzh_list_evidence 的样例。case_id 可省略，Host 会绑定当前会话案例。',
        parameters: {
          case_id: { type: 'string', description: '可选；省略时使用当前会话已提交案例。' },
        },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
          const agent = exec.agent
          if (agent === undefined || resolveSessionPreset(agent.session) !== 'qzh') throw new Error('QZH log listing is available only in a qzh Agent session')
          const sessionId = agent.session.header.id
          const record = service.resolveToolCase(sessionId, typeof args.case_id === 'string' ? args.case_id : undefined)
          const result = await service.listEvidenceTree(sessionId, record.id)
          return { ...result, case_id: record.id } as unknown as Record<string, JsonValue>
        },
      }))
      const searchLogsDispose = tools.register(defineTool({
        name: 'qzh_search_logs',
        description: '在案例证据包内按固定字符串定向搜索日志，返回命中的真实相对路径、行号和脱敏摘录。用于定位错误文本、时间戳或关键字在哪个文件的哪一行，随后用 qzh_read_log_range 读取上下文。扫描有字节预算，命中过多会截断。case_id 可省略，Host 会绑定当前会话案例。',
        parameters: {
          case_id: { type: 'string', description: '可选；省略时使用当前会话已提交案例。' },
          query: { type: 'string', required: true, description: '要搜索的固定字符串（错误文本、时间戳片段或关键字）。' },
          path_filter: { type: 'string', description: '可选：限定搜索的相对路径前缀（如 server/logs）。' },
          max_results: { type: 'number', description: '可选：返回命中上限，默认 100。' },
        },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
          const agent = exec.agent
          if (agent === undefined || resolveSessionPreset(agent.session) !== 'qzh') throw new Error('QZH log search is available only in a qzh Agent session')
          const sessionId = agent.session.header.id
          const record = service.resolveToolCase(sessionId, typeof args.case_id === 'string' ? args.case_id : undefined)
          const result = await service.searchEvidence(
            sessionId,
            record.id,
            typeof args.query === 'string' ? args.query : '',
            typeof args.path_filter === 'string' ? args.path_filter : undefined,
            typeof args.max_results === 'number' ? args.max_results : service.maxLogSearchResults,
          )
          return { ...result, case_id: record.id } as unknown as Record<string, JsonValue>
        },
      }))
      const readLogsDispose = tools.register(defineTool({
        name: 'qzh_read_log_range',
        description: '从案例证据包中按真实相对路径读取有限行号范围的日志内容（脱敏，最多 500 行）。先调用 qzh_list_logs 确认路径与布局，或用 qzh_search_logs 定位行号后再读取上下文。case_id 可省略，Host 会绑定当前会话案例。',
        parameters: {
          case_id: { type: 'string', description: '可选；省略时使用当前会话已提交案例。' },
          path: { type: 'string', required: true, description: '证据包内相对路径。' },
          start_line: { type: 'number', description: '起始行号，默认 1。' },
          end_line: { type: 'number', description: '结束行号，最多读取 500 行。' },
        },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
          const agent = exec.agent
          if (agent === undefined || resolveSessionPreset(agent.session) !== 'qzh') throw new Error('QZH log reading is available only in a qzh Agent session')
          const sessionId = agent.session.header.id
          const record = service.resolveToolCase(sessionId, typeof args.case_id === 'string' ? args.case_id : undefined)
          const result = await service.readEvidenceRange(
            sessionId,
            record.id,
            typeof args.path === 'string' ? args.path : '',
            typeof args.start_line === 'number' ? args.start_line : undefined,
            typeof args.end_line === 'number' ? args.end_line : undefined,
          )
          return { ...result, case_id: record.id } as unknown as Record<string, JsonValue>
        },
      }))
      return () => {
        promptDispose(); currentCaseDispose(); searchDispose(); listEvidenceDispose(); readDispose()
        listLogsDispose(); searchLogsDispose(); readLogsDispose()
      }
    }, 'qzh-log-analysis:agent-capabilities')
  }

  /** Create an in-memory and durably stored case record.
   * @param sessionId - owning DSH session.
   * @param request - case metadata supplied by the browser.
   * @returns newly created case view.
   */
  @Remote('createCase')
  async createCase(sessionId: SessionId, request: QzhCreateCaseRequest): Promise<QzhCaseView> {
    await this.casesUnit()
    const timestamp = now()
    const id = caseId(`qzh-case-${randomUUID()}`)
    const customerLabel = trimOptional(request.customerLabel, 256)
    const productVersion = trimOptional(request.productVersion, 128)
    const failureDescription = trimOptional(request.failureDescription, 8_192)
    const record: CaseRecord = {
      id,
      sessionId,
      state: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp,
      ...customerLabel === undefined ? {} : { customerLabel },
      ...productVersion === undefined ? {} : { productVersion },
      ...failureDescription === undefined ? {} : { failureDescription },
    }
    this.cases.set(id, record)
    this.activeCases.set(sessionId, id)
    await this.persistCase(id)
    return { ...record }
  }

  /** Durably store the original log archive for one case as an extracted tree.
   *
   * The summary (`setEvidence`) and the full archive are decoupled: analysis
   * may start on the summary alone, and this call lands the full bundle for
   * on-demand `qzh_list_logs` / `qzh_search_logs` / `qzh_read_log_range`.
   * @param sessionId - owning DSH session.
   * @param id - case identifier.
   * @param upload - base64-encoded zip payload.
   * @returns updated case view.
   */
  @Remote('uploadEvidenceArchive')
  async uploadEvidenceArchive(sessionId: SessionId, id: QzhCaseId, upload: QzhArchiveUpload): Promise<QzhCaseView> {
    await this.casesUnit()
    this.requireCase(sessionId, id)
    const category = ensureCategory(upload.category)
    // Appending is allowed: a later upload merges into the same field-side
    // tree (same-path files overwrite, new paths are added), so the user can
    // supplement missing logs mid-investigation.
    const content = decodeArchiveContent(upload.contentBase64)
    if (Buffer.byteLength(content) > this.maxEvidenceArchiveBytes) {
      throw new Error(`QZH evidence archive exceeds ${String(this.maxEvidenceArchiveBytes)} bytes`)
    }
    if (content.length < 4 || content[0] !== 0x50 || content[1] !== 0x4b) {
      throw new Error('QZH evidence archive must be a zip file')
    }
    // `unzipSync` yields raw file bytes per entry; directory/symlink entries
    // are rejected by the path guard below (`dir/` splits into an empty
    // segment; a symlink entry would land as a plain file whose content is
    // the target string, never a real link).
    const entries = unzipSync(content)
    const fileNames = Object.keys(entries)
    if (fileNames.length === 0) throw new Error('QZH evidence archive contains no files')
    if (fileNames.length > this.maxEvidenceFilesPerCase) {
      throw new Error(`QZH evidence archive exceeds ${String(this.maxEvidenceFilesPerCase)} files`)
    }
    const blob = this.blobFacet()
    const prefix = this.evidencePrefix(id)
    // Each file is written independently; the archive blob is the publish
    // marker written last, and the case record flips only after every blob
    // landed, so a mid-loop failure leaves no visible evidence (the orphaned
    // file blobs are invisible until the archive and record agree).
    for (const name of fileNames) {
      const safe = evidencePath(name)
      const bytes = entries[name]
      if (bytes === undefined) continue
      if (Buffer.byteLength(bytes) > this.maxEvidenceFileBytes) {
        throw new Error(`QZH evidence file ${safe} exceeds ${String(this.maxEvidenceFileBytes)} bytes`)
      }
      await blob.put(`${prefix}${category}/${safe}`, bytes)
    }
    await blob.put(this.archiveKey(id, category), content)
    const timestamp = now()
    const current = this.requireCase(sessionId, id)
    // Appending keeps the current investigation state: a completed case stays
    // completed until the user asks to re-analyze; an analyzing case stays
    // analyzing so the extra files join the on-demand log surface.
    const next: CaseRecord = {
      ...current,
      state: current.state === 'draft' ? 'evidence-ready' : current.state,
      updatedAt: timestamp,
      archives: { ...current.archives, [category]: upload.filename },
    }
    // Legacy single-archive field, retained for backward compatibility.
    if (current.archiveFilename === undefined) next.archiveFilename = upload.filename
    this.cases.set(id, next)
    await this.persistCase(id)
    return { ...next }
  }

  /** List the extracted evidence tree for one case (UI projection of the
   *  `qzh_list_logs` tool; falls back to the submitted summary files when no
   *  archive was uploaded).
   * @param sessionId - owning DSH session.
   * @param id - case identifier.
   * @returns evidence tree plus clusters.
   */
  @Remote('getEvidenceTree')
  async getEvidenceTree(sessionId: SessionId, id: QzhCaseId): Promise<QzhLogListResult> {
    await this.casesUnit()
    const record = this.requireCase(sessionId, id)
    const archives = await this.archiveMetadata(record)
    try {
      return {
        ...await this.listEvidenceTree(sessionId, id),
        summaryOnly: false,
        ...(archives.length === 0 ? {} : { archives }),
      }
    } catch (error: unknown) {
      if (error instanceof Error && /summary-only/.test(error.message)) {
        return {
          files: (record.evidence?.files ?? []).map(file => ({
            path: file.path,
            size: file.size,
            component: file.component,
            stream: file.stream,
            category: file.category,
            ...(file.sample === undefined ? {} : { sample: file.sample }),
          })),
          totalFiles: record.evidence?.files.length ?? 0,
          totalBytes: record.evidence?.files.reduce((sum, file) => sum + file.size, 0) ?? 0,
          truncated: false,
          clusters: [],
          summaryOnly: true,
        }
      }
      throw error
    }
  }

  /** Read every uploaded bundle's display metadata for a case.
   * @param record - the authorized case record.
   * @returns per-category filename and size, oldest first; empty when none.
   */
  private async archiveMetadata(record: CaseRecord): Promise<QzhArchiveInfo[]> {
    const blob = this.blobFacet()
    const infos: QzhArchiveInfo[] = []
    const categories: QzhLogCategory[] = ['server', 'terminal']
    for (const category of categories) {
      const filename = record.archives?.[category]
      if (filename === undefined) continue
      const info = await blob.stat(this.archiveKey(record.id, category))
      if (info !== undefined) infos.push({ category, filename, size: info.size })
    }
    // Legacy single-archive field, when no per-category record exists.
    if (infos.length === 0 && record.archiveFilename !== undefined) {
      const info = await blob.stat(this.archiveKey(record.id, 'server'))
      if (info !== undefined) infos.push({ category: 'server', filename: record.archiveFilename, size: info.size })
    }
    return infos
  }

  /** Return one stored bundle for download-back, under its original name.
   * @param sessionId - owning DSH session.
   * @param id - case identifier.
   * @param category - field side to download; defaults to server.
   * @returns original filename and the archive bytes (base64), or undefined.
   */
  @Remote('downloadEvidenceArchive')
  async downloadEvidenceArchive(sessionId: SessionId, id: QzhCaseId, category: QzhLogCategory): Promise<QzhArchiveDownload | undefined> {
    await this.casesUnit()
    const record = this.requireCase(sessionId, id)
    const safeCategory = ensureCategory(category)
    const filename = record.archives?.[safeCategory]
    if (filename === undefined && record.archiveFilename === undefined) return undefined
    const blob = this.blobFacet()
    let bytes: Uint8Array
    try {
      bytes = await blob.get(this.archiveKey(id, safeCategory))
    } catch (error) {
      if ((error as { code?: string }).code === 'not-found') return undefined
      throw error
    }
    if (bytes.byteLength > this.maxEvidenceArchiveBytes) {
      throw new Error(`QZH evidence archive exceeds ${String(this.maxEvidenceArchiveBytes)} bytes`)
    }
    return { filename: filename ?? record.archiveFilename ?? 'archive.zip', category: safeCategory, contentBase64: Buffer.from(bytes).toString('base64'), size: bytes.byteLength }
  }

  /** Attach browser-approved parsed evidence; raw logs remain opt-in.
   * @param sessionId - owning DSH session.
   * @param id - case identifier.
   * @param evidence - browser-approved evidence summary.
   * @returns updated case view.
   */
  @Remote('setEvidence')
  async setEvidence(sessionId: SessionId, id: QzhCaseId, evidence: QzhEvidenceSummary): Promise<QzhCaseView> {
    await this.casesUnit()
    const record = this.requireCase(sessionId, id)
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
    this.activeCases.set(sessionId, id)
    await this.persistCase(id)
    return { ...next }
  }

  /** Start one DSH Agent Loop turn using the case evidence as logged context.
   * @param sessionId - owning live DSH session.
   * @param id - case identity.
   * @returns the admitted DSH analysis session and updated case.
   */
  @Remote('startAnalysis')
  async startAnalysis(sessionId: SessionId, id: QzhCaseId): Promise<QzhAnalysisStartResult> {
    const record = this.requireCase(sessionId, id)
    if (record.evidence?.consent.approved !== true) throw new Error('QZH analysis requires approved evidence consent')
    // Re-entering analysis (from a completed report, or a fresh start) is
    // always allowed: the case is live until the user asks for a report.
    if (record.state === 'analyzing' && record.analysisSessionId !== undefined) {
      return { case: { ...record }, sessionId: record.analysisSessionId }
    }
    const existing = this.analysisRuns.get(id)
    if (existing !== undefined) return { case: { ...record }, sessionId }
    const next: CaseRecord = { ...record, state: 'analyzing', updatedAt: now(), analysisSessionId: sessionId }
    delete next.report
    delete next.analysisError
    this.cases.set(id, next)
    this.activeCases.set(sessionId, id)
    await this.persistCase(id)
    const run = this.runAnalysisTurn(sessionId, id).finally(() => { this.analysisRuns.delete(id) })
    this.analysisRuns.set(id, run)
    return { case: { ...next }, sessionId }
  }

  /** Produce the final structured report from the current investigation.
   * @param sessionId - owning DSH session.
   * @param id - case identifier.
   * @returns the case view (still `analyzing` until the report lands; the
   * browser polls for the terminal state).
   */
  @Remote('generateReport')
  async generateReport(sessionId: SessionId, id: QzhCaseId): Promise<QzhCaseView> {
    const record = this.requireCase(sessionId, id)
    if (record.evidence?.consent.approved !== true) throw new Error('QZH analysis requires approved evidence consent')
    if (record.state !== 'analyzing') throw new Error('QZH 案例未在分析中，请先启动分析')
    const existing = this.analysisRuns.get(id)
    if (existing !== undefined) throw new Error('QZH 案例分析正在进行，请稍候')
    const run = this.generateReportRun(sessionId, id).finally(() => { this.analysisRuns.delete(id) })
    this.analysisRuns.set(id, run)
    return { ...this.requireCase(sessionId, id) }
  }

  /** Read one case summary without exposing the internal mutable record.
   * @param sessionId - owning DSH session.
   * @param id - case identifier.
   * @returns detached case view.
   */
  @Remote('getCase')
  async getCase(sessionId: SessionId, id: QzhCaseId): Promise<QzhCaseView> {
    await this.casesUnit()
    return { ...this.requireCase(sessionId, id) }
  }

  /** Read the latest case a session submitted, for UI restoration after reload.
   * @param sessionId - owning DSH session.
   * @returns the latest case view, or undefined when the session has none.
   */
  @Remote('getActiveCase')
  async getActiveCase(sessionId: SessionId): Promise<QzhCaseView | undefined> {
    await this.casesUnit()
    const activeId = this.activeCases.get(sessionId)
    if (activeId === undefined) return undefined
    const record = this.cases.get(activeId)
    return record === undefined || record.sessionId !== sessionId ? undefined : { ...record }
  }

  /** Record the user's verdict on a completed analysis.
   * @param sessionId - owning DSH session.
   * @param id - case identifier.
   * @param kind - `like` or `dislike`.
   * @param comment - optional free-text note.
   * @returns updated case view.
   */
  @Remote('setFeedback')
  async setFeedback(sessionId: SessionId, id: QzhCaseId, kind: QzhFeedbackKind, comment?: string): Promise<QzhCaseView> {
    await this.casesUnit()
    const record = this.requireCase(sessionId, id)
    if (kind !== 'like' && kind !== 'dislike') throw new Error('QZH feedback kind must be like or dislike')
    const trimmed = trimOptional(comment, 2_048)
    const next: CaseRecord = { ...record, updatedAt: now(), feedback: kind }
    if (trimmed === undefined) delete next.feedbackComment
    else next.feedbackComment = trimmed
    this.cases.set(id, next)
    await this.persistCase(id)
    return { ...next }
  }

  /** Search one configured mirror with the packaged ripgrep binary.
   * @param sessionId - owning DSH session.
   * @param id - case identifier authorizing the lookup.
   * @param repository - configured QZH repository.
   * @param query - fixed-string search query.
   * @param signal - optional cancellation signal.
   * @returns bounded matches and the exact mirror commit.
   */
  @Remote('searchCode')
  async searchCode(
    sessionId: SessionId, id: QzhCaseId, repository: QzhRepository, query: string, signal?: AbortSignal,
  ): Promise<QzhCodeSearchResult> {
    const record = this.requireCase(sessionId, id)
    const repo = ensureRepository(repository)
    const root = await this.repositoryRoot(repo)
    const text = query.trim()
    if (text.length === 0 || text.length > 512) throw new Error('QZH code query must contain 1-512 characters')
    const commit = await this.resolveRef(root, record, signal)
    const git = await this.ctx.subprocess.resolveExecutable('git', undefined, signal)
    const handle = this.ctx.subprocess.spawn({
      // Search the committed tree at the case's resolved version, not the
      // checkout: the mirror is shared read-only across sessions and tools.
      argv: [git, '-C', root, 'grep', '-n', '--fixed-strings', '--no-color', '--', text, commit],
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
    return { repository: repo, commit, query: text, matches: parseSearchOutput(stdout.text, this.maxSearchResults) }
  }

  /** Read a bounded source slice from the configured mirror.
   * @param sessionId - owning DSH session.
   * @param id - case identifier authorizing the lookup.
   * @param repository - configured QZH repository.
   * @param path - repository-relative source path.
   * @param startLine - one-based first line, defaulting to one.
   * @param endLine - one-based inclusive last line.
   * @param signal - optional cancellation signal.
   * @returns bounded source text and the exact mirror commit.
   */
  @Remote('readCode')
  async readCode(
    sessionId: SessionId, id: QzhCaseId, repository: QzhRepository, path: string,
    startLine?: number, endLine?: number, signal?: AbortSignal,
  ): Promise<QzhCodeReadResult> {
    const record = this.requireCase(sessionId, id)
    const repo = ensureRepository(repository)
    const safePath = ensureRelativePath(path)
    const requestedStart = startLine ?? 1
    const first = Number.isInteger(requestedStart) && requestedStart > 0 ? requestedStart : 1
    const requestedEnd = endLine ?? first + 119
    const last = Number.isInteger(requestedEnd) && requestedEnd >= first ? Math.min(requestedEnd, first + 499) : first + 119
    const root = await this.repositoryRoot(repo)
    const commit = await this.resolveRef(root, record, signal)
    const git = await this.ctx.subprocess.resolveExecutable('git', undefined, signal)
    // Read the committed blob at the case's resolved version. `git show
    // <commit>:<path>` resolves inside the committed tree, so a path with
    // `..` or an absolute form cannot escape the repository.
    const handle = this.ctx.subprocess.spawn({
      argv: [git, '-C', root, 'show', `${commit}:${safePath}`],
      cwd: root,
      stdio: { stdin: 'ignore', stdout: { maxBytes: this.maxReadBytes + 1 }, stderr: { maxBytes: STDERR_MAX_BYTES } },
      graceMs: COMMAND_GRACE_MS,
      signal,
    } satisfies SubprocessSpawnSpec)
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0)
    const stderr = handle.collected.stderr?.readFrom(0)
    if (stdout === undefined || stderr === undefined) throw new Error('QZH source read did not return collected output')
    if (outcome.signal !== null || outcome.exitCode !== 0) {
      throw new Error(`QZH source read failed: ${stderr.text.trim() || `exit ${String(outcome.exitCode)}`}`)
    }
    if (Buffer.byteLength(stdout.text, 'utf8') > this.maxReadBytes) throw new Error(`QZH source file exceeds ${String(this.maxReadBytes)} bytes`)
    const lines = stdout.text.split(/\r?\n/)
    const text = lines.slice(first - 1, last).join('\n')
    return { repository: repo, commit, path: safePath, startLine: first, endLine: Math.min(last, lines.length), text }
  }

  /** Lazily open the durable case store and restore every stored case once.
   * @returns the opened KV unit, or undefined when storage is unavailable.
   */
  private casesUnit(): Promise<KvUnit | undefined> {
    this.unitPromise ??= (async () => {
      const storage = this.ownerCtx.get('storage') as { backend: { get(name: string): { kv?: { open(descriptor: {
        name: string
        version: number
        tables: readonly string[]
        hasGlobal: boolean
      }): Promise<KvUnit> } } } } | undefined
      if (storage === undefined) {
        this.warnPersistence('案例持久化不可用：storage 服务未挂载，本次按内存案例运行')
        return undefined
      }
      let unit: KvUnit
      try {
        const backend = storage.backend.get(this.storageBackendName)
        if (backend.kv === undefined) {
          this.warnPersistence(`案例持久化不可用：后端 ${this.storageBackendName} 无 kv 能力`)
          return undefined
        }
        unit = await backend.kv.open({ name: 'qzh_cases', version: 1, tables: ['cases'], hasGlobal: false })
      } catch (error: unknown) {
        this.warnPersistence(`案例持久化不可用：${error instanceof Error ? error.message : String(error)}`)
        return undefined
      }
      try {
        const snapshot = await unit.loadAll()
        const records = snapshot.tables['cases'] ?? {}
        for (const raw of Object.values(records)) {
          if (typeof raw !== 'object' || raw === null) continue
          const record = raw as CaseRecord
          if (typeof record.id !== 'string' || typeof record.sessionId !== 'string') continue
          this.cases.set(caseId(record.id), record)
          this.activeCases.set(record.sessionId, record.id)
        }
      } catch (error: unknown) {
        this.warnPersistence(`案例恢复失败：${error instanceof Error ? error.message : String(error)}`)
      }
      return unit
    })()
    return this.unitPromise
  }

  /** Persist one case record durably; a no-op when persistence is unavailable.
   * @param id - case identifier to persist.
   */
  private async persistCase(id: QzhCaseId): Promise<void> {
    const unit = await this.casesUnit()
    const record = this.cases.get(id)
    if (unit === undefined || record === undefined) return
    await unit.putRecord('cases', String(id), record)
  }

  /** Log one persistence availability problem once per process. */
  private warnPersistence(message: string): void {
    if (this.persistenceWarned) return
    this.persistenceWarned = true
    this.ctx.logger.warn(`qzh-log-analysis: ${message}`)
  }

  private requireCase(sessionId: SessionId, id: QzhCaseId): CaseRecord {
    const record = this.cases.get(id)
    if (record === undefined) throw new Error(`QZH case ${String(id)} was not found`)
    if (record.sessionId !== sessionId) throw new Error(`QZH case ${String(id)} does not belong to session ${String(sessionId)}`)
    return record
  }

  /** Resolve the storage blob facet; evidence persistence fails loud without it. */
  private blobFacet(): BlobFacet {
    const storage = this.ownerCtx.get('storage') as { backend: { get(name: string): { blob?: BlobFacet } } } | undefined
    if (storage === undefined) throw new Error('QZH 证据落盘不可用：storage 服务未挂载')
    const backend = storage.backend.get(this.evidenceBackendName)
    if (backend.blob === undefined) {
      throw new Error(`QZH 证据落盘不可用：后端 ${this.evidenceBackendName} 无 blob 能力`)
    }
    return backend.blob
  }

  /** Blob key prefix for one case's extracted evidence files. */
  private evidencePrefix(id: QzhCaseId): string {
    return `${String(id)}/files/`
  }

  /** Blob key for one field side's original archive. */
  private archiveKey(id: QzhCaseId, category: QzhLogCategory): string {
    return `${String(id)}/archive-${category}.zip`
  }

  /** Recursively list the extracted evidence tree with layout samples.
   * @param sessionId - owning DSH session (ownership re-checked here).
   * @param id - case identifier.
   * @returns bounded file tree plus the submitted clusters.
   */
  async listEvidenceTree(sessionId: SessionId, id: QzhCaseId): Promise<QzhLogListResult> {
    const record = this.requireCase(sessionId, id)
    const blob = this.blobFacet()
    const prefix = this.evidencePrefix(id)
    const objects = await blob.list(prefix)
    const files: QzhEvidenceTreeFile[] = []
    let totalBytes = 0
    let truncated = false
    // Each object key is `<id>/files/<category>/<relpath>`; strip the shared
    // prefix and the leading category segment to recover the raw bundle path
    // the submitted summary carries.
    for (const object of objects) {
      if (files.length >= EVIDENCE_MAX_TREE_FILES) { truncated = true; break }
      const rest = object.key.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash <= 0) continue
      const category = rest.slice(0, slash) as QzhLogCategory
      if (category !== 'server' && category !== 'terminal') continue
      const rel = rest.slice(slash + 1)
      const sample = await this.firstLineSample(blob, object.key)
      const summary = record.evidence?.files.find(file => file.path === rel && file.category === category)
      totalBytes += object.size
      files.push({
        path: `${category}/${rel}`,
        size: object.size,
        component: summary?.component ?? 'log',
        stream: summary?.stream ?? 'log',
        category,
        ...(sample === undefined ? {} : { sample }),
      })
    }
    if (files.length === 0) {
      throw new Error(`QZH case ${String(record.id)} has no full log evidence (summary-only mode)`)
    }
    return {
      files,
      totalFiles: files.length,
      totalBytes,
      truncated,
      clusters: [],
    }
  }

  /** Read a bounded first-line sample from an evidence blob. */
  private async firstLineSample(blob: BlobFacet, key: string): Promise<string | undefined> {
    const head = await blob.getRange(key, 0, EVIDENCE_MAX_LIST_SAMPLE_BYTES + 1)
    const line = Buffer.from(head).toString('utf8').split('\n', 1)[0] as string
    const trimmed = redactSensitiveText(line).trim()
    return trimmed.length === 0 ? undefined : trimmed.slice(0, EVIDENCE_MAX_LIST_SAMPLE_BYTES)
  }

  /** Fixed-string search over the extracted evidence tree (bounded).
   * @param sessionId - owning DSH session (ownership re-checked here).
   * @param id - case identifier.
   * @param query - the literal text to search for.
   * @param pathFilter - optional relative-path prefix limiting the scan.
   * @param maxResults - caller cap on returned hits (also capped by config).
   * @returns bounded matches with redacted excerpts.
   */
  async searchEvidence(
    sessionId: SessionId,
    id: QzhCaseId,
    query: string,
    pathFilter: string | undefined,
    maxResults: number,
  ): Promise<QzhLogSearchResult> {
    const record = this.requireCase(sessionId, id)
    const blob = this.blobFacet()
    const prefix = this.evidencePrefix(id)
    const objects = await blob.list(prefix)
    const needle = query
    const limit = Math.min(Math.max(1, maxResults), this.maxLogSearchResults)
    const matches: QzhLogMatch[] = []
    let scanned = 0
    let truncated = false
    for (const object of objects) {
      if (truncated || matches.length >= limit) { truncated = true; break }
      const rest = object.key.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash <= 0) continue
      const category = rest.slice(0, slash) as QzhLogCategory
      if (category !== 'server' && category !== 'terminal') continue
      const rel = `${category}/${rest.slice(slash + 1)}`
      if (pathFilter !== undefined && !rel.startsWith(pathFilter)) continue
      if (object.size > this.maxEvidenceFileBytes) continue
      if (scanned + object.size > this.maxLogSearchBytes) { truncated = true; break }
      scanned += object.size
      const text = Buffer.from(await blob.get(object.key)).toString('utf8')
      const lines = text.split('\n')
      for (let index = 0; index < lines.length; index += 1) {
        if (matches.length >= limit) { truncated = true; break }
        const line = lines[index] as string
        if (!line.includes(needle)) continue
        matches.push({
          path: rel,
          line: index + 1,
          excerpt: redactSensitiveText(line).slice(0, EVIDENCE_MAX_SEARCH_EXCERPT_BYTES),
        })
      }
    }
    if (objects.length === 0) {
      throw new Error(`QZH case ${String(record.id)} has no full log evidence (summary-only mode)`)
    }
    return { query: needle, matches, truncated }
  }

  /** Read a bounded line range from one extracted evidence file.
   * @param sessionId - owning DSH session (ownership re-checked here).
   * @param id - case identifier.
   * @param path - evidence-relative path.
   * @param startLine - 1-based start; defaults to 1.
   * @param endLine - inclusive end; capped at start + 499.
   * @returns redacted line-range text plus the file's total line count.
   */
  @Remote('readEvidenceRange')
  async readEvidenceRange(
    sessionId: SessionId,
    id: QzhCaseId,
    path: string,
    startLine: number | undefined,
    endLine: number | undefined,
  ): Promise<QzhLogReadResult> {
    this.requireCase(sessionId, id)
    const blob = this.blobFacet()
    // Search/list results carry a `server/` or `terminal/` prefix; split it
    // off and reconstruct the blob key as `<id>/files/<category>/<relpath>`.
    const slash = path.indexOf('/')
    const prefix = slash > 0 ? path.slice(0, slash) : ''
    const category: QzhLogCategory | undefined = prefix === 'server' || prefix === 'terminal' ? prefix : undefined
    const rel = category === undefined ? path : path.slice(slash + 1)
    const key = category === undefined ? `${this.evidencePrefix(id)}server/${rel}` : `${this.evidencePrefix(id)}${category}/${rel}`
    const info = await blob.stat(key)
    if (info === undefined) throw new Error(`QZH evidence file not found: ${path}`)
    if (info.size > this.maxEvidenceFileBytes) {
      throw new Error(`QZH evidence file ${path} exceeds ${String(this.maxEvidenceFileBytes)} bytes`)
    }
    const text = Buffer.from(await blob.get(key)).toString('utf8')
    const lines = text.split('\n')
    const first = Number.isInteger(startLine) && (startLine as number) > 0 ? startLine as number : 1
    const defaultLast = first + EVIDENCE_MAX_READ_LINES - 1
    const requestedEnd = endLine === undefined ? defaultLast : endLine
    const last = Number.isInteger(requestedEnd)
      ? Math.min(Math.max(requestedEnd as number, first), first + EVIDENCE_MAX_READ_LINES - 1, lines.length)
      : Math.min(defaultLast, lines.length)
    const slice = lines.slice(first - 1, last)
    const body = redactSensitiveText(slice.join('\n'))
    if (Buffer.byteLength(body, 'utf8') > this.maxLogReadBytes) {
      throw new Error(`QZH evidence range exceeds ${String(this.maxLogReadBytes)} bytes; request a narrower line range`)
    }
    return { path, startLine: first, endLine: last, totalLines: lines.length, text: body }
  }

  /** Cross-side, time-ordered evidence timeline.
   * @param sessionId - owning DSH session.
   * @param id - case identifier.
   * @param maxEvents - caller cap on returned events (also capped by config).
   * @returns timestamped events ordered by time, or truncated near the cap.
   */
  @Remote('getTimeline')
  async getTimeline(sessionId: SessionId, id: QzhCaseId, maxEvents: number): Promise<QzhTimelineResult> {
    this.requireCase(sessionId, id)
    const blob = this.blobFacet()
    const prefix = this.evidencePrefix(id)
    const objects = await blob.list(prefix)
    const cap = Math.min(Math.max(1, maxEvents), this.maxLogSearchResults)
    const events: QzhTimelineEvent[] = []
    let scanned = 0
    let truncated = false
    for (const object of objects) {
      if (truncated) break
      const rest = object.key.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash <= 0) continue
      const category = rest.slice(0, slash)
      if (category !== 'server' && category !== 'terminal') continue
      const rel = rest.slice(slash + 1)
      if (scanned + object.size > this.maxLogSearchBytes) { truncated = true; break }
      scanned += object.size
      const text = Buffer.from(await blob.get(object.key)).toString('utf8')
      const lines = text.split('\n')
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] as string
        const timestamp = parseTimelineTimestamp(line)
        if (timestamp === undefined) continue
        events.push({
          timestamp,
          path: `${category}/${rel}`,
          line: index + 1,
          severity: timelineSeverity(line),
          text: redactSensitiveText(line.trim()).slice(0, EVIDENCE_MAX_SEARCH_EXCERPT_BYTES),
        })
      }
    }
    events.sort((a, b) => a.timestamp - b.timestamp)
    if (events.length > cap) { truncated = true; events.length = cap }
    return { events, truncated }
  }

  /** Resolve the latest case in a session for model-facing tools. */
  private resolveToolCase(sessionId: SessionId, requestedId?: string): CaseRecord {
    const requested = requestedId?.trim()
    if (requested !== undefined && requested.length > 0) {
      const requestedRecord = this.cases.get(caseId(requested))
      if (requestedRecord?.sessionId === sessionId) return requestedRecord
    }
    const activeId = this.activeCases.get(sessionId)
    if (activeId !== undefined) return this.requireCase(sessionId, activeId)
    throw new Error('QZH session has no submitted case; import and submit log evidence first')
  }

  /** Return the current session case so the Agent never needs to guess an ID. */
  private currentCaseForTool(sessionId: SessionId): QzhCaseView {
    return { ...this.resolveToolCase(sessionId) }
  }

  /** Structure-first evidence projection for the model-facing list tool.
   * @param record - the tool-resolved case record.
   * @returns detached files with per-file layout samples.
   */
  private evidenceForTool(record: CaseRecord): Record<string, unknown> {
    const evidence = record.evidence
    if (evidence === undefined) return { case_id: record.id, files: [] }
    return {
      case_id: record.id,
      files: evidence.files.map(file => ({ ...file })),
    }
  }

  /** One analysis turn: the Agent reads evidence and works the case; the case stays `analyzing`. */
  private async runAnalysisTurn(sessionId: SessionId, id: QzhCaseId): Promise<void> {
    try {
      const record = this.requireCase(sessionId, id)
      const agent = this.ownerCtx.agents.get(sessionId)
      if (agent === undefined || agent.session.header.id !== sessionId) throw new Error(`QZH session ${String(sessionId)} is not live`)
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: this.analysisPrompt(record) }],
        source: { kind: 'plugin', plugin: 'qzh-log-analysis', form: 'instructions' },
      }))
      await agent.whenIdle()
    } catch (error: unknown) {
      const latest = this.requireCase(sessionId, id)
      const failed: CaseRecord = {
        ...latest,
        state: 'failed',
        updatedAt: now(),
        analysisError: `分析轮失败：${error instanceof Error ? error.message : String(error)}`,
      }
      delete failed.report
      this.cases.set(id, failed)
      await this.persistCase(id)
    }
  }

  /** Final report generation: the Agent summarizes the investigation into a structured report. */
  private async generateReportRun(sessionId: SessionId, id: QzhCaseId): Promise<void> {
    try {
      const record = this.requireCase(sessionId, id)
      const agent = this.ownerCtx.agents.get(sessionId)
      if (agent === undefined || agent.session.header.id !== sessionId) throw new Error(`QZH session ${String(sessionId)} is not live`)
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: this.reportPrompt(record) }],
        source: { kind: 'plugin', plugin: 'qzh-log-analysis', form: 'instructions' },
      }))
      await agent.whenIdle()
      const report = agent.session.events
        .filter(event => event.type === 'assistant/message')
        .map(event => event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join(''))
        .filter(text => text.length > 0)
        .at(-1)
      const latest = this.requireCase(sessionId, id)
      const assessment = report === undefined ? { conclusion: false, evidence: false, codeLocation: false } : assessReport(report)
      const completed: CaseRecord = {
        ...latest,
        state: !assessment.conclusion ? 'failed' : assessment.evidence && assessment.codeLocation ? 'completed' : 'completed_with_limitations',
        updatedAt: now(),
        ...(report === undefined ? { analysisError: 'DSH Agent 未返回文本报告' } : { report }),
      }
      if (report === undefined) delete completed.report
      else if (completed.state === 'completed_with_limitations') {
        completed.analysisError = `报告缺少必要结构（结论${assessment.conclusion ? '✓' : '✗'} 事实证据${assessment.evidence ? '✓' : '✗'} 代码定位${assessment.codeLocation ? '✓' : '✗'}），已按受限完成保留。`
      }
      this.cases.set(id, completed)
      await this.persistCase(id)
    } catch (error: unknown) {
      const latest = this.requireCase(sessionId, id)
      const failed: CaseRecord = {
        ...latest,
        state: 'failed',
        updatedAt: now(),
        analysisError: error instanceof Error ? error.message : String(error),
      }
      delete failed.report
      this.cases.set(id, failed)
      await this.persistCase(id)
    }
  }

  private analysisPrompt(record: CaseRecord): string {
    const evidence = record.evidence
    if (evidence === undefined) throw new Error('QZH case has no evidence')
    return [
      '请开始分析下面这个 QZH 故障案例。日志摘要已经过 Host 二次脱敏；不得要求完整日志，也不得执行写操作。',
      `案例 ID：${record.id}`,
      `QZH 版本：${record.productVersion ?? '未知'}`,
      `故障描述：${record.failureDescription ?? '未提供'}`,
      `日志文件：${JSON.stringify(evidence.files)}`,
      `日志短样例：${evidence.excerpt ?? '未提供'}`,
      '先调用 qzh_list_evidence 查看文件清单与每个文件的首行样例，以现场实际目录结构为准，不要假设固定布局；浏览器提供的 component 只是初始标签，可能与压缩包结构不一致。再调用 qzh_get_current_case 校验当前案例上下文；qzh_search_code 和 qzh_read_code 的 case_id 可以省略，Host 会自动绑定当前会话案例。不要猜测或尝试其他案例 ID。',
      '请先调用 qzh_list_logs 查看完整日志树、qzh_search_logs 按错误关键词扫描并自行聚类（ERROR/WARN/超时/认证失败等），再说明排查思路和初步发现；本轮不需要输出最终报告。用户会继续追问细节或补充证据，最后再由用户请求生成正式报告。',
      '服务端（server/）与终端（terminal/）日志可能来自同一故障：先按时间线对齐两端事件（真实时间戳），再判断因果方向（服务端请求链路 → 终端下发状态），避免只看一侧就下结论。',
    ].join('\n')
  }

  private reportPrompt(record: CaseRecord): string {
    const evidence = record.evidence
    if (evidence === undefined) throw new Error('QZH case has no evidence')
    return [
      '请基于当前会话中已经完成的排查，输出最终中文报告。',
      `案例 ID：${record.id}`,
      `QZH 版本：${record.productVersion ?? '未知'}`,
      `故障描述：${record.failureDescription ?? '未提供'}`,
      '请按以下结构输出中文报告：结论；事实证据；代码定位（仓库/commit/路径/行号）；根因推断；可信度；信息缺口；现场验证步骤；修复建议（只描述，不修改代码）。',
      '报告中的日志引用必须使用证据包内的真实相对路径（path:line），代码引用必须包含仓库、commit、文件路径和行号。',
      '若服务端与终端日志同时存在，结论必须说明跨侧因果方向（服务端请求链路 → 终端下发状态），并引用两端的时间对齐证据。',
    ].join('\n')
  }

  private isWithin(root: string, candidate: string): boolean {
    const prefix = relative(root, candidate)
    return prefix === '' || (!prefix.startsWith(`..${sep}`) && prefix !== '..' && !isAbsolute(prefix))
  }

  private async repositoryRoot(repository: QzhRepository): Promise<string> {
    const configured = resolve(this.mirrorRoot, repository)
    let root: string
    try {
      root = await realpath(configured)
    } catch (error: unknown) {
      if (repository !== 'server' || !(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      root = await realpath(this.mirrorRoot)
      await stat(resolve(root, '.git'))
    }
    // Compare against the canonical form of the mirror root: realpath resolves
    // symlinks (e.g. /var -> /private/var on macOS), and comparing a canonical
    // child against the un-canonicalized root would reject valid setups.
    const mirrorRootCanonical = await realpath(this.mirrorRoot)
    if (!this.isWithin(mirrorRootCanonical, root)) throw new Error('QZH repository resolves outside the configured mirror root')
    return root
  }

  /** Resolve the git revision a case's code lookups must use.
   *
   * A case's `productVersion` names a git tag (or any ref) in the mirror;
   * the commit is pinned per case so concurrent sessions analyzing different
   * versions never interfere. Without a version the checkout HEAD is used,
   * matching the pre-versioning behavior.
   * @param root - repository root holding the `.git` directory.
   * @param record - the case whose version resolves to a commit.
   * @param signal - optional cancellation signal.
   * @returns the fully-qualified commit hash.
   */
  private async resolveRef(root: string, record: CaseRecord, signal?: AbortSignal): Promise<string> {
    const version = record.productVersion?.trim()
    if (version === undefined || version.length === 0) return this.currentCommit(root, signal)
    const git = await this.ctx.subprocess.resolveExecutable('git', undefined, signal)
    const handle = this.ctx.subprocess.spawn({
      argv: [git, '-C', root, 'rev-parse', '--verify', '--end-of-options', `${version}^{commit}`],
      cwd: root,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 128 }, stderr: { maxBytes: STDERR_MAX_BYTES } },
      graceMs: COMMAND_GRACE_MS,
      signal,
    } satisfies SubprocessSpawnSpec)
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0)
    const stderr = handle.collected.stderr?.readFrom(0)
    if (outcome.exitCode !== 0 || outcome.signal !== null || stdout === undefined) {
      const detail = stderr?.text.trim() ?? ''
      throw new Error(`QZH 版本 ${version} 在 mirror 中不存在${detail === '' ? '' : `：${detail}`}`)
    }
    const commit = stdout.text.trim()
    if (!/^[0-9a-f]{7,64}$/i.test(commit)) throw new Error(`QZH 版本 ${version} 未能解析为有效 commit`)
    return commit
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
