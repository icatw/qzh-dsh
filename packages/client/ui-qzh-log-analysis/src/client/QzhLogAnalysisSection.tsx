import { useState, type DragEvent } from 'react'
import type {
  QzhCaseView, QzhCreateCaseRequest, QzhEvidenceSummary,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { clusterLogErrors, parseLogText, type LogErrorCluster } from '../log-parser.ts'
import { decodeZipLogMember, listZipLogEntries, normalizeImportPath, type ImportedLogEntry, MAX_PREVIEW_BYTES } from '../log-import.ts'
import { scanQzhLogLayout } from '../log-layout.ts'
import css from './QzhLogAnalysisSection.module.css'

type QzhLogAnalysisSectionProps = PropsRuntime<'settings.section'>

interface QzhLogAnalysisInjected {
  createCase: (request: QzhCreateCaseRequest) => Promise<QzhCaseView>
  setEvidence: (id: QzhCaseView['id'], evidence: QzhEvidenceSummary) => Promise<QzhCaseView>
  startAnalysis: (id: QzhCaseView['id']) => Promise<QzhCaseView>
}

type QzhLogAnalysisProps = QzhLogAnalysisSectionProps & Partial<QzhLogAnalysisInjected>

const MAX_FILES = 30

function fileEntry(file: File): ImportedLogEntry | undefined {
  if (!/\.(log|txt|out)$/i.test(file.name)) return undefined
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath
  const rawPath = normalizeImportPath(relativePath || file.name)
  const candidate = rawPath.includes('/data/logs/') || rawPath.startsWith('data/logs/') || rawPath.startsWith('/data/logs/')
    ? rawPath
    : `data/logs/${file.name}`
  const [layout] = scanQzhLogLayout([candidate])
  return layout === undefined ? undefined : { ...layout, size: file.size, source: 'file' }
}

function displayTime(value: number | undefined): string {
  return value === undefined ? '无时间戳' : new Date(value).toLocaleString('zh-CN', { hour12: false })
}

/** Render the first QZH workbench surface and local evidence preview. @param props - settings section props. */
export function QzhLogAnalysisSection({ close, createCase, setEvidence, startAnalysis }: QzhLogAnalysisProps) {
  const [entries, setEntries] = useState<ImportedLogEntry[]>([])
  const [clusters, setClusters] = useState<LogErrorCluster[]>([])
  const [status, setStatus] = useState('等待导入日志。文件只在浏览器本地读取。')
  const [dragging, setDragging] = useState(false)
  const [caseView, setCaseView] = useState<QzhCaseView | undefined>(undefined)
  const [customerLabel, setCustomerLabel] = useState('')
  const [productVersion, setProductVersion] = useState('')
  const [failureDescription, setFailureDescription] = useState('')
  const [consent, setConsent] = useState(false)
  const [analysisRunning, setAnalysisRunning] = useState(false)

  const onFiles = async (files: FileList | null): Promise<void> => {
    if (files === null || files.length === 0) return
    setStatus('正在本地提取日志摘要…')
    try {
      const nextEntries: ImportedLogEntry[] = []
      const events = []
      for (const file of [...files].slice(0, MAX_FILES)) {
        if (file.name.toLowerCase().endsWith('.zip')) {
          const bytes = new Uint8Array(await file.arrayBuffer())
          const archiveEntries = listZipLogEntries(bytes)
          nextEntries.push(...archiveEntries)
          for (const entry of archiveEntries) {
            if (entry.component !== 'unknown') events.push(...parseLogText(entry, decodeZipLogMember(bytes, entry.path)))
          }
          continue
        }
        const entry = fileEntry(file)
        if (entry === undefined) continue
        nextEntries.push(entry)
        events.push(...parseLogText(entry, await file.slice(0, MAX_PREVIEW_BYTES).text()))
      }
      const nextClusters = clusterLogErrors(events)
      setEntries(nextEntries.sort((left, right) => left.path.localeCompare(right.path)))
      setClusters(nextClusters)
      setStatus(`已读取 ${String(nextEntries.length)} 个日志文件，聚类出 ${String(nextClusters.length)} 类异常；尚未向服务端或 LLM 发送数据。`)
    } catch (error) {
      setStatus(`导入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragging(false)
    void onFiles(event.dataTransfer.files)
  }

  const submitEvidence = async (): Promise<void> => {
    if (createCase === undefined || setEvidence === undefined) {
      setStatus('当前 Host 未配置 QZH 案例 API；日志仍只保留在浏览器本地。')
      return
    }
    if (entries.length === 0 || !consent) return
    setStatus('正在向内网 Host 提交已确认的日志摘要…')
    try {
      const created = await createCase({
        ...(customerLabel.trim() === '' ? {} : { customerLabel: customerLabel.trim() }),
        ...(productVersion.trim() === '' ? {} : { productVersion: productVersion.trim() }),
        failureDescription: failureDescription.trim() || '由 QZH Web 工作台提交的日志证据',
      })
      const evidence: QzhEvidenceSummary = {
        consent: { approved: true, destination: 'internal-qzh-analysis' },
        files: entries.map(entry => ({ path: entry.path, component: entry.component, stream: entry.stream, size: entry.size })),
        clusters: clusters.map(cluster => ({
          key: cluster.key,
          component: cluster.component,
          severity: cluster.severity,
          count: cluster.count,
          ...(cluster.firstTimestamp === undefined ? {} : { firstTimestamp: cluster.firstTimestamp }),
          ...(cluster.lastTimestamp === undefined ? {} : { lastTimestamp: cluster.lastTimestamp }),
          ...(cluster.samples[0] === undefined ? {} : { sample: cluster.samples[0] }),
        })),
        excerpt: clusters.flatMap(cluster => cluster.samples).slice(0, 24).join('\n'),
      }
      const saved = await setEvidence(created.id, evidence)
      setCaseView(saved)
      setStatus(`案例 ${String(saved.id)} 已提交；原始日志未自动外发。`)
    } catch (error) {
      setStatus(`案例提交失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const runAnalysis = async (): Promise<void> => {
    if (caseView === undefined || startAnalysis === undefined) {
      setStatus('当前 Host 未配置 DSH 分析能力；请确认 Host 已加载 QZH 插件。')
      return
    }
    setAnalysisRunning(true)
    setStatus('正在启动 DSH Agent 分析；Agent 会按需读取只读 QZH mirror。')
    try {
      const started = await startAnalysis(caseView.id)
      setCaseView(started)
      setStatus(`分析已启动，会话 ${String(started.analysisSessionId ?? '未知')} 正在运行；可返回会话查看报告。`)
    } catch (error) {
      setStatus(`启动分析失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setAnalysisRunning(false)
    }
  }

  return (
    <main className={css.root}>
      <div className={css.header}>
        <div>
          <p className={css.eyebrow}>QZH INCIDENT WORKBENCH</p>
          <h1>日志分析</h1>
          <p className={css.subtitle}>从日志证据开始，逐步定位服务端与终端链路中的根因。</p>
        </div>
        <button className={css.secondaryButton} type="button" onClick={close}>返回会话</button>
      </div>

      <section className={css.heroCard} aria-labelledby="qzh-workbench-start">
        <div>
          <p className={css.cardKicker}>STEP 01 · COLLECT EVIDENCE</p>
          <h2 id="qzh-workbench-start">导入一次故障现场</h2>
          <p>支持服务端和终端的 .log、.txt、.out 文件及 ZIP 压缩包。浏览器先完成本地解析；只有你确认后，才把文件清单、异常聚类和短样例交给内网 Host。</p>
        </div>
        <label className={css.uploadButton}>
          选择日志目录
          <input type="file" multiple accept=".log,.txt,.out" {...({ webkitdirectory: '' } as Record<string, string>)} onChange={event => { void onFiles(event.currentTarget.files) }} />
        </label>
        <label className={css.uploadButton}>
          选择 ZIP 压缩包
          <input type="file" multiple accept=".zip" onChange={event => { void onFiles(event.currentTarget.files) }} />
        </label>
      </section>

      <div
        className={`${css.dropZone} ${dragging ? css.dropZoneActive : ''}`}
        onDragEnter={event => { event.preventDefault(); setDragging(true) }}
        onDragOver={event => { event.preventDefault() }}
        onDragLeave={event => { event.preventDefault(); setDragging(false) }}
        onDrop={onDrop}
      >
        {dragging ? '松开鼠标以导入日志' : '也可以将日志文件拖到这里；当前只读取浏览器选中的内容'}
      </div>

      <div className={css.status} aria-live="polite">{status}</div>

      <section className={css.consentCard} aria-labelledby="qzh-outbound-review">
        <div className={css.tableHeader}>
          <h2 id="qzh-outbound-review">外发前确认</h2>
          <span>仅发送你确认的摘要</span>
        </div>
        <div className={css.formGrid}>
          <label>客户标识（可选）<input value={customerLabel} onChange={event => { setCustomerLabel(event.currentTarget.value) }} placeholder="例如：客户 A" /></label>
          <label>QZH 版本（可选）<input value={productVersion} onChange={event => { setProductVersion(event.currentTarget.value) }} placeholder="例如：3.9.17" /></label>
          <label className={css.formWide}>故障描述（可选）<textarea value={failureDescription} onChange={event => { setFailureDescription(event.currentTarget.value) }} placeholder="描述现场看到的现象，避免粘贴完整日志。" rows={2} /></label>
        </div>
        <label className={css.consentLabel}>
          <input type="checkbox" checked={consent} onChange={event => { setConsent(event.currentTarget.checked) }} />
          我确认将当前页面展示的文件清单、异常聚类和短样例发送到公司内网 QZH 分析 Host；原始日志不会自动上传。
        </label>
      </section>

      <div className={css.submitRow}>
        <button className={css.submitButton} type="button" disabled={entries.length === 0 || !consent || caseView !== undefined} onClick={() => { void submitEvidence() }}>
          {caseView === undefined ? '提交已确认摘要到内网 Host' : '案例已提交'}
        </button>
        <span className={css.status}>未勾选确认前不会发起 Host 请求。</span>
      </div>

      {caseView !== undefined && <section className={css.consentCard} aria-labelledby="qzh-analysis-start">
        <div className={css.tableHeader}>
          <h2 id="qzh-analysis-start">DSH Agent 分析</h2>
          <span>{caseView.state === 'completed' ? '报告已生成' : caseView.state === 'analyzing' ? '分析中' : '等待启动'}</span>
        </div>
        <p className={css.status}>分析会复用 DSH Agent Loop、工具调用、会话记录和已配置的 DeepSeek/OpenAI-compatible Provider。QZH Agent 只能读取固定 mirror，不能编辑代码或执行 Shell。</p>
        <div className={css.submitRow}>
          <button className={css.submitButton} type="button" disabled={analysisRunning || caseView.state === 'analyzing' || caseView.state === 'completed'} onClick={() => { void runAnalysis() }}>
            {caseView.state === 'completed' ? '报告已生成' : caseView.state === 'analyzing' || analysisRunning ? '分析运行中…' : '启动 DSH Agent 分析'}
          </button>
          {caseView.analysisSessionId !== undefined && <span className={css.status}>会话：{caseView.analysisSessionId}</span>}
        </div>
        {caseView.report !== undefined && <pre className={css.report}>{caseView.report}</pre>}
        {caseView.analysisError !== undefined && <p className={css.status}>分析失败：{caseView.analysisError}</p>}
      </section>}

      <section className={css.grid} aria-label="日志摘要">
        <article className={css.metricCard}><span>已识别日志</span><strong>{entries.length}</strong><small>按 /data/logs 布局</small></article>
        <article className={css.metricCard}><span>异常聚类</span><strong>{clusters.length}</strong><small>时间与文本指纹</small></article>
        <article className={css.metricCard}><span>分析状态</span><strong className={css.pending}>{caseView === undefined ? '待提交' : '摘要已提交'}</strong><small>{caseView === undefined ? '用户确认后外发' : '等待服务端分析'}</small></article>
      </section>

      <section className={css.tableCard} aria-labelledby="qzh-log-files">
        <div className={css.tableHeader}><h2 id="qzh-log-files">日志文件</h2><span>最多预览 30 个文件</span></div>
        {entries.length === 0
          ? <div className={css.empty}>导入日志后，这里会展示文件大小、行数和初步异常数量。</div>
          : <div className={css.rows}>{entries.slice(0, 30).map((item, index) => <div className={css.row} key={`${item.source}:${item.path}:${String(index)}`}><span>{item.component} · {item.path}</span><span>{item.size} B · {item.source === 'archive' ? 'ZIP' : '文件'}</span></div>)}</div>}
      </section>

      {clusters.length > 0 && <section className={css.tableCard} aria-labelledby="qzh-log-clusters">
        <div className={css.tableHeader}><h2 id="qzh-log-clusters">异常聚类</h2><span>最多展示前 8 类</span></div>
        <div className={css.rows}>{clusters.slice(0, 8).map(cluster => <div className={css.row} key={cluster.key}><span>{cluster.component} · {cluster.severity} · {cluster.count} 次<br />{cluster.samples[0]}</span><span>{displayTime(cluster.firstTimestamp)}<br />至 {displayTime(cluster.lastTimestamp)}</span></div>)}</div>
      </section>}

      <p className={css.guardrail}>只读边界：当前页面没有代码编辑、Shell、仓库下载或 LLM 调用能力。</p>
    </main>
  )
}
