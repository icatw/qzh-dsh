import { useMemo, useState } from 'react'
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
  /** Preview one evidence file's content (`server/…` or `terminal/…` path). */
  readonly onPreviewFile: (path: string) => Promise<void>
}

/** Human-readable byte size. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Collapsible evidence-file listing for the QZH details dock. */
export function QzhEvidenceFiles({ files, clusters, archives, summaryOnly, onDownloadArchive, onPreviewFile }: Props) {
  const [open, setOpen] = useState(false)
  const [downloadingCategory, setDownloadingCategory] = useState<QzhLogCategory | undefined>()
  const [downloadError, setDownloadError] = useState<string | undefined>()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  // Group files by directory (the path already carries the server/terminal
  // prefix), so a large bundle stays browsable instead of one flat list.
  const groups = useMemo(() => {
    const map = new Map<string, QzhEvidenceTreeFile[]>()
    for (const file of files) {
      const slash = file.path.lastIndexOf('/')
      const dir = slash > 0 ? file.path.slice(0, slash) : '(根目录)'
      const list = map.get(dir) ?? []
      list.push(file)
      map.set(dir, list)
    }
    return [...map.entries()].map(([dir, list]) => ({ dir, files: list })).sort((a, b) => a.dir.localeCompare(b.dir))
  }, [files])
  const toggleDir = (dir: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })
  }
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
          {groups.map(group => (
            <div key={group.dir} className={css.evidenceGroup}>
              <button
                type="button"
                className={css.evidenceDir}
                aria-expanded={!collapsed.has(group.dir)}
                onClick={() => { toggleDir(group.dir) }}
              >
                <span className={css.evidenceDirIcon}>{collapsed.has(group.dir) ? '▸' : '▾'}</span>
                <span className={css.evidenceDirName} title={group.dir}>{group.dir}</span>
                <span className={css.evidenceDirCount}>{group.files.length}</span>
              </button>
              {!collapsed.has(group.dir) && group.files.map((file) => {
                const base = group.dir === '(根目录)' ? file.path : file.path.slice(group.dir.length + 1)
                return (
                  <button
                    type="button"
                    key={`${file.category}/${file.path}`}
                    className={css.evidenceRow}
                    title={`点击查看 ${file.path}`}
                    onClick={() => { void onPreviewFile(file.path) }}
                  >
                    <div className={css.evidenceMain}>
                      <span className={css.evidencePath}>{base}</span>
                      <span>{formatBytes(file.size)}{file.lineCount !== undefined ? ` · ${String(file.lineCount)} 行` : ''} · {categoryLabel(file.category)}{file.stream !== 'log' ? ` · ${file.stream}` : ''}</span>
                      {file.sample !== undefined && file.sample !== '' && (
                        <span className={css.evidenceSample} title={file.sample}>{file.sample}</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
