import { useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './QzhComposer.module.css'

interface QzhComposerInjected {
  readonly send: (text: string) => Promise<void>
}

type Props = PropsRuntime<'conversation.composer.qzh'> & QzhComposerInjected

/** Plain-text, read-only follow-up composer for active QZH sessions. */
export function QzhComposer({ useSession, send }: Props) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const running = useSession(state => state.running)
  const submit = async (): Promise<void> => {
    const text = draft.trim()
    if (text === '' || sending) return
    setSending(true)
    setError(undefined)
    try {
      await send(text)
      setDraft('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSending(false)
    }
  }
  return (
    <section className={css.frame} aria-label="QZH 只读追问">
      <div className={css.heading}><strong>继续追问</strong><span>仅发送文字，不提供命令、附件或模型切换。</span></div>
      <textarea value={draft} onChange={event => { setDraft(event.currentTarget.value) }} placeholder="追问日志链路、代码证据或现场验证步骤…" rows={2} />
      <div className={css.actions}>
        <span>{error ?? (running ? '分析进行中，问题会排队到当前会话。' : '问题会进入当前 QZH 会话。')}</span>
        <button type="button" className={css.sendButton} disabled={draft.trim() === '' || sending} onClick={() => { void submit() }}>{sending ? '发送中…' : '发送追问'}</button>
      </div>
    </section>
  )
}
