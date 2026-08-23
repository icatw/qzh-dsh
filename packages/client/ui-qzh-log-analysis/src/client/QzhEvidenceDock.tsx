import { useEffect, useState } from 'react'
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { QzhArchiveDownload, QzhCaseView, QzhFeedbackKind, QzhLogCategory, QzhLogListResult, QzhLogReadResult } from '@deepseek-ai/dsh-api-remotes/client'
import { buildQzhEvidence } from './evidence.ts'
import { QzhAnalysisStatus } from './QzhAnalysisStatus.tsx'
import { QzhEvidenceFiles } from './QzhEvidenceFiles.tsx'
import { QzhEvidencePreview } from './QzhEvidencePreview.tsx'
import type { QzhSessionState, createQzhSessionStore } from './store.ts'
import css from './QzhLogAnalysisSection.module.css'

interface Injected {
  readonly startAnalysis: (id: QzhCaseView['id']) => Promise<QzhCaseView>
  readonly getCase: (id: QzhCaseView['id']) => Promise<QzhCaseView>
  readonly getActiveCase: () => Promise<QzhCaseView | undefined>
  readonly getEvidenceTree: (id: QzhCaseView['id']) => Promise<QzhLogListResult>
  readonly readEvidenceRange: (id: QzhCaseView['id'], path: string) => Promise<QzhLogReadResult>
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
  sessionId, useSessions, useStore, actions, startAnalysis, getCase, getActiveCase, getEvidenceTree,
  readEvidenceRange, downloadEvidenceArchive, setFeedback, renameSession,
}: Props) {
  const sessionSummary = useSessions(state => state.byId[sessionId])
  const preset = sessionSummary?.agentPreset
  const state = useStore((value: QzhSessionState) => value)
  const caseId = state.caseView?.id
  const caseState = state.caseView?.state
  const [tree, setTree] = useState<QzhLogListResult | undefined>()
  const [preview, setPreview] = useState<FilePreview | undefined>()
  const [previewError, setPreviewError] = useState<string | undefined>()
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
        <QzhAnalysisStatus caseView={state.caseView} running={state.caseView.state === 'analyzing'} onStart={() => { void retry() }} onFeedback={submitFeedback} {...(tree === undefined ? {} : { evidencePaths: tree.files.map(file => file.path) })} onPreviewFile={previewFile} />
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
        <QzhAnalysisStatus caseView={state.caseView} running={state.caseView.state === 'analyzing'} onStart={() => { void retry() }} onFeedback={submitFeedback} {...(tree === undefined ? {} : { evidencePaths: tree.files.map(file => file.path) })} onPreviewFile={previewFile} />
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
      </div>
    )
    : <div className={css.dockCollapsed} role="status"><span>QZH 只读分析 · {state.caseView.state} · {state.entries.length} 个日志文件</span><button type="button" onClick={() => { actions.setPanelOpen(true) }}>查看证据</button></div>
}
