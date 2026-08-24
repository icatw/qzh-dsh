import { useState, type DragEvent } from 'react'
import { MAX_PREVIEW_BYTES, type ImportedLogEntry } from '../log-import.ts'
import type { QzhLogCategory } from '../log-layout.ts'
import css from './QzhLogAnalysisSection.module.css'

/** Files listed inline per field side before the summary confirmation. */
const MAX_LISTED_FILES = 5

/** Human-readable byte size. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

interface Props {
  readonly entries: readonly ImportedLogEntry[]
  readonly onFiles: (category: QzhLogCategory, files: FileList | null) => void
  readonly status: string
}

interface UploadZoneProps {
  readonly category: QzhLogCategory
  readonly title: string
  readonly hint: string
  readonly count: number
  readonly onFiles: (category: QzhLogCategory, files: FileList | null) => void
}

/** One side's upload zone: two file pickers plus a drop target. */
function UploadZone({ category, title, hint, count, onFiles }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false)
  const drop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragging(false)
    onFiles(category, event.dataTransfer.files)
  }
  return (
    <div className={css.uploadPanel}>
      <div className={css.uploadPanelHead}>
        <span className={css.stepLabel}>{title}</span>
        <span className={css.uploadCount}>{count} 个文件</span>
      </div>
      <p className={css.uploadHint}>{hint}</p>
      <div className={css.uploadActions}>
        <label className={css.primaryButton}>选择日志目录<input type="file" multiple accept=".log,.txt,.out" {...({ webkitdirectory: '' } as Record<string, string>)} onChange={(event) => { onFiles(category, event.currentTarget.files) }} /></label>
        <label className={css.secondaryButton}>选择 ZIP<input type="file" multiple accept=".zip" onChange={(event) => { onFiles(category, event.currentTarget.files) }} /></label>
      </div>
      <div
        className={`${css.dropZone} ${dragging ? css.dropZoneActive : ''}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
        onDragOver={(event) => { event.preventDefault() }}
        onDragLeave={(event) => { event.preventDefault(); setDragging(false) }}
        onDrop={drop}
      >
        {dragging ? '松开鼠标以导入' : '或将日志文件拖到这里'}
      </div>
    </div>
  )
}

/** Compact first-stage entry point for a blank QZH session. */
export function QzhImportHero({ entries, onFiles, status }: Props) {
  const imported = entries.length > 0
  const serverCount = entries.filter(entry => entry.category === 'server').length
  const terminalCount = entries.filter(entry => entry.category === 'terminal').length
  const importedGroups = (['server', 'terminal'] as const).map((category) => {
    const files = entries.filter(entry => entry.category === category)
    return {
      category,
      files,
      totalBytes: files.reduce((sum, entry) => sum + entry.size, 0),
      visible: files.slice(0, MAX_LISTED_FILES),
      rest: files.length - MAX_LISTED_FILES,
    }
  }).filter(group => group.files.length > 0)
  // File groups fold by default so a large bundle does not stretch the page.
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<QzhLogCategory>>(new Set(['server', 'terminal']))
  const toggleGroup = (category: QzhLogCategory): void => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }
  return (
    <section className={css.hero} aria-labelledby="qzh-import-heading">
      <div className={css.heroInner}>
        <div className={css.heroCopy}>
          <span className={css.stepLabel}>QZH 日志分析</span>
          <h1 id="qzh-import-heading">从日志开始定位故障</h1>
          <p>服务端与终端日志分开导入。浏览器先做本地解析，确认摘要后才发送到内网分析 Host。</p>
        </div>
        <div className={css.uploadGrid}>
          <UploadZone
            category="server"
            title="服务端日志"
            hint="qzh_web_agent / qzh_log_center 等，含对应 error 日志。"
            count={serverCount}
            onFiles={onFiles}
          />
          <UploadZone
            category="terminal"
            title="终端日志"
            hint="被管终端 agent：qzh_agent / qzh_agent_flush 等。"
            count={terminalCount}
            onFiles={onFiles}
          />
        </div>
        {importedGroups.length > 0 && (
          <div className={css.importedList} aria-label="已选文件">
            {importedGroups.map((group) => {
              const folded = collapsedGroups.has(group.category)
              return (
                <div key={group.category} className={css.importedGroup}>
                  <button
                    type="button"
                    className={css.importedGroupHead}
                    aria-expanded={!folded}
                    onClick={() => { toggleGroup(group.category) }}
                  >
                    <span>{folded ? '▸' : '▾'} {group.category === 'server' ? '服务端' : '终端'} {group.files.length} 个文件</span>
                    <span>{formatBytes(group.totalBytes)}{folded ? ' · 展开' : ''}</span>
                  </button>
                  {!folded && group.visible.map(entry => (
                    <div key={entry.path} className={css.importedRow}>
                      <span className={css.importedPath} title={entry.path}>{entry.path}</span>
                      <span className={css.importedSize}>
                        {formatBytes(entry.size)}
                        {entry.size > MAX_PREVIEW_BYTES ? ' · 大文件，本地预览截断' : ''}
                      </span>
                    </div>
                  ))}
                  {!folded && group.rest > 0 && <div className={css.importedMore}>等 {group.rest} 个文件…</div>}
                </div>
              )
            })}
          </div>
        )}
        <div className={css.heroMeta} aria-live="polite">
          <span>{imported ? `服务端 ${serverCount} 个 · 终端 ${terminalCount} 个` : '第 1 步 · 导入日志'}</span>
          <span>{imported ? `${String(entries.length)} 个文件待发送` : '支持 .log、.out、带日志特征的 .txt 和 ZIP'}</span>
        </div>
        <p className={css.status} aria-live="polite">{status}</p>
      </div>
    </section>
  )
}
