import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { QzhCaseView } from '@deepseek-ai/dsh-api-remotes/client'
import { buildQzhEvidence } from './evidence.ts'
import { QzhAnalysisStatus } from './QzhAnalysisStatus.tsx'
import { QzhEvidencePreview } from './QzhEvidencePreview.tsx'
import type { QzhSessionState, createQzhSessionStore } from './store.ts'
import css from './QzhLogAnalysisSection.module.css'

interface Injected {
  readonly startAnalysis: (id: QzhCaseView['id']) => Promise<QzhCaseView>
}

type Props = PropsRuntime<'conversation.composer.qzh.dock'> & PropsStore<ReturnType<typeof createQzhSessionStore>> & Injected

/** Compact evidence/progress rail kept in the normal conversation layout. */
export function QzhEvidenceDock({ sessionId, useSessions, useStore, actions, startAnalysis }: Props) {
  const preset = useSessions(state => state.byId[sessionId]?.agentPreset)
  const state = useStore((value: QzhSessionState) => value)
  if (preset !== 'qzh' || state.caseView === undefined || state.entries.length === 0) return null
  const evidence = buildQzhEvidence(state.entries, state.clusters)
  const retry = async (): Promise<void> => {
    if (state.caseView === undefined) return
    const started = await startAnalysis(state.caseView.id)
    actions.setCaseView(started)
  }
  return state.panelOpen
    ? <div className={css.dockExpanded}><QzhAnalysisStatus caseView={state.caseView} running={state.caseView.state === 'analyzing'} onStart={() => { void retry() }} /><QzhEvidencePreview evidence={evidence} /></div>
    : <div className={css.dockCollapsed} role="status"><span>QZH 只读分析 · {state.caseView.state} · {state.entries.length} 个日志文件</span><button type="button" onClick={() => { actions.setPanelOpen(true) }}>查看证据</button></div>
}
