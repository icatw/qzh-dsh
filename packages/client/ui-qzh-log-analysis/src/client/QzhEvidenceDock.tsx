import { useEffect, useState } from 'react'
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { QzhCaseView, QzhFeedbackKind, QzhLogListResult } from '@deepseek-ai/dsh-api-remotes/client'
import { buildQzhEvidence } from './evidence.ts'
import { QzhAnalysisStatus } from './QzhAnalysisStatus.tsx'
import { QzhEvidenceFiles } from './QzhEvidenceFiles.tsx'
import { QzhEvidencePreview } from './QzhEvidencePreview.tsx'
import type { QzhSessionState, createQzhSessionStore } from './store.ts'
import css from './QzhLogAnalysisSection.module.css'

interface Injected {
  readonly startAnalysis: (id: QzhCaseView['id']) => Promise<QzhCaseView>
  readonly getCase: (id: QzhCaseView['id']) => Promise<QzhCaseView>
  readonly getEvidenceTree: (id: QzhCaseView['id']) => Promise<QzhLogListResult>
  readonly setFeedback: (id: QzhCaseView['id'], kind: QzhFeedbackKind, comment?: string) => Promise<QzhCaseView>
  readonly renameSession: (title: string) => Promise<void>
}

type Props = PropsRuntime<'conversation.details.qzh'> & PropsStore<ReturnType<typeof createQzhSessionStore>> & Injected

/** QZH evidence and progress panel rendered in DSH's right details column. */
export function QzhEvidenceDock({
  sessionId, useSessions, useStore, actions, startAnalysis, getCase, getEvidenceTree, setFeedback, renameSession,
}: Props) {
  const sessionSummary = useSessions(state => state.byId[sessionId])
  const preset = sessionSummary?.agentPreset
  const state = useStore((value: QzhSessionState) => value)
  const caseId = state.caseView?.id
  const caseState = state.caseView?.state
  const [tree, setTree] = useState<QzhLogListResult | undefined>()
  useEffect(() => {
    if (preset !== 'qzh' || caseId === undefined) return
    let disposed = false
    // Re-fetch on state change too: the archive upload completes between
    // `evidence-ready` and `analyzing`, and the tree only reflects the full
    // bundle once it has landed. A `caseId`-only effect would freeze on the
    // summary tree fetched before the upload finished.
    void getEvidenceTree(caseId).then(result => { if (!disposed) setTree(result) }).catch(() => {})
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
  if (preset !== 'qzh' || state.caseView === undefined || state.entries.length === 0) return null
  const evidence = buildQzhEvidence(state.entries, state.clusters)
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
  return state.panelOpen
    ? (
      <div className={css.dockExpanded}>
        <QzhAnalysisStatus caseView={state.caseView} running={state.caseView.state === 'analyzing'} onStart={() => { void retry() }} onFeedback={submitFeedback} />
        {tree !== undefined && (
          <QzhEvidenceFiles files={tree.files} clusters={tree.clusters} archive={tree.archive} summaryOnly={tree.summaryOnly === true} />
        )}
        <QzhEvidencePreview evidence={evidence} />
      </div>
    )
    : <div className={css.dockCollapsed} role="status"><span>QZH 只读分析 · {state.caseView.state} · {state.entries.length} 个日志文件</span><button type="button" onClick={() => { actions.setPanelOpen(true) }}>查看证据</button></div>
}
