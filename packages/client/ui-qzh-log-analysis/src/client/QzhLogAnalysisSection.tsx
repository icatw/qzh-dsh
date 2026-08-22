import { useEffect, useRef, useState } from 'react'
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  QzhArchiveUpload, QzhCaseView, QzhCreateCaseRequest, QzhEvidenceSummary, QzhFeedbackKind,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { ImportedLogEntry } from '../log-import.ts'
import { decodeZipLogMember, listZipLogEntries, logSample, normalizeImportPath, MAX_PREVIEW_BYTES } from '../log-import.ts'
import { clusterLogErrors, parseLogText } from '../log-parser.ts'
import { scanQzhLogLayout, type QzhLogCategory } from '../log-layout.ts'
import { buildQzhEvidence } from './evidence.ts'
import { QzhAnalysisStatus } from './QzhAnalysisStatus.tsx'
import { QzhConsentPanel } from './QzhConsentPanel.tsx'
import { QzhEvidencePreview } from './QzhEvidencePreview.tsx'
import { QzhImportHero } from './QzhImportHero.tsx'
import type { QzhSessionState, createQzhSessionStore } from './store.ts'
import css from './QzhLogAnalysisSection.module.css'

interface QzhActions {
  readonly createCase: (request: QzhCreateCaseRequest) => Promise<QzhCaseView>
  readonly setEvidence: (id: QzhCaseView['id'], evidence: QzhEvidenceSummary) => Promise<QzhCaseView>
  readonly uploadEvidenceArchive: (id: QzhCaseView['id'], upload: QzhArchiveUpload) => Promise<QzhCaseView>
  readonly getCase: (id: QzhCaseView['id']) => Promise<QzhCaseView>
  readonly startAnalysis: (id: QzhCaseView['id']) => Promise<QzhCaseView>
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
  getCase, startAnalysis, setFeedback, renameSession,
}: Props) {
  const preset = useSessions(state => state.byId[sessionId]?.agentPreset)
  const state = useStore((value: QzhSessionState) => value)
  const [analysisRunning, setAnalysisRunning] = useState(false)
  /** Original log archive retained for the durable full-evidence upload. A
   *  ref (not state) so an immediate submit after import always sees it. */
  const archiveRef = useRef<QzhArchiveUpload | undefined>(undefined)
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
        }
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
    actions.setStatus('正在本地解析日志摘要…')
    try {
      const entries: ImportedLogEntry[] = []
      const events = []
      for (const file of [...files].slice(0, MAX_FILES)) {
        if (file.name.toLowerCase().endsWith('.zip')) {
          const bytes = new Uint8Array(await file.arrayBuffer())
          archiveRef.current = { filename: file.name, contentBase64: bytesToBase64(bytes) }
          const archiveEntries = listZipLogEntries(bytes, category)
          entries.push(...archiveEntries)
          for (const entry of archiveEntries) events.push(...parseLogText(entry, decodeZipLogMember(bytes, entry.path), category))
          continue
        }
        const preview = await file.slice(0, MAX_PREVIEW_BYTES).text()
        const entry = fileEntry(file, preview, category)
        if (entry === undefined) continue
        entries.push(entry)
        events.push(...parseLogText(entry, preview, category))
      }
      const clusters = clusterLogErrors(events)
      actions.setImported(entries.sort((left, right) => left.path.localeCompare(right.path)), clusters)
      actions.setStatus(entries.length === 0
        ? '没有识别到日志文件，请选择 .log/.out，或包含时间戳/日志级别的 .txt 文件。'
        : `已读取 ${String(entries.length)} 个日志文件，发现 ${String(clusters.length)} 类异常；请检查摘要后确认。`)
    } catch (error) {
      actions.setStatus(`导入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const evidence = state.entries.length === 0 ? undefined : buildQzhEvidence(state.entries, state.clusters)

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
      // to summary-only until the archive lands.
      if (archiveRef.current !== undefined) {
        actions.setStatus('正在上传完整日志包（摘要分析可先开始）…')
        void uploadEvidenceArchive(saved.id, archiveRef.current)
          .then(actions.setCaseView)
          .catch(() => {
            actions.setStatus('完整日志包上传失败，本次分析将基于提交的摘要。')
          })
      }
      const started = await startAnalysis(saved.id)
      actions.setCaseView(started)
      actions.setPanelOpen(true)
      let status = '分析已启动，报告会回到当前会话消息流。'
      if (renameSession !== undefined) {
        try {
          await renameSession('QZH 日志分析')
        } catch (error) {
          status = `分析已启动，但会话标题未更新：${error instanceof Error ? error.message : String(error)}`
        }
      }
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
      <QzhImportHero entries={state.entries} clusters={state.clusters} onFiles={(category, files) => { void onFiles(category, files) }} status={state.status} />
      {evidence !== undefined && state.caseView === undefined && (
        <div className={css.flowBody}>
          <QzhEvidencePreview evidence={evidence} />
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
          <QzhAnalysisStatus caseView={state.caseView} running={analysisRunning} onStart={() => { void retryAnalysis() }} onFeedback={submitFeedback} />
          {evidence !== undefined && <QzhEvidencePreview evidence={evidence} />}
        </div>
      )}
    </section>
  )
}
