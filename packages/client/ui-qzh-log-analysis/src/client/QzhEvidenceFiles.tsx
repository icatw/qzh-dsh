import { useMemo, useState } from 'react'
import type { QzhArchiveInfo, QzhEvidenceCluster, QzhEvidenceTreeFile, QzhCaseView, QzhLogCategory } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconArchiveOutline20, IconChevronDownOutline14, IconChevronRightOutline14, IconCodeOutline16,
  IconFolderClose16, IconFolderOpen16, IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
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

/** Keep only files whose path matches `query` plus their ancestor folders. */
function filterTree(node: EvidenceDirNode, query: string): EvidenceDirNode | null {
  const needle = query.toLowerCase()
  const dirs = new Map<string, EvidenceDirNode>()
  for (const [path, dir] of node.dirs) {
    const filtered = filterTree(dir, needle)
    if (filtered !== null) dirs.set(path, filtered)
  }
  const files = node.files.filter(file => file.path.toLowerCase().includes(needle))
  if (dirs.size === 0 && files.length === 0) return null
  return { name: node.name, path: node.path, dirs, files }
}

/** Collect every directory path in the tree (for collapse-all). */
function collectDirs(node: EvidenceDirNode, into: string[]): void {
  for (const dir of node.dirs.values()) {
    into.push(dir.path)
    collectDirs(dir, into)
  }
}

/** Collapsible evidence-file listing for the QZH details dock. */
export function QzhEvidenceFiles({ files, clusters, archives, summaryOnly, onDownloadArchive, onPreviewFile }: Props) {
  const [open, setOpen] = useState(true)
  const [downloadingCategory, setDownloadingCategory] = useState<QzhLogCategory | undefined>()
  const [downloadError, setDownloadError] = useState<string | undefined>()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  // Nested directory tree (the path already carries the server/terminal
  // prefix), so a large bundle stays browsable like a file explorer.
  const tree = useMemo(() => buildEvidenceTree(files), [files])
  // A non-empty search shows only matching files plus their ancestor chain,
  // forced expanded; the empty search respects the manual fold state.
  const isFiltering = query.trim() !== ''
  const effectiveTree = useMemo(
    () => isFiltering ? filterTree(tree, query.trim()) : tree,
    [tree, query, isFiltering],
  )
  const toggleDir = (dir: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })
  }
  const expandAll = (): void => { setCollapsed(new Set()) }
  const collapseAll = (): void => {
    const paths: string[] = []
    collectDirs(tree, paths)
    setCollapsed(new Set(paths))
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
    <section className={css.evidenceExplorer} aria-label="证据文件">
      <div className={css.evidenceExplorerHeader}>
        <button
          type="button"
          className={css.evidenceExplorerToggle}
          onClick={() => { setOpen(current => !current) }}
          aria-expanded={open}
        >
          <span className={css.evidenceExplorerChevron} aria-hidden="true">
            {open ? <IconChevronDownOutline14 size={14} /> : <IconChevronRightOutline14 size={14} />}
          </span>
          <span className={css.evidenceExplorerIcon} aria-hidden="true">
            {open ? <IconFolderOpen16 size={16} /> : <IconFolderClose16 size={16} />}
          </span>
          <span className={css.evidenceExplorerName}>{label}（{files.length}）</span>
          {clusters.length > 0 && <span className={css.evidenceExplorerMeta}>{clusters.length} 类异常</span>}
        </button>
        <span className={css.evidenceExplorerHint}>点击文件查看日志内容</span>
      </div>
      {open && (
        <>
          {archives.length > 0 && (
            <div className={css.evidenceArchiveList} aria-label="完整日志包">
              {archives.map(archive => (
                <div key={archive.category} className={css.evidenceArchiveRow}>
                  <span className={css.evidenceArchiveIcon} aria-hidden="true"><IconArchiveOutline20 size={18} /></span>
                  <div className={css.evidenceMain}>
                    <span className={css.evidenceArchiveName} title={archive.filename}>{archive.filename}</span>
                    <span>{formatBytes(archive.size)} · {categoryLabel(archive.category)}完整日志包</span>
                  </div>
                  <button type="button" className={css.archiveDownload} disabled={downloadingCategory !== undefined} onClick={() => { void download(archive.category) }}>
                    {downloadingCategory === archive.category ? '下载中…' : '下载'}
                  </button>
                </div>
              ))}
            </div>
          )}
          {downloadError !== undefined && <p className={css.errorText}>{downloadError}</p>}
          <div className={css.evidenceSearchRow}>
            <span className={css.evidenceSearchIcon} aria-hidden="true"><IconSearchOutline16 size={14} /></span>
            <input
              className={css.evidenceSearch}
              type="search"
              placeholder="搜索证据文件…"
              value={query}
              aria-label="搜索证据文件"
              onChange={(event) => { setQuery(event.currentTarget.value) }}
            />
            <button type="button" className={css.treeAction} onClick={expandAll}>展开</button>
            <button type="button" className={css.treeAction} onClick={collapseAll}>收起</button>
          </div>
          <div className={css.evidenceRows}>
            {effectiveTree === null && <p className={css.muted}>没有匹配「{query.trim()}」的文件。</p>}
            {effectiveTree !== null && (
              <EvidenceDirBranch
                node={effectiveTree}
                depth={0}
                collapsed={isFiltering ? new Set<string>() : collapsed}
                toggleDir={toggleDir}
                onPreviewFile={onPreviewFile}
                formatBytes={formatBytes}
                categoryLabel={categoryLabel}
              />
            )}
          </div>
        </>
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
            <span className={css.evidenceDirChevron} aria-hidden="true">
              {collapsed.has(dir.path) ? <IconChevronRightOutline14 size={12} /> : <IconChevronDownOutline14 size={12} />}
            </span>
            <span className={css.evidenceDirIcon} aria-hidden="true">
              {collapsed.has(dir.path) ? <IconFolderClose16 size={15} /> : <IconFolderOpen16 size={15} />}
            </span>
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
          <span className={css.evidenceFileIcon} aria-hidden="true"><IconCodeOutline16 size={14} /></span>
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
