import type { QzhCaseView, QzhFeedbackKind } from '@deepseek-ai/dsh-api-remotes/client'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { QzhFeedback } from './QzhFeedback.tsx'
import css from './QzhLogAnalysisSection.module.css'

interface Props {
  readonly caseView?: QzhCaseView
  readonly running: boolean
  readonly onStart: () => void
  readonly onFeedback: (kind: QzhFeedbackKind, comment?: string) => void
}
/** Show the third-stage analysis state without adding another page. */
export function QzhAnalysisStatus({ caseView, running, onStart, onFeedback }: Props) {
  if (caseView === undefined) return null
  const analyzing = running || caseView.state === 'analyzing'
  const completed = caseView.state === 'completed' || caseView.state === 'completed_with_limitations'
  const limited = caseView.state === 'completed_with_limitations'
  return (
    <section className={css.analysisCard} aria-labelledby="qzh-analysis-status">
      <div className={css.sectionHeading}>
        <div>
          <h2 id="qzh-analysis-status">{completed ? '报告已回到当前会话' : analyzing ? '正在分析当前会话' : '摘要已提交'}</h2>
          <p>{limited ? '报告缺少部分必要结构，已按受限完成保留；结论仍可参考。' : completed ? '报告和后续追问会继续留在右侧消息流。' : analyzing ? 'Agent 正在按时间线读取日志证据和 QZH 只读源码。' : '确认摘要后启动只读分析。'}</p>
        </div>
        <span className={css.statePill} data-state={caseView.state}>{completed ? (limited ? '受限完成' : '已完成') : analyzing ? '分析中' : caseView.state}</span>
      </div>
      {!completed && !analyzing && <button className={css.primaryButton} type="button" onClick={onStart}>启动当前会话分析</button>}
      {caseView.analysisError !== undefined && <p className={css.errorText}>{caseView.analysisError}</p>}
      {caseView.report !== undefined && (
        <div className={css.report}>
          <MarkdownText text={caseView.report} />
        </div>
      )}
      {completed && <QzhFeedback feedback={caseView.feedback} onFeedback={onFeedback} />}
    </section>
  )
}
