import { useState, type DragEvent } from 'react'
import type { ImportedLogEntry } from '../log-import.ts'
import type { LogErrorCluster } from '../log-parser.ts'
import css from './QzhLogAnalysisSection.module.css'

interface Props {
  readonly entries: readonly ImportedLogEntry[]
  readonly clusters: readonly LogErrorCluster[]
  readonly onFiles: (files: FileList | null) => void
  readonly status: string
}
/** Compact first-stage entry point for a blank QZH session. */
export function QzhImportHero({ entries, clusters, onFiles, status }: Props) {
  const [dragging, setDragging] = useState(false)
  const drop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragging(false)
    onFiles(event.dataTransfer.files)
  }
  const imported = entries.length > 0
  return (
    <section className={css.hero} aria-labelledby="qzh-import-heading">
      <div className={css.heroInner}>
        <div className={css.heroCopy}>
          <span className={css.stepLabel}>QZH 日志分析</span>
          <h1 id="qzh-import-heading">从日志开始定位故障</h1>
          <p>导入服务端或终端日志。浏览器先做本地解析，确认摘要后才发送到内网分析 Host。</p>
        </div>
        <div className={css.uploadActions}>
          <label className={css.primaryButton}>选择日志目录<input type="file" multiple accept=".log,.txt,.out" {...({ webkitdirectory: '' } as Record<string, string>)} onChange={event => { onFiles(event.currentTarget.files) }} /></label>
          <label className={css.secondaryButton}>选择 ZIP<input type="file" multiple accept=".zip" onChange={event => { onFiles(event.currentTarget.files) }} /></label>
        </div>
        <div
          className={`${css.dropZone} ${dragging ? css.dropZoneActive : ''}`}
          onDragEnter={event => { event.preventDefault(); setDragging(true) }}
          onDragOver={event => { event.preventDefault() }}
          onDragLeave={event => { event.preventDefault(); setDragging(false) }}
          onDrop={drop}
        >
          {dragging ? '松开鼠标以导入日志' : '也可以将日志文件拖到这里'}
        </div>
        <div className={css.heroMeta} aria-live="polite">
          <span>{imported ? `${entries.length} 个日志文件` : '第 1 步 · 导入日志'}</span>
          <span>{imported ? `${clusters.length} 类异常` : '支持 .log、.out、带日志特征的 .txt 和 ZIP'}</span>
        </div>
        <p className={css.status} aria-live="polite">{status}</p>
      </div>
    </section>
  )
}
