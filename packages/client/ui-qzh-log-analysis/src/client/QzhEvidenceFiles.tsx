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

/** One node of the evidence directory tree. */
interface EvidenceDirNode {
  /** Segment name (empty for the root). */
  name: string
  /** Full slash path of this directory ('' for the root). */
  path: string
  dirs: Map<string, EvidenceDirNode>
  files: QzhEvidenceTreeFile[]
}

/** Build a nested directory tree from the flat evidence paths. */
function buildEvidenceTree(files: readonly QzhEvidenceTreeFile[]): EvidenceDirNode {
  const root: EvidenceDirNode = { name: '', path: '', dirs: new Map(), files: [] }
  for (const file of files) {
    const segments = file.path.split('/')
    let node = root
    let acc = ''
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index] as string
      acc = acc === '' ? segment : `${acc}/${segment}`
      let child = node.dirs.get(acc)
      if (child === undefined) {
        child = { name: segment, path: acc, dirs: new Map(), files: [] }
        node.dirs.set(acc, child)
      }
      node = child
    }
    node.files.push(file)
  }
  return root
}

/** Collapsible evidence-file listing for the QZH details dock. */
export function QzhEvidenceFiles({ files, clusters, archives, summaryOnly, onDownloadArchive, onPreviewFile }: Props) {
  const [open, setOpen] = useState(false)
  const [downloadingCategory, setDownloadingCategory] = useState<QzhLogCategory | undefined>()
  const [downloadError, setDownloadError] = useState<string | undefined>()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  // Nested directory tree (the path already carries the server/terminal
  // prefix), so a large bundle stays browsable like a file explorer.
  const tree = useMemo(() => buildEvidenceTree(files), [files])
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
          <EvidenceDirBranch
            node={tree}
            depth={0}
            collapsed={collapsed}
            toggleDir={toggleDir}
            onPreviewFile={onPreviewFile}
            formatBytes={formatBytes}
            categoryLabel={categoryLabel}
          />
        </div>
      )}
    </section>
  )
}

/** Recursive directory branch: sorted subdirectories then files. */
function EvidenceDirBranch({ node, depth, collapsed, toggleDir, onPreviewFile, formatBytes, categoryLabel }: {
  node: EvidenceDirNode
  depth: number
  collapsed: ReadonlySet<string>
  toggleDir: (dir: string) => void
  onPreviewFile: (path: string) => Promise<void>
  formatBytes: (bytes: number) => string
  categoryLabel: (category: QzhLogCategory) => string
}) {
  const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))
  const files = [...node.files].sort((a, b) => a.path.localeCompare(b.path))
  const indent = { paddingLeft: `${14 + depth * 14}px` } as const
  return (
    <>
      {dirs.map(dir => (
        <div key={dir.path}>
          <button
            type="button"
            className={css.evidenceDir}
            style={indent}
            aria-expanded={!collapsed.has(dir.path)}
            onClick={() => { toggleDir(dir.path) }}
          >
            <span className={css.evidenceDirIcon}>{collapsed.has(dir.path) ? '▸' : '▾'}</span>
            <span className={css.evidenceDirName} title={dir.path}>{dir.name}</span>
            <span className={css.evidenceDirCount}>{dir.files.length + dir.dirs.size}</span>
          </button>
          {!collapsed.has(dir.path) && (
            <EvidenceDirBranch
              node={dir}
              depth={depth + 1}
              collapsed={collapsed}
              toggleDir={toggleDir}
              onPreviewFile={onPreviewFile}
              formatBytes={formatBytes}
              categoryLabel={categoryLabel}
            />
          )}
        </div>
      ))}
      {files.map(file => (
        <button
          type="button"
          key={`${file.category}/${file.path}`}
          className={css.evidenceRow}
          style={indent}
          title={`点击查看 ${file.path}`}
          onClick={() => { void onPreviewFile(file.path) }}
        >
          <div className={css.evidenceMain}>
            <span className={css.evidencePath}>{file.path.slice(file.path.lastIndexOf('/') + 1)}</span>
            <span>{formatBytes(file.size)}{file.lineCount !== undefined ? ` · ${String(file.lineCount)} 行` : ''} · {categoryLabel(file.category)}{file.stream !== 'log' ? ` · ${file.stream}` : ''}</span>
            {file.sample !== undefined && file.sample !== '' && (
              <span className={css.evidenceSample} title={file.sample}>{file.sample}</span>
            )}
          </div>
        </button>
      ))}
    </>
  )
}
