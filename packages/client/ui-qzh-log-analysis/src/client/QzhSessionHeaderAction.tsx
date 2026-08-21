import { useEffect } from 'react'
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { QzhSessionState, createQzhSessionStore } from './store.ts'
import css from './QzhSessionHeaderAction.module.css'

interface Injected {
  readonly openDetails: () => void
}

type Props = PropsRuntime<'conversation.session.header.actions'> & PropsStore<ReturnType<typeof createQzhSessionStore>> & Injected

/** Compact current-session QZH status and evidence-panel opener. */
export function QzhSessionHeaderAction({ sessionId, useSessions, useStore, actions, openDetails }: Props) {
  const preset = useSessions(state => state.byId[sessionId]?.agentPreset)
  const qzh = useStore((state: QzhSessionState) => state)
  const caseId = qzh.caseView?.id
  useEffect(() => {
    if (preset === 'qzh' && caseId !== undefined && qzh.entries.length > 0 && qzh.panelOpen) openDetails()
  }, [caseId, openDetails, preset, qzh.entries.length, qzh.panelOpen])
  if (preset !== 'qzh') return null
  return <button className={css.action} type="button" onClick={() => { actions.setPanelOpen(true); openDetails() }} aria-pressed={qzh.panelOpen}><span className={css.mark} aria-hidden="true">⌁</span><span>QZH</span>{qzh.entries.length > 0 && <span className={css.badge}>{qzh.entries.length}</span>}</button>
}
