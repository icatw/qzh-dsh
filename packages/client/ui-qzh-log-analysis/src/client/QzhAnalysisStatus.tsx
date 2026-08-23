import { useMemo, useState } from 'react'
import type { QzhCaseView, QzhFeedbackKind } from '@deepseek-ai/dsh-api-remotes/client'
import { MarkdownText, type MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import { QzhFeedback } from './QzhFeedback.tsx'
import css from './QzhLogAnalysisSection.module.css'

interface Props {
  readonly caseView?: QzhCaseView
  readonly running: boolean
  readonly onStart: () => void
  readonly onFeedback: (kind: QzhFeedbackKind, comment?: string) => void
  /** Known evidence-file paths (with `server/`/`terminal/` prefix) for report mentions. */
  readonly evidencePaths?: readonly string[]
  /** Opens the preview of one evidence file from a report mention. */
  readonly onPreviewFile?: (path: string) => Promise<void>
}

/** Short epoch-ms timestamp for the case metadata line. */
function formatTimestamp(epochMs: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(epochMs))
}

/** Compact case id for the metadata line (keeps the full id in the title). */
function shortId(id: QzhCaseView['id']): string {
  return `#${String(id).slice(0, 8)}`
}

/** Show the third-stage analysis state without adding another page. */
export function QzhAnalysisStatus({ caseView, running, onStart, onFeedback, evidencePaths, onPreviewFile }: Props) {
  const [copied, setCopied] = useState(false)
  // Report mentions: inline-code tokens that name a known evidence file
  // (optionally with a `:line` suffix) become clickable openers that preview
  // the file; everything else stays inert code.
  const fileMentions = useMemo<MarkdownFileMentions | undefined>(() => {
    if (evidencePaths === undefined || onPreviewFile === undefined) return undefined
    const known = new Set(evidencePaths)
    return {
      resolve(value) {
        const match = /^(.*?):\d+$/.exec(value)
        const path = match === null ? value : match[1] ?? value
        if (!known.has(path)) return undefined
        return { open: () => { void onPreviewFile(path) }, label: value, title: path }
      },
    }
  }, [evidencePaths, onPreviewFile])
  if (caseView === undefined) return null
  const analyzing = running || caseView.state === 'analyzing'
  const completed = caseView.state === 'completed' || caseView.state === 'completed_with_limitations'
  const limited = caseView.state === 'completed_with_limitations'
  const copyReport = async (): Promise<void> => {
    if (caseView.report === undefined) return
    await navigator.clipboard.writeText(caseView.report)
    setCopied(true)
    window.setTimeout(() => { setCopied(false) }, 1_500)
  }
  const downloadReport = (): void => {
    if (caseView.report === undefined) return
    const blob = new Blob([caseView.report], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `qzh-report-${shortId(caseView.id)}.md`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  return (
    <section className={css.analysisCard} aria-labelledby="qzh-analysis-status">
      <div className={css.sectionHeading}>
        <div>
          <h2 id="qzh-analysis-status">{completed ? '报告已回到当前会话' : analyzing ? '正在分析当前会话' : '摘要已提交'}</h2>
          <p>{limited ? '报告缺少部分必要结构，已按受限完成保留；结论仍可参考。' : completed ? '报告和后续追问会继续留在右侧消息流。' : analyzing ? 'Agent 正在按时间线读取日志证据和 QZH 只读源码。' : '确认摘要后启动只读分析。'}</p>
        </div>
        <span className={css.statePill} data-state={caseView.state}>{completed ? (limited ? '受限完成' : '已完成') : analyzing ? '分析中' : caseView.state}</span>
      </div>
      <div className={css.caseMeta}>
        {caseView.productVersion !== undefined && <span title={`产品版本 ${caseView.productVersion}`}>版本 {caseView.productVersion}</span>}
        {caseView.createdAt !== undefined && <span title={`提交于 ${new Date(caseView.createdAt).toLocaleString('zh-CN')}`}>提交 {formatTimestamp(caseView.createdAt)}</span>}
        <span title={String(caseView.id)}>{shortId(caseView.id)}</span>
      </div>
      {!completed && !analyzing && <button className={css.primaryButton} type="button" onClick={onStart}>启动当前会话分析</button>}
      {caseView.analysisError !== undefined && <p className={css.errorText}>{caseView.analysisError}</p>}
      {caseView.report !== undefined && (
        <div className={css.report}>
          <div className={css.reportActions}>
            <button type="button" className={css.copyButton} onClick={() => { void copyReport() }}>
              {copied ? '已复制' : '复制报告'}
            </button>
            <button type="button" className={css.copyButton} onClick={downloadReport}>下载报告 (.md)</button>
          </div>
          <MarkdownText text={caseView.report} fileMentions={fileMentions} />
        </div>
      )}
      {completed && <QzhFeedback feedback={caseView.feedback} onFeedback={onFeedback} />}
    </section>
  )
}
