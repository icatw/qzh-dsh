import { useEffect, useState } from 'react'
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { QzhArchiveDownload, QzhArchiveUpload, QzhCaseView, QzhCodeReadResult, QzhEvidenceSummary, QzhFeedbackKind, QzhLogCategory, QzhLogListResult, QzhLogReadResult, QzhTimelineResult } from '@deepseek-ai/dsh-api-remotes/client'
import { decodeZipLogMember, listZipLogEntries, type ImportedLogEntry } from '../log-import.ts'
import { clusterLogErrors, parseLogText } from '../log-parser.ts'
import { buildQzhEvidence } from './evidence.ts'
import { QzhAnalysisStatusHead, QzhAnalysisStatusReport } from './QzhAnalysisStatus.tsx'
import { QzhEvidenceFiles } from './QzhEvidenceFiles.tsx'
import { QzhEvidencePreview } from './QzhEvidencePreview.tsx'
import type { QzhSessionState, createQzhSessionStore } from './store.ts'
import css from './QzhLogAnalysisSection.module.css'

interface Injected {
  readonly startAnalysis: (id: QzhCaseView['id']) => Promise<QzhCaseView>
  readonly generateReport: (id: QzhCaseView['id']) => Promise<QzhCaseView>
  readonly setEvidence: (id: QzhCaseView['id'], evidence: QzhEvidenceSummary) => Promise<QzhCaseView>
  readonly uploadEvidenceArchive: (id: QzhCaseView['id'], upload: QzhArchiveUpload) => Promise<QzhCaseView>
  readonly getCase: (id: QzhCaseView['id']) => Promise<QzhCaseView>
  readonly getActiveCase: () => Promise<QzhCaseView | undefined>
  readonly getEvidenceTree: (id: QzhCaseView['id']) => Promise<QzhLogListResult>
  readonly readEvidenceRange: (id: QzhCaseView['id'], path: string) => Promise<QzhLogReadResult>
  readonly readCode: (id: QzhCaseView['id'], path: string, startLine: number, endLine: number) => Promise<QzhCodeReadResult>
  readonly getTimeline: (id: QzhCaseView['id'], maxEvents: number) => Promise<QzhTimelineResult>
  readonly downloadEvidenceArchive: (id: QzhCaseView['id'], category: QzhLogCategory) => Promise<QzhArchiveDownload | undefined>
  readonly setFeedback: (id: QzhCaseView['id'], kind: QzhFeedbackKind, comment?: string) => Promise<QzhCaseView>
  readonly renameSession: (title: string) => Promise<void>
}

type Props = PropsRuntime<'conversation.details.qzh'> & PropsStore<ReturnType<typeof createQzhSessionStore>> & Injected

/** One previewed evidence file's content and its pending/error state. */
interface FilePreview {
  path: string
  text: string
  totalLines: number
}

