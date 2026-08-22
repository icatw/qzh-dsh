import { useState } from 'react'
import type { QzhEvidenceCluster, QzhEvidenceTreeFile, QzhLogListResult } from '@deepseek-ai/dsh-api-remotes/client'
import css from './QzhLogAnalysisSection.module.css'

interface Props {
  readonly files: readonly QzhEvidenceTreeFile[]
  readonly clusters: readonly QzhEvidenceCluster[]
  /** Uploaded bundle metadata; absent when no full archive was uploaded. */
  readonly archive?: QzhLogListResult['archive']
  /** True when only the submitted summary is available (no full archive). */
  readonly summaryOnly: boolean
}

/** Human-readable byte size. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Collapsible evidence-file listing for the QZH details dock. */
export function QzhEvidenceFiles({ files, clusters, archive, summaryOnly }: Props) {
  const [open, setOpen] = useState(false)
  if (files.length === 0 && archive === undefined) return null
  const label = summaryOnly ? '证据摘要' : '证据文件'
  return (
    <section className={css.evidenceSection} aria-label="证据文件">
      {archive !== undefined && (
        <div className={css.evidenceRow} data-evidence-kind="archive">
          <div className={css.evidenceMain}>
            <span title={archive.filename}>📦 {archive.filename}</span>
            <span>{formatBytes(archive.size)} · 完整日志包</span>
          </div>
        </div>
      )}
      <button type="button" className={css.evidenceToggle} onClick={() => { setOpen(current => !current) }}>
        <span>{label}（{files.length}）{clusters.length > 0 ? ` · ${String(clusters.length)} 类异常` : ''}</span>
        <span className={css.evidenceToggleAction}>{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className={css.evidenceRows}>
          {files.map(file => (
            <div key={file.path} className={css.evidenceRow}>
              <div className={css.evidenceMain}>
                <span title={file.path}>{file.path}</span>
                <span>{formatBytes(file.size)}{file.lineCount !== undefined ? ` · ${String(file.lineCount)} 行` : ''} · {file.category}{file.stream !== 'log' ? ` · ${file.stream}` : ''}</span>
                {file.sample !== undefined && file.sample !== '' && (
                  <span className={css.evidenceSample} title={file.sample}>{file.sample}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
