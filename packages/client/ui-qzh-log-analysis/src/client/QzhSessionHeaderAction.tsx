import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { QzhSessionState, createQzhSessionStore } from './store.ts'
import css from './QzhSessionHeaderAction.module.css'

type Props = PropsRuntime<'conversation.session.header.actions'> & PropsStore<ReturnType<typeof createQzhSessionStore>>

/** Compact current-session QZH status and evidence-panel toggle. */
export function QzhSessionHeaderAction({ sessionId, useSessions, useStore, actions }: Props) {
  const preset = useSessions(state => state.byId[sessionId]?.agentPreset)
  const qzh = useStore((state: QzhSessionState) => state)
  if (preset !== 'qzh') return null
  return <button className={css.action} type="button" onClick={() => { actions.setPanelOpen(!qzh.panelOpen) }} aria-pressed={qzh.panelOpen}><span className={css.mark} aria-hidden="true">⌁</span><span>QZH</span>{qzh.entries.length > 0 && <span className={css.badge}>{qzh.entries.length}</span>}</button>
}
