import { useMemo, useState } from 'react'
import type { QzhCaseView, QzhFeedbackKind } from '@deepseek-ai/dsh-api-remotes/client'
import { MarkdownText, type MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import { QzhFeedback } from './QzhFeedback.tsx'
import css from './QzhLogAnalysisSection.module.css'

interface Props {
  readonly caseView?: QzhCaseView
  readonly running: boolean
  /** Start or resume the investigation (keeps the case `analyzing`). */
  readonly onStart: () => void
  /** Ask the Agent to produce the final structured report. */
  readonly onGenerateReport: () => void
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

/** Always-visible case state card: heading, metadata, and the action buttons. */
export function QzhAnalysisStatusHead({ caseView, running, onStart, onGenerateReport }: {
  readonly caseView?: QzhCaseView
  readonly running: boolean
  readonly onStart: () => void
  readonly onGenerateReport: () => void
}) {
  if (caseView === undefined) return null
  const analyzing = running || caseView.state === 'analyzing'
  const completed = caseView.state === 'completed' || caseView.state === 'completed_with_limitations'
  const limited = caseView.state === 'completed_with_limitations'
  // A draft case (created without a submitted summary, e.g. an interrupted
  // submit or a stale restore) has no evidence; starting analysis is invalid.
  const draft = caseView.state === 'draft' || caseView.evidence === undefined
  return (
    <section className={css.analysisCard} aria-labelledby="qzh-analysis-status">
      <div className={css.sectionHeading}>
        <div>
          <h2 id="qzh-analysis-status">{completed ? '报告已生成' : analyzing ? '正在分析当前会话' : draft ? '等待提交日志' : '摘要已提交'}</h2>
          <p>{limited ? '报告缺少部分必要结构，已按受限完成保留；结论仍可参考。' : completed ? '报告已生成；可继续追问、补充日志或重新生成。' : analyzing ? 'Agent 正在读取日志证据并定位；可继续追问、补充日志，或直接生成报告。' : draft ? '请重新导入日志并确认发送内容，之后才能启动分析。' : '确认摘要后启动只读分析。'}</p>
        </div>
        <span className={css.statePill} data-state={caseView.state}>{completed ? (limited ? '受限完成' : '已完成') : analyzing ? '分析中' : draft ? '未提交' : caseView.state}</span>
      </div>
      <div className={css.caseMeta}>
        {caseView.productVersion !== undefined && <span title={`产品版本 ${caseView.productVersion}`}>版本 {caseView.productVersion}</span>}
        {caseView.createdAt !== undefined && <span title={`提交于 ${new Date(caseView.createdAt).toLocaleString('zh-CN')}`}>提交 {formatTimestamp(caseView.createdAt)}</span>}
        <span title={String(caseView.id)}>{shortId(caseView.id)}</span>
      </div>
      <div className={css.statusActions}>
        {analyzing && <button className={css.primaryButton} type="button" onClick={onGenerateReport}>生成报告</button>}
        {!analyzing && !completed && !draft && <button className={css.primaryButton} type="button" onClick={onStart}>启动当前会话分析</button>}
        {completed && <button className={css.secondaryButton} type="button" onClick={onStart}>继续分析</button>}
      </div>
      {caseView.analysisError !== undefined && <p className={css.errorText}>{caseView.analysisError}</p>}
    </section>
  )
}

/** Report region: copy / download actions, the Markdown report, and feedback. */
export function QzhAnalysisStatusReport({ caseView, onFeedback, evidencePaths, onPreviewFile, onReadCode }: {
  readonly caseView?: QzhCaseView
  readonly onFeedback: (kind: QzhFeedbackKind, comment?: string) => void
  readonly evidencePaths?: readonly string[]
  readonly onPreviewFile?: (path: string) => Promise<void>
  /** Reads a source excerpt at a path/line; enables code mentions in the report. */
  readonly onReadCode?: (id: QzhCaseView['id'], path: string, startLine: number, endLine: number) => Promise<import('@deepseek-ai/dsh-api-remotes/client').QzhCodeReadResult>
}) {
  const [copied, setCopied] = useState(false)
  const [codePreview, setCodePreview] = useState<import('@deepseek-ai/dsh-api-remotes/client').QzhCodeReadResult | undefined>()
  const [codeError, setCodeError] = useState<string | undefined>()
  const readCodeAt = async (id: QzhCaseView['id'], path: string, line: number): Promise<void> => {
    if (onReadCode === undefined) return
    setCodeError(undefined)
    try {
      const result = await onReadCode(id, path, line, line + 9)
      setCodePreview(result)
    } catch (error) {
      setCodePreview(undefined)
      setCodeError(`读取代码 ${path} 失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  // Report mentions: inline-code tokens that name a known evidence file
  // (optionally with a `:line` suffix) become clickable openers that preview
  // the file; a source-file token (path + line) reads code through the mirror
  // when a reader is available; everything else stays inert code.
  const fileMentions = useMemo<MarkdownFileMentions | undefined>(() => {
    if (evidencePaths === undefined || onPreviewFile === undefined) return undefined
    const known = new Set(evidencePaths)
    return {
      resolve(value) {
        const lineMatch = /^(.*?):(\d+)$/.exec(value)
        const bare = lineMatch === null ? value : lineMatch[1] ?? value
        if (known.has(bare)) return { open: () => { void onPreviewFile(bare) }, label: value, title: bare }
        if (lineMatch !== null && onReadCode !== undefined && caseView !== undefined) {
          const codePath = lineMatch[1] as string
          const line = Number(lineMatch[2] as string)
          if (/\.(?:go|ts|tsx|js|jsx|java|py|c|cpp|h|rs|sh|sql|yaml|yml|json|proto)$/i.test(codePath)) {
            return { open: () => { void readCodeAt(caseView.id, codePath, line) }, label: value, title: codePath }
          }
        }
        return undefined
      },
    }
  }, [evidencePaths, onPreviewFile, onReadCode, caseView])
  if (caseView === undefined) return null
  const completed = caseView.state === 'completed' || caseView.state === 'completed_with_limitations'
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
    <section className={css.analysisCard} aria-label="分析报告">
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
      {caseView.report === undefined && <p className={css.muted}>尚未生成报告：在分析进行中点击「生成报告」，或先启动分析。</p>}
      {codePreview !== undefined && (
        <section className={css.previewCard} aria-label="代码预览">
          <div className={css.previewHeader}>
            <span className={css.previewPath} title={`${codePreview.repository}@${codePreview.commit} ${codePreview.path}`}>
              {codePreview.repository}@{codePreview.commit.slice(0, 7)} {codePreview.path}:{codePreview.startLine}
            </span>
            <span className={css.previewMeta}>{codePreview.endLine - codePreview.startLine + 1} 行</span>
            <button type="button" className={css.previewClose} onClick={() => { setCodePreview(undefined) }}>关闭</button>
          </div>
          <pre className={css.previewBody}>{codePreview.text}</pre>
        </section>
      )}
      {codeError !== undefined && <p className={css.errorText}>{codeError}</p>}
      {completed && <QzhFeedback feedback={caseView.feedback} onFeedback={onFeedback} />}
    </section>
  )
}

/** Complete status card (heading + report), used where no tab split exists. */
export function QzhAnalysisStatus({ caseView, running, onStart, onGenerateReport, onFeedback, evidencePaths, onPreviewFile }: Props) {
  if (caseView === undefined) return null
  return (
    <>
      <QzhAnalysisStatusHead caseView={caseView} running={running} onStart={onStart} onGenerateReport={onGenerateReport} />
      <QzhAnalysisStatusReport
        caseView={caseView}
        onFeedback={onFeedback}
        {...(evidencePaths === undefined ? {} : { evidencePaths })}
        {...(onPreviewFile === undefined ? {} : { onPreviewFile })}
      />
    </>
  )
}
