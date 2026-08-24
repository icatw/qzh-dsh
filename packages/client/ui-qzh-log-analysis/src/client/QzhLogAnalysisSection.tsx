import { useEffect, useRef, useState } from 'react'
import { zipSync } from 'fflate/browser'
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  QzhArchiveUpload, QzhCaseView, QzhCreateCaseRequest, QzhEvidenceSummary, QzhFeedbackKind,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { ImportedLogEntry } from '../log-import.ts'
import { isEncryptedZip, listZipLogEntries, logSample, normalizeImportPath, MAX_PREVIEW_BYTES } from '../log-import.ts'
import { scanQzhLogLayout, type QzhLogCategory } from '../log-layout.ts'
import { buildQzhEvidence } from './evidence.ts'
import { QzhAnalysisStatus } from './QzhAnalysisStatus.tsx'
import { QzhConsentPanel } from './QzhConsentPanel.tsx'
import { QzhEvidencePreview } from './QzhEvidencePreview.tsx'
import { QzhImportHero } from './QzhImportHero.tsx'
import type { QzhSessionState, QzhUploadPreview, createQzhSessionStore } from './store.ts'
import css from './QzhLogAnalysisSection.module.css'

interface QzhActions {
  readonly createCase: (request: QzhCreateCaseRequest) => Promise<QzhCaseView>
  readonly setEvidence: (id: QzhCaseView['id'], evidence: QzhEvidenceSummary) => Promise<QzhCaseView>
  readonly uploadEvidenceArchive: (id: QzhCaseView['id'], upload: QzhArchiveUpload) => Promise<QzhCaseView>
  readonly getCase: (id: QzhCaseView['id']) => Promise<QzhCaseView>
  readonly startAnalysis: (id: QzhCaseView['id']) => Promise<QzhCaseView>
  readonly generateReport?: (id: QzhCaseView['id']) => Promise<QzhCaseView>
  readonly setFeedback: (id: QzhCaseView['id'], kind: QzhFeedbackKind, comment?: string) => Promise<QzhCaseView>
  readonly renameSession?: (title: string) => Promise<void>
}

type Props = PropsRuntime<'conversation.hero.empty'> & PropsStore<ReturnType<typeof createQzhSessionStore>> & QzhActions
const MAX_FILES = 30

/** Encode bytes as base64 in chunks (btoa is bounded by call-stack size). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

/** Compose a readable session title from the submitted case facts, so the
 *  sidebar distinguishes cases instead of labeling every session the same. */
export function buildSessionTitle(input: { customerLabel?: string; productVersion?: string; failureDescription?: string }): string {
  const parts: string[] = []
  const customer = (input.customerLabel ?? '').trim()
  if (customer !== '') parts.push(customer)
  const version = (input.productVersion ?? '').trim()
  if (version !== '') parts.push(version)
  const firstLine = (input.failureDescription ?? '').trim().split('\n', 1)[0]?.trim() ?? ''
  if (firstLine !== '') parts.push(firstLine.length > 18 ? `${firstLine.slice(0, 18)}…` : firstLine)
  return parts.join(' · ') || 'QZH 日志分析'
}

function fileEntry(file: File, preview: string, category: QzhLogCategory): ImportedLogEntry | undefined {
  if (!/\.(log|txt|out)$/i.test(file.name)) return undefined
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath
  const rawPath = normalizeImportPath(relativePath || file.name)
  const [layout] = scanQzhLogLayout([rawPath], { [rawPath]: preview })
  return layout === undefined ? undefined : { ...layout, size: file.size, source: 'file', sample: logSample(preview), category }
}