/** QZH evidence and progress panel rendered in DSH's right details column. */
export function QzhEvidenceDock({
  sessionId, useSessions, useStore, actions, startAnalysis, generateReport, setEvidence, uploadEvidenceArchive,
  getCase, getActiveCase, getEvidenceTree,
  readEvidenceRange, readCode, getTimeline, downloadEvidenceArchive, setFeedback, renameSession,
}: Props) {
  const sessionSummary = useSessions(state => state.byId[sessionId])
  const preset = sessionSummary?.agentPreset
  const state = useStore((value: QzhSessionState) => value)
  const caseId = state.caseView?.id
  const caseState = state.caseView?.state
  const [tree, setTree] = useState<QzhLogListResult | undefined>()
  const [preview, setPreview] = useState<FilePreview | undefined>()
  const [previewError, setPreviewError] = useState<string | undefined>()
  const [tab, setTab] = useState<'evidence' | 'report'>('evidence')
  // A terminal report lands in the report tab automatically; the user can
  // switch back to the evidence tree anytime.
  useEffect(() => {
    const terminal = caseState === 'completed' || caseState === 'completed_with_limitations' || caseState === 'failed'
    if (terminal) setTab('report')
  }, [caseState])
  useEffect(() => {
    if (preset !== 'qzh') return
    let disposed = false
    // Restore the session's latest case after a reload: the store is
    // in-memory, so a reopened QZH session must re-fetch its case before it
    // can show evidence or the report.
    void getActiveCase().then((restored) => {
      if (disposed || restored === undefined || state.caseView !== undefined) return
      actions.setCaseView(restored)
    }).catch(() => {})
    return () => { disposed = true }
  }, [actions, getActiveCase, preset, state.caseView])
  useEffect(() => {
    if (preset !== 'qzh' || caseId === undefined) return
    let disposed = false
    // Re-fetch on state change too: the archive upload completes between
    // `evidence-ready` and `analyzing`, and the tree only reflects the full
    // bundle once it has landed. A `caseId`-only effect would freeze on the
    // summary tree fetched before the upload finished.
    void getEvidenceTree(caseId).then((result) => { if (!disposed) setTree(result) }).catch(() => {})
    return () => { disposed = true }
  }, [caseId, caseState, getEvidenceTree, preset])
  useEffect(() => {
    if (preset !== 'qzh' || caseId === undefined) return
    if (sessionSummary?.title === undefined) void renameSession('QZH 日志分析')
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
  }, [actions, caseId, caseState, getCase, preset, renameSession, sessionSummary?.title])
  const retry = async (): Promise<void> => {
    if (state.caseView === undefined) return
    const started = await startAnalysis(state.caseView.id)
    actions.setCaseView(started)
  }
  const generate = async (): Promise<void> => {
    if (state.caseView === undefined) return
    const generated = await generateReport(state.caseView.id)
    actions.setCaseView(generated)
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
  const previewFile = async (path: string): Promise<void> => {
    if (state.caseView === undefined) return
    setPreviewError(undefined)
    try {
      const result = await readEvidenceRange(state.caseView.id, path)
      setPreview({ path, text: result.text, totalLines: result.totalLines })
    } catch (error) {
      setPreview(undefined)
      setPreviewError(`读取 ${path} 失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const [supplementing, setSupplementing] = useState(false)
  const [supplementError, setSupplementError] = useState<string | undefined>()
  /** Parse a supplementary ZIP, merge it into the case evidence, and land it. */
  const supplement = async (category: QzhLogCategory, files: FileList | null): Promise<void> => {
    if (files === null || files.length === 0 || state.caseView === undefined) return
    setSupplementError(undefined)
    const caseRef = state.caseView
    try {
      const entries: ImportedLogEntry[] = []
      const events = []
      const uploads: QzhArchiveUpload[] = []
      for (const file of [...files].slice(0, 10)) {
        if (!file.name.toLowerCase().endsWith('.zip')) {
          setSupplementError('补充日志请使用 ZIP 压缩包')
          return
        }
        const bytes = new Uint8Array(await file.arrayBuffer())
        uploads.push({ filename: file.name, category, contentBase64: bytesToBase64(bytes) })
        const archiveEntries = listZipLogEntries(bytes, category)
        entries.push(...archiveEntries)
        for (const entry of archiveEntries) events.push(...parseLogText(entry, decodeZipLogMember(bytes, entry.path), category))
      }
      if (entries.length === 0) {
        setSupplementError('压缩包里没有识别到日志文件')
        return
      }
      const mergedEntries = mergeEntries(state.entries, entries)
      const newClusters = clusterLogErrors(events)
      const clusters = mergeClusters(state.clusters, newClusters)
      actions.setImported(mergedEntries, clusters)
      const mergedEvidence = buildQzhEvidence(mergedEntries, clusters)
      const saved = await setEvidence(caseRef.id, mergedEvidence)
      actions.setCaseView(saved)
      for (const upload of uploads) {
        await uploadEvidenceArchive(caseRef.id, upload).then((updated) => { actions.setCaseView(updated) })
      }
      actions.setStatus(`已补充 ${String(entries.length)} 个日志文件，可继续分析或生成报告。`)
      setSupplementing(false)
    } catch (error) {
      setSupplementError(`补充日志失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const [evidenceView, setEvidenceView] = useState<'files' | 'timeline'>('files')
  const [timeline, setTimeline] = useState<QzhTimelineResult | undefined>()
  const [timelineError, setTimelineError] = useState<string | undefined>()
  const loadTimeline = async (): Promise<void> => {
    if (state.caseView === undefined || timeline !== undefined) return
    setTimelineError(undefined)
    try {
      setTimeline(await getTimeline(state.caseView.id, 200))
    } catch (error) {
      setTimelineError(`加载时间线失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (preset !== 'qzh') return null
  if (state.caseView === undefined) {
    return (
      <div className={css.dockExpanded}>
        <p className={css.muted}>QZH 日志分析：导入日志摘要并确认后，这里会展示证据与报告。</p>
      </div>
    )
  }
  if (state.entries.length === 0 && state.caseView.report === undefined) {
    return (
      <div className={css.dockExpanded}>
        <QzhAnalysisStatusHead caseView={state.caseView} running={state.caseView.state === 'analyzing'} onStart={() => { void retry() }} onGenerateReport={() => { void generate() }} />
        <p className={css.muted}>摘要已提交，完整证据树随分析进度加载。</p>
      </div>
    )
  }
  const evidence = state.entries.length === 0 ? undefined : buildQzhEvidence(state.entries, state.clusters)
  const downloadArchive = async (category: QzhLogCategory): Promise<void> => {
    if (state.caseView === undefined) return
    const archive = await downloadEvidenceArchive(state.caseView.id, category)
    if (archive === undefined) {
      throw new Error('该案例没有已上传的完整日志包')
    }
    // Decode the base64 payload and save it under the original upload name.
    const bytes = atob(archive.contentBase64)
    const buffer = new Uint8Array(bytes.length)
    for (let index = 0; index < bytes.length; index += 1) buffer[index] = bytes.charCodeAt(index)
    const blob = new Blob([buffer], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = archive.filename
    anchor.click()
    URL.revokeObjectURL(url)
  }
  return state.panelOpen
    ? (
      <div className={css.dockExpanded}>
        <QzhAnalysisStatusHead caseView={state.caseView} running={state.caseView.state === 'analyzing'} onStart={() => { void retry() }} onGenerateReport={() => { void generate() }} />
        <div className={css.dockTabs} role="tablist" aria-label="详情视图">
          <button type="button" role="tab" aria-selected={tab === 'evidence'} className={tab === 'evidence' ? css.dockTabActive : css.dockTab} onClick={() => { setTab('evidence') }}>证据</button>
          <button type="button" role="tab" aria-selected={tab === 'report'} className={tab === 'report' ? css.dockTabActive : css.dockTab} onClick={() => { setTab('report') }}>报告</button>
        </div>
        {tab === 'evidence' ? (
          <>
            <div className={css.evidenceViewTabs}>
              <button type="button" className={evidenceView === 'files' ? css.evidenceViewTabActive : css.evidenceViewTab} onClick={() => { setEvidenceView('files') }}>文件</button>
              <button type="button" className={evidenceView === 'timeline' ? css.evidenceViewTabActive : css.evidenceViewTab} onClick={() => { setEvidenceView('timeline'); void loadTimeline() }}>时间线</button>
            </div>
            {evidenceView === 'timeline' ? (
              <section className={css.timelineSection} aria-label="跨侧时间线">
                {timelineError !== undefined && <p className={css.errorText}>{timelineError}</p>}
                {timeline !== undefined && timeline.events.length === 0 && <p className={css.muted}>证据中没有带时间戳的日志行。</p>}
                {timeline !== undefined && timeline.events.length > 0 && (
                  <div className={css.timelineList}>
                    {timeline.events.map((event, index) => (
                      <button
                        type="button"
                        key={`${event.timestamp}-${index}`}
                        className={css.timelineRow}
                        data-severity={event.severity}
                        title={`点击查看 ${event.path}:${String(event.line)}`}
                        onClick={() => { void previewFile(event.path) }}
                      >
                        <span className={css.timelineTime}>{formatClock(event.timestamp)}</span>
                        <span className={css.timelinePath}>{event.path.slice(event.path.lastIndexOf('/') + 1)}</span>
                        <span className={css.timelineText}>{event.text}</span>
                      </button>
                    ))}
                    {timeline.truncated && <p className={css.muted}>时间线已截断（仅显示前 200 条）。</p>}
                  </div>
                )}
              </section>
            ) : (
              <>
                {tree !== undefined && (
                  <QzhEvidenceFiles
                    files={tree.files}
                    clusters={tree.clusters}
                    archives={tree.archives ?? []}
                    summaryOnly={tree.summaryOnly === true}
                    caseId={state.caseView.id}
                    onDownloadArchive={downloadArchive}
                    onPreviewFile={previewFile}
                  />
                )}
              </>
            )}
            <div className={css.supplement}>
              {!supplementing ? (
                <button type="button" className={css.copyButton} onClick={() => { setSupplementing(true); setSupplementError(undefined) }}>
                  补充日志
                </button>
              ) : (
                <div className={css.supplementPanel}>
                  <span className={css.supplementHint}>选择补充的服务端 / 终端日志 ZIP，将合并进当前案例。</span>
                  <div className={css.supplementActions}>
                    <label className={css.secondaryButton}>补充服务端日志<input type="file" multiple accept=".zip" onChange={(event) => { void supplement('server', event.currentTarget.files) }} /></label>
                    <label className={css.secondaryButton}>补充终端日志<input type="file" multiple accept=".zip" onChange={(event) => { void supplement('terminal', event.currentTarget.files) }} /></label>
                    <button type="button" className={css.copyButton} onClick={() => { setSupplementing(false) }}>取消</button>
                  </div>
                  {supplementError !== undefined && <p className={css.errorText}>{supplementError}</p>}
                </div>
              )}
            </div>
            {preview !== undefined && (
              <section className={css.previewCard} aria-label="证据文件预览">
                <div className={css.previewHeader}>
                  <span className={css.previewPath} title={preview.path}>{preview.path}</span>
                  <span className={css.previewMeta}>{String(preview.totalLines)} 行 · 前 500 行</span>
                  <button type="button" className={css.previewClose} onClick={() => { setPreview(undefined) }}>关闭</button>
                </div>
                <pre className={css.previewBody}>{preview.text}</pre>
              </section>
            )}
            {previewError !== undefined && <p className={css.errorText}>{previewError}</p>}
            {evidence !== undefined && <QzhEvidencePreview evidence={evidence} />}
          </>
        ) : (
          <QzhAnalysisStatusReport
            caseView={state.caseView}
            onFeedback={submitFeedback}
            {...(tree === undefined ? {} : { evidencePaths: tree.files.map(file => file.path) })}
            onPreviewFile={previewFile}
            onReadCode={readCode}
          />
        )}
      </div>
    )
    : <div className={css.dockCollapsed} role="status"><span>QZH 只读分析 · {state.caseView.state} · {state.entries.length} 个日志文件</span><button type="button" onClick={() => { actions.setPanelOpen(true) }}>查看证据</button></div>
}

/** Clock time (HH:MM:SS.mmm) for one timeline event. */
function formatClock(epochMs: number): string {
  const date = new Date(epochMs)
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

/** Encode bytes as base64 in chunks (btoa is bounded by call-stack size). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

/** Merge supplemented entries into the existing ones, deduped by path. */
function mergeEntries(base: readonly ImportedLogEntry[], added: readonly ImportedLogEntry[]): ImportedLogEntry[] {
  const seen = new Set(base.map(entry => entry.path))
  return [...base, ...added.filter(entry => !seen.has(entry.path))]
}

/** Merge supplemented clusters into the existing ones, deduped by key. */
function mergeClusters(base: readonly import('../log-parser.ts').LogErrorCluster[], added: readonly import('../log-parser.ts').LogErrorCluster[]): import('../log-parser.ts').LogErrorCluster[] {
  const seen = new Set(base.map(cluster => cluster.key))
  return [...base, ...added.filter(cluster => !seen.has(cluster.key))]
}
