import { useState } from 'react'
import type { QzhArchiveInfo, QzhEvidenceCluster, QzhEvidenceTreeFile, QzhCaseView, QzhLogCategory } from '@deepseek-ai/dsh-api-remotes/client'
import css from './QzhLogAnalysisSection.module.css'

interface Props {
  readonly files: readonly QzhEvidenceTreeFile[]
  readonly clusters: readonly QzhEvidenceCluster[]
  /** Uploaded bundle metadata per field side; empty when no archive landed. */
  readonly archives: readonly QzhArchiveInfo[]
  /** True when only the submitted summary is available (no full archive). */
  readonly summaryOnly: boolean
  /** Case owning the archives; required for download-back. */
  readonly caseId: QzhCaseView['id']
  /** Triggers the browser download of one stored bundle. */
  readonly onDownloadArchive: (category: QzhLogCategory) => Promise<void>
}

/** Human-readable byte size. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Collapsible evidence-file listing for the QZH details dock. */
export function QzhEvidenceFiles({ files, clusters, archives, summaryOnly, onDownloadArchive }: Props) {
  const [open, setOpen] = useState(false)
  const [downloadingCategory, setDownloadingCategory] = useState<QzhLogCategory | undefined>()
  const [downloadError, setDownloadError] = useState<string | undefined>()
  const hasArchives = archives.length > 0
  if (files.length === 0 && !hasArchives) return null
  const label = summaryOnly ? '证据摘要' : '证据文件'
  const categoryLabel = (category: QzhLogCategory): string => category === 'server' ? '服务端' : '终端'
  const download = async (category: QzhLogCategory): Promise<void> => {
    setDownloadingCategory(category)
    setDownloadError(undefined)
    try {
      await onDownloadArchive(category)
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : String(error))
    } finally {
      setDownloadingCategory(undefined)
    }
  }
  return (
    <section className={css.evidenceSection} aria-label="证据文件">
      {archives.map(archive => (
        <div key={archive.category} className={css.evidenceRow} data-evidence-kind="archive">
          <div className={css.evidenceMain}>
            <span title={archive.filename}>📦 {archive.filename}</span>
            <span>{formatBytes(archive.size)} · {categoryLabel(archive.category)}完整日志包</span>
          </div>
          <button type="button" className={css.archiveDownload} disabled={downloadingCategory !== undefined} onClick={() => { void download(archive.category) }}>
            {downloadingCategory === archive.category ? '下载中…' : '下载'}
          </button>
        </div>
      ))}
      {downloadError !== undefined && <p className={css.errorText}>{downloadError}</p>}
      <button type="button" className={css.evidenceToggle} onClick={() => { setOpen(current => !current) }}>
        <span>{label}（{files.length}）{clusters.length > 0 ? ` · ${String(clusters.length)} 类异常` : ''}</span>
        <span className={css.evidenceToggleAction}>{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className={css.evidenceRows}>
          {files.map(file => (
            <div key={`${file.category}/${file.path}`} className={css.evidenceRow}>
              <div className={css.evidenceMain}>
                <span title={`${file.category}/${file.path}`}>{file.path}</span>
                <span>{formatBytes(file.size)}{file.lineCount !== undefined ? ` · ${String(file.lineCount)} 行` : ''} · {categoryLabel(file.category)}{file.stream !== 'log' ? ` · ${file.stream}` : ''}</span>
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