/** Full blank-state QZH evidence flow. The normal conversation shell owns the frame. */
export function QzhLogAnalysisSection({
  sessionId, useSessions, useStore, actions, createCase, setEvidence, uploadEvidenceArchive,
  getCase, startAnalysis, generateReport, setFeedback, renameSession,
}: Props) {
  const preset = useSessions(state => state.byId[sessionId]?.agentPreset)
  const state = useStore((value: QzhSessionState) => value)
  const [analysisRunning, setAnalysisRunning] = useState(false)
  /** Original log archives retained for the durable full-evidence upload,
   *  keyed by field side so both the server and terminal bundles survive.
   *  A ref (not state) so an immediate submit after import always sees it. */
  const archiveRef = useRef<Map<QzhLogCategory, QzhArchiveUpload>>(new Map())
  const caseId = state.caseView?.id
  const caseState = state.caseView?.state

  useEffect(() => {
    if (preset !== 'qzh' || caseId === undefined) return
    let disposed = false
    const refreshCase = async (): Promise<void> => {
      try {
        const current = await getCase(caseId)
        if (!disposed) actions.setCaseView(current)
      } catch (error) {
        if (!disposed && error instanceof Error && /not found/i.test(error.message)) {
          actions.setCaseView(undefined)
          actions.setStatus('Host 中的案例已失效，请重新导入日志摘要。')
        } else if (!disposed) actions.setStatus(`刷新 QZH 案例失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    void refreshCase()
    if (caseState !== 'analyzing') return () => { disposed = true }
    const timer = window.setInterval(() => { void refreshCase() }, 1_500)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [actions, caseId, caseState, getCase, preset])

  if (preset !== 'qzh') return null

  const onFiles = async (category: QzhLogCategory, files: FileList | null): Promise<void> => {
    if (files === null || files.length === 0) return
    actions.setStatus('正在读取日志文件清单…')
    try {
      const entries: ImportedLogEntry[] = []
      archiveRef.current.delete(category)
      const uploads: QzhUploadPreview[] = []
      // Directory files are re-packed into one zip so a fully extracted log
      // bundle still lands as the durable full archive (summary-only would
      // otherwise hide complete logs from qzh_search_logs/qzh_list_logs).
      const directoryFiles: { path: string; bytes: Uint8Array }[] = []
      for (const file of [...files].slice(0, MAX_FILES)) {
        if (file.name.toLowerCase().endsWith('.zip')) {
          const bytes = new Uint8Array(await file.arrayBuffer())
          if (isEncryptedZip(bytes)) {
            actions.setStatus('该 ZIP 已加密（AES 或带密码），无法在浏览器中读取；请先解压后选择日志目录导入，或重新压缩为未加密 ZIP。')
            return
          }
          archiveRef.current.set(category, { filename: file.name, category, contentBase64: bytesToBase64(bytes) })
          uploads.push({ category, filename: file.name, size: bytes.byteLength })
          const archiveEntries = listZipLogEntries(bytes, category)
          entries.push(...archiveEntries)
          continue
        }
        const bytes = new Uint8Array(await file.arrayBuffer())
        const preview = new TextDecoder().decode(bytes.subarray(0, MAX_PREVIEW_BYTES))
        const entry = fileEntry(file, preview, category)
        if (entry === undefined) continue
        entries.push(entry)
        directoryFiles.push({
          path: normalizeImportPath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name),
          bytes,
        })
      }
      // Pack the selected directory into the same durable archive shape as a
      // ZIP import, so both upload paths give the Agent full-log access.
      if (directoryFiles.length > 0) {
        const archiveBytes = zipSync(Object.fromEntries(directoryFiles.map(file => [file.path, file.bytes])))
        archiveRef.current.set(category, {
          filename: `${category}-logs.zip`, category, contentBase64: bytesToBase64(archiveBytes),
        })
        uploads.splice(0, uploads.length, { category, filename: `${category}-logs.zip`, size: archiveBytes.byteLength })
      }
      const mergedEntries = [
        ...state.entries.filter(entry => entry.category !== category),
        ...entries,
      ].sort((left, right) => left.path.localeCompare(right.path))
      const mergedUploads = [
        ...state.uploads.filter(upload => upload.category !== category),
        ...uploads,
      ]
      actions.setImported(mergedEntries)
      actions.setUploads(mergedUploads)
      actions.setStatus(mergedEntries.length === 0
        ? '没有识别到日志文件，请选择 .log/.out，或包含时间戳/日志级别的 .txt 文件。'
        : `已读取 ${String(mergedEntries.length)} 个日志文件；确认后发送给内网分析，Agent 将自行扫描聚类。`)
    } catch (error) {
      actions.setStatus(`导入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const evidence = state.entries.length === 0 ? undefined : buildQzhEvidence(state.entries)

  const submitAndStart = async (): Promise<void> => {
    if (evidence === undefined || !state.consent || state.caseView !== undefined || analysisRunning) return
    setAnalysisRunning(true)
    actions.setStatus('正在提交已确认摘要，并启动当前 QZH 会话分析…')
    try {
      const created = await createCase({
        ...(state.customerLabel.trim() === '' ? {} : { customerLabel: state.customerLabel.trim() }),
        ...(state.productVersion.trim() === '' ? {} : { productVersion: state.productVersion.trim() }),
        failureDescription: state.failureDescription.trim() || '由 QZH 会话提交的日志证据',
      })
      const saved = await setEvidence(created.id, evidence)
      actions.setCaseView(saved)
      // Full-bundle upload is best-effort and never blocks analysis: the
      // summary already started the case, and list/search/read tools degrade
      // to summary-only until the archives land. Server and terminal bundles
      // are uploaded independently so one failure keeps the other.
      const uploadResults: Promise<void>[] = []
      if (archiveRef.current.size > 0) {
        actions.setStatus('正在上传完整日志包（摘要分析可先开始）…')
        for (const upload of archiveRef.current.values()) {
          uploadResults.push(uploadEvidenceArchive(saved.id, upload).then((updated) => { actions.setCaseView(updated) }))
        }
      }
      const started = await startAnalysis(saved.id)
      actions.setCaseView(started)
      actions.setPanelOpen(true)
      // Wait for the uploads to settle (they never gate analysis), then merge
      // any failure into the final status so it survives the "分析已启动" text.
      const failures = (await Promise.allSettled(uploadResults))
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map(() => '完整日志包上传失败，本次分析将基于提交的摘要。')
      let status = '分析已启动，报告会回到当前会话消息流。'
      if (renameSession !== undefined) {
        try {
          await renameSession(buildSessionTitle(state))
        } catch (error) {
          status = `分析已启动，但会话标题未更新：${error instanceof Error ? error.message : String(error)}`
        }
      }
      if (failures.length > 0) status = `${status} ${failures.join(' ')}`
      actions.setStatus(status)
    } catch (error) {
      actions.setStatus(`提交或启动分析失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setAnalysisRunning(false)
    }
  }

  const retryAnalysis = async (): Promise<void> => {
    if (state.caseView === undefined || analysisRunning || state.caseView.state === 'completed' || state.caseView.state === 'analyzing') return
    setAnalysisRunning(true)
    actions.setStatus('正在当前 QZH 会话中重试分析…')
    try {
      const started = await startAnalysis(state.caseView.id)
      actions.setCaseView(started)
      actions.setStatus('分析已重新启动。')
    } catch (error) {
      actions.setStatus(`启动分析失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setAnalysisRunning(false)
    }
  }

  const requestReport = async (): Promise<void> => {
    if (state.caseView === undefined || generateReport === undefined || analysisRunning) return
    setAnalysisRunning(true)
    actions.setStatus('正在提取当前会话的分析报告…')
    try {
      const updated = await generateReport(state.caseView.id)
      actions.setCaseView(updated)
      actions.setStatus('报告已生成并保存到当前会话。')
    } catch (error) {
      actions.setStatus(`生成报告失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setAnalysisRunning(false)
    }
  }

  const submitFeedback = async (kind: QzhFeedbackKind, comment?: string): Promise<void> => {
    if (state.caseView === undefined) return
    try {
      const updated = await setFeedback(state.caseView.id, kind, comment)
      actions.setCaseView(updated)
    } catch (error) {
      actions.setStatus(`反馈提交失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return (
    <section className={css.surface} aria-label="QZH 日志分析入口">
      <QzhImportHero
        entries={state.entries}
        onFiles={(category, files) => { void onFiles(category, files) }}
        status={state.status}
      />
      {evidence !== undefined && state.caseView === undefined && (
        <div className={css.flowBody}>
          <QzhEvidencePreview evidence={evidence} uploads={state.uploads} />
          <QzhConsentPanel
            customerLabel={state.customerLabel}
            productVersion={state.productVersion}
            failureDescription={state.failureDescription}
            consent={state.consent}
            onCustomerLabel={actions.setCustomerLabel}
            onProductVersion={actions.setProductVersion}
            onFailureDescription={actions.setFailureDescription}
            onConsent={actions.setConsent}
          />
          <button className={css.primaryButton} type="button" disabled={!state.consent || analysisRunning} onClick={() => { void submitAndStart() }}>
            {analysisRunning ? '提交并启动中…' : '确认摘要并开始分析'}
          </button>
        </div>
      )}
      {state.caseView !== undefined && (
        <div className={css.flowBody}>
          <QzhAnalysisStatus
            caseView={state.caseView} running={analysisRunning}
            onStart={() => { void retryAnalysis() }}
            onGenerateReport={() => { void requestReport() }}
            onFeedback={submitFeedback}
          />
          {evidence !== undefined && <QzhEvidencePreview evidence={evidence} uploads={state.uploads} />}
        </div>
      )}
    </section>
  )
}
