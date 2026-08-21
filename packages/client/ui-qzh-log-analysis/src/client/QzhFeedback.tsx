import { useState } from 'react'
import type { QzhFeedbackKind } from '@deepseek-ai/dsh-api-remotes/client'
import css from './QzhLogAnalysisSection.module.css'

interface Props {
  /** The recorded verdict; undefined when the user has not voted yet. */
  readonly feedback: QzhFeedbackKind | undefined
  readonly onFeedback: (kind: QzhFeedbackKind, comment?: string) => void
}
/** Capture a helpful / not-helpful verdict on the completed report. */
export function QzhFeedback({ feedback, onFeedback }: Props) {
  const [comment, setComment] = useState('')
  const submitted = feedback !== undefined
  return (
    <section className={css.feedbackRow} aria-label="分析反馈">
      {submitted
        ? <span className={css.feedbackNote}>{feedback === 'like' ? '已标记为有效，感谢反馈。' : '已标记为踩，感谢反馈。'}</span>
        : (
          <>
            <span className={css.stepLabel}>这次分析有用吗？</span>
            <button type="button" aria-pressed={false} onClick={() => { onFeedback('like', comment.trim() === '' ? undefined : comment.trim()) }}>有效</button>
            <button type="button" aria-pressed={false} onClick={() => { onFeedback('dislike', comment.trim() === '' ? undefined : comment.trim()) }}>踩</button>
            <input
              type="text"
              placeholder="可选：一句反馈（哪里对/哪里错）"
              value={comment}
              onChange={event => { setComment(event.currentTarget.value) }}
            />
          </>
        )}
    </section>
  )
}
