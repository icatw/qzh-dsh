// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { zipSync, strToU8 } from 'fflate'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId, SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { QzhCaseView, QzhEvidenceSummary } from '@deepseek-ai/dsh-api-remotes/client'
import { inject as qzhInject } from '../src/client/index.ts'
import { QzhLogAnalysisSection, buildSessionTitle } from '../src/client/QzhLogAnalysisSection.tsx'
import { QzhImportHero } from '../src/client/QzhImportHero.tsx'
import { QzhAnalysisStatus, QzhAnalysisStatusReport } from '../src/client/QzhAnalysisStatus.tsx'
import { QzhEvidenceFiles } from '../src/client/QzhEvidenceFiles.tsx'
import { QzhSessionHeaderAction } from '../src/client/QzhSessionHeaderAction.tsx'
import { createQzhSessionStore, type QzhSessionState } from '../src/client/store.ts'

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

const SESSION_ID = 'session-qzh' as SessionId

function props(overrides: Partial<Record<string, unknown>> = {}) {
  const handle = createQzhSessionStore()
  const instance = handle.create(SESSION_ID)
  const sessions = {
    current: SESSION_ID,
    ids: [SESSION_ID],
    byId: {
      [SESSION_ID]: {
        sessionId: SESSION_ID,
        displayTitle: 'QZH',
        updatedAt: 1,
        running: false,
        blank: true,
        agentPreset: 'qzh',
      },
    },
  } as unknown as SessionListState
  const useStore = ((select: (state: QzhSessionState) => unknown) => {
    const snapshot = useSyncExternalStore(instance.subscribe, instance.getSnapshot)
    return select(snapshot)
  }) as SnapshotSelectorHook<QzhSessionState>
  const caseView: QzhCaseView = { id: 'case' as QzhCaseView['id'], sessionId: SESSION_ID, state: 'draft', createdAt: 1, updatedAt: 1 }
  const base = {
    sessionId: SESSION_ID,
    useSessions: ((select: (state: SessionListState) => unknown) => select(sessions)) as SnapshotSelectorHook<SessionListState>,
    useWorkspaces: (() => undefined) as unknown as SnapshotSelectorHook<WorkspaceListState>,
    useSession: (() => undefined) as never,
    useInput: (() => undefined) as never,
    useProjection: (() => undefined) as never,
    inputActions: {} as never,
    useStore,
    actions: instance.actions,
    createCase: vi.fn(async () => caseView),
    setEvidence: vi.fn(async (_id: QzhCaseView['id'], _evidence: QzhEvidenceSummary) => ({ ...caseView, state: 'evidence-ready' as const })),
    uploadEvidenceArchive: vi.fn(async () => caseView),
    getCase: vi.fn(async () => caseView),
    startAnalysis: vi.fn(async () => ({ ...caseView, state: 'analyzing' as const })),
    setFeedback: vi.fn(async (_id: QzhCaseView['id'], kind: 'like' | 'dislike') => ({ ...caseView, state: 'completed' as const, feedback: kind })),
    ...overrides,
  }
  return { instance, props: base }
}

describe('QZH blank-session analysis surface', () => {
  it('declares the generated QZH Remote namespace so actions can reach the Host', () => {
    expect(qzhInject).toContain('remote.qzhLogAnalysis')
  })

  it('renders a compact import Hero instead of an input dock workbench', () => {
    const { props: input } = props()
    render(<QzhLogAnalysisSection {...input} />)
    expect(screen.getByRole('heading', { name: '从日志开始定位故障' })).toBeTruthy()
    expect(screen.getAllByLabelText('选择日志目录').length).toBe(2)
    expect(screen.queryByText('SESSION EVIDENCE')).toBeNull()
    expect(screen.queryByText('描述你想要构建的内容')).toBeNull()
  })

  it('shows the exact outbound sample and submits that same payload after consent', async () => {
    const { props: input } = props()
    const log = new File(['2026-08-21 10:20:30 ERROR qzh failure'], 'qzh_web_agent.log', { type: 'text/plain' })
    render(<QzhLogAnalysisSection {...input} />)
    fireEvent.change(screen.getAllByLabelText('选择日志目录')[0]!, { target: { files: [log] } })
    await waitFor(() => expect(screen.getByText('确认发送内容')).toBeTruthy())
    const consent = screen.getByRole('checkbox')
    fireEvent.click(consent)
    const submit = screen.getByRole('button', { name: '确认摘要并开始分析' })
    fireEvent.click(submit)
    await waitFor(() => expect(input.setEvidence).toHaveBeenCalled())
    const sent = (input.setEvidence as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as QzhEvidenceSummary
    expect(screen.getAllByText(/ERROR qzh failure/).length).toBeGreaterThan(0)
    expect(sent.excerpt).toContain('ERROR qzh failure')
    expect(input.startAnalysis).toHaveBeenCalledWith('case')
  })

  it('opens the native details column when an active QZH case is present', async () => {
    const { instance, props: input } = props()
    instance.actions.setImported([{
      path: '/data/logs/qzh_web_agent.log', component: 'web-agent', stream: 'log', size: 1, source: 'file', sample: '', category: 'server',
    }], [])
    instance.actions.setCaseView({
      id: 'case' as QzhCaseView['id'], sessionId: SESSION_ID, state: 'analyzing', createdAt: 1, updatedAt: 1,
    })
    const openDetails = vi.fn()
    render(<QzhSessionHeaderAction {...input} openDetails={openDetails} />)
    await waitFor(() => expect(openDetails).toHaveBeenCalled())
  })

  it('renders the completed analysis report as markdown, not source text', () => {
    const report = [
      '# 根因分析',
      '',
      '**结论**：配置缺失。',
      '',
      '- 第一点',
      '- 第二点',
      '',
      '```bash',
      'echo hi',
      '```',
    ].join('\n')
    render(<QzhAnalysisStatus
      caseView={{
        id: 'case' as QzhCaseView['id'], sessionId: SESSION_ID, state: 'completed', createdAt: 1, updatedAt: 1, report,
      }}
      running={false}
      onStart={vi.fn()}
      onGenerateReport={vi.fn()}
      onFeedback={vi.fn()}
    />)
    // A heading, inline emphasis, a list, and a fenced code block render as
    // elements — the report is no longer a raw <pre> of the source text.
    expect(screen.getByRole('heading', { level: 1, name: '根因分析' })).toBeTruthy()
    expect(screen.getByText('结论', { selector: 'strong' })).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    // CodeBlock tokenizes the body into shiki spans; the <pre> textContent is
    // the stable verbatim surface.
    expect(document.querySelector('.md-code-block pre')?.textContent).toContain('echo hi')
    // The report region grows with the content: the details column owns the
    // scrollport, so the card must not carry an inline height cap.
    const reportCard = document.querySelector('[class*="report"]')
    expect(reportCard).not.toBeNull()
    expect(reportCard?.getAttribute('style')).toBeNull()
  })

  it('renders a limited completion distinctly and still offers feedback', () => {
    render(<QzhAnalysisStatus
      caseView={{
        id: 'case' as QzhCaseView['id'], sessionId: SESSION_ID, state: 'completed_with_limitations', createdAt: 1, updatedAt: 1,
        report: '# 结论\n部分结论。',
        analysisError: '报告缺少必要结构（结论✓ 事实证据✗ 代码定位✗），已按受限完成保留。',
      }}
      running={false}
      onStart={vi.fn()}
      onGenerateReport={vi.fn()}
      onFeedback={vi.fn()}
    />)
    expect(screen.getByText('受限完成')).toBeTruthy()
    expect(screen.getAllByText(/已按受限完成保留/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('报告缺少部分必要结构，已按受限完成保留；结论仍可参考。')).toBeTruthy()
    expect(screen.getByText('这次分析有用吗？')).toBeTruthy()
  })

  it('renders case metadata (version / submit time / short id) and a report copy action', () => {
    render(<QzhAnalysisStatus
      caseView={{
        id: 'qzh-case-abcdef12' as QzhCaseView['id'], sessionId: SESSION_ID, state: 'completed',
        createdAt: 1_720_000_000_000, updatedAt: 1, productVersion: 'release/v3.10.3',
        report: '# 结论\n完整报告。',
      }}
      running={false}
      onStart={vi.fn()}
      onGenerateReport={vi.fn()}
      onFeedback={vi.fn()}
    />)
    // Metadata line: configured version, formatted submit time, compact id.
    expect(screen.getByText('版本 release/v3.10.3')).toBeTruthy()
    expect(screen.getByText('#qzh-case')).toBeTruthy()
    expect(screen.getByText(/提交 \d{2}\/\d{2}/)).toBeTruthy()
    // The full id and the exact timestamp stay reachable via title attributes.
    expect(screen.getByText('#qzh-case').getAttribute('title')).toBe('qzh-case-abcdef12')
    // The completed report exposes a copy action and a .md export.
    expect(screen.getByRole('button', { name: '复制报告' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '下载报告 (.md)' })).toBeTruthy()
  })

  it('offers generate-report while analyzing and continue after completion', () => {
    const { rerender } = render(<QzhAnalysisStatus
      caseView={{
        id: 'case' as QzhCaseView['id'], sessionId: SESSION_ID, state: 'analyzing', createdAt: 1, updatedAt: 1,
      }}
      running={false}
      onStart={vi.fn()}
      onGenerateReport={vi.fn()}
      onFeedback={vi.fn()}
    />)
    // Analyzing: the primary action asks for the final report.
    expect(screen.getByRole('button', { name: '生成报告' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '继续分析' })).toBeNull()
    rerender(<QzhAnalysisStatus
      caseView={{
        id: 'case' as QzhCaseView['id'], sessionId: SESSION_ID, state: 'completed', createdAt: 1, updatedAt: 1,
        report: '# 结论\n完成。',
      }}
      running={false}
      onStart={vi.fn()}
      onGenerateReport={vi.fn()}
      onFeedback={vi.fn()}
    />)
    // Completed: the user may continue the investigation (re-analyze).
    expect(screen.getByRole('button', { name: '继续分析' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '生成报告' })).toBeNull()
  })

  it('guides a draft case to resubmit instead of offering a start button', () => {
    render(<QzhAnalysisStatus
      caseView={{
        id: 'case' as QzhCaseView['id'], sessionId: SESSION_ID, state: 'draft', createdAt: 1, updatedAt: 1,
      }}
      running={false}
      onStart={vi.fn()}
      onGenerateReport={vi.fn()}
      onFeedback={vi.fn()}
    />)
    // A draft case (created without a submitted summary) cannot start
    // analysis; the card asks the user to import and confirm instead.
    expect(screen.getByText('等待提交日志')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '启动当前会话分析' })).toBeNull()
  })

  it('turns report file mentions into clickable preview openers', () => {
    const onPreviewFile = vi.fn()
    render(<QzhAnalysisStatus
      caseView={{
        id: 'case' as QzhCaseView['id'], sessionId: SESSION_ID, state: 'completed', createdAt: 1, updatedAt: 1,
        report: '根因见 `server/logs/a.log:123` 与 `terminal/agent.log`。',
      }}
      running={false}
      onStart={vi.fn()}
      onGenerateReport={vi.fn()}
      onFeedback={vi.fn()}
      evidencePaths={['server/logs/a.log', 'terminal/agent.log']}
      onPreviewFile={onPreviewFile}
    />)
    // A `:line`-suffixed mention resolves to the file and opens the preview.
    const withLine = screen.getByTitle('server/logs/a.log')
    fireEvent.click(withLine)
    expect(onPreviewFile).toHaveBeenCalledWith('server/logs/a.log')
    // A bare mention resolves too; an unknown token stays inert code.
    fireEvent.click(screen.getByTitle('terminal/agent.log'))
    expect(onPreviewFile).toHaveBeenLastCalledWith('terminal/agent.log')
  })

  it('reads source code from a report code mention', async () => {
    const onReadCode = vi.fn(async () => ({
      repository: 'server' as const, commit: 'abc1234', path: 'packages/auth/service.go', startLine: 10, endLine: 19, text: 'func main() {}\n',
    }))
    render(<QzhAnalysisStatusReport
      caseView={{
        id: 'case' as QzhCaseView['id'], sessionId: SESSION_ID, state: 'completed', createdAt: 1, updatedAt: 1,
        report: '根因在 `packages/auth/service.go:10`。',
      }}
      onFeedback={vi.fn()}
      evidencePaths={['server/logs/a.log']}
      onPreviewFile={vi.fn()}
      onReadCode={onReadCode}
    />)
    // A source-file token (path + line) resolves to a code preview opener.
    fireEvent.click(screen.getByTitle('packages/auth/service.go'))
    expect(onReadCode).toHaveBeenCalledWith('case', 'packages/auth/service.go', 10, 19)
    // The preview card renders the read excerpt with repository + short commit.
    await waitFor(() => expect(screen.getByText(/server@abc1234 packages\/auth\/service\.go:10/)).toBeTruthy())
  })
})

describe('QZH full-log archive upload', () => {
  function caseView(state: QzhCaseView['state'] = 'evidence-ready'): QzhCaseView {
    return { id: 'case' as QzhCaseView['id'], sessionId: SESSION_ID, state, createdAt: 1, updatedAt: 1 }
  }

  it('uploads the original zip after the summary is accepted, without blocking analysis', async () => {
    const upload = vi.fn(async () => caseView())
    const { props: input } = props({ uploadEvidenceArchive: upload })
    const zipBytes = zipSync({ 'server/logs/a.log': strToU8('INFO start\nERROR boom') })
    const zip = new File([Buffer.from(zipBytes)], 'logs.zip', { type: 'application/zip' })
    render(<QzhLogAnalysisSection {...input} />)
    fireEvent.change(screen.getAllByLabelText('选择日志目录')[0]!, { target: { files: [zip] } })
    await waitFor(() => expect(screen.getByText('确认发送内容')).toBeTruthy())
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '确认摘要并开始分析' }))
    await waitFor(() => expect(input.setEvidence).toHaveBeenCalled())
    await waitFor(() => expect(upload).toHaveBeenCalled())
    const [, payload] = upload.mock.calls[0] as [unknown, { filename: string; contentBase64: string }]
    expect(payload.filename).toBe('logs.zip')
    expect(payload.contentBase64).toBe(Buffer.from(zipBytes).toString('base64'))
    await waitFor(() => expect(input.startAnalysis).toHaveBeenCalled())
  })

  it('packs a directory import into a durable full archive', async () => {
    const upload = vi.fn(async () => caseView())
    const { props: input } = props({ uploadEvidenceArchive: upload })
    const log = new File(['2026-08-21 10:00:00 INFO start\n'], 'terminal/agent.log', { type: 'text/plain' })
    render(<QzhLogAnalysisSection {...input} />)
    fireEvent.change(screen.getAllByLabelText('选择日志目录')[1]!, { target: { files: [log] } })
    await waitFor(() => expect(screen.getByText('确认发送内容')).toBeTruthy())
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '确认摘要并开始分析' }))
    await waitFor(() => expect(input.setEvidence).toHaveBeenCalled())
    await waitFor(() => expect(upload).toHaveBeenCalled())
    const [, payload] = upload.mock.calls[0] as [unknown, { filename: string; contentBase64: string }]
    // The extracted directory is re-packed so the Agent gets full-log access.
    expect(payload.filename).toBe('terminal-logs.zip')
    expect(payload.contentBase64.length).toBeGreaterThan(0)
    await waitFor(() => expect(input.startAnalysis).toHaveBeenCalled())
  })

  it('starts analysis even when the archive upload fails', async () => {
    const upload = vi.fn(async () => { throw new Error('upload failed') })
    const { props: input } = props({ uploadEvidenceArchive: upload })
    const zipBytes = zipSync({ 'a.log': strToU8('x') })
    const zip = new File([Buffer.from(zipBytes)], 'logs.zip', { type: 'application/zip' })
    render(<QzhLogAnalysisSection {...input} />)
    fireEvent.change(screen.getAllByLabelText('选择日志目录')[0]!, { target: { files: [zip] } })
    await waitFor(() => expect(screen.getByText('确认发送内容')).toBeTruthy())
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '确认摘要并开始分析' }))
    await waitFor(() => expect(input.startAnalysis).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText(/完整日志包上传失败/)).toBeTruthy())
  })
})

describe('QzhEvidenceFiles', () => {
  const baseProps = { archives: [] as readonly never[], caseId: 'case' as QzhCaseView['id'], onDownloadArchive: vi.fn(), onPreviewFile: vi.fn() }
  it('renders a collapsible file list with size, category, and sample', () => {
    render(<QzhEvidenceFiles
      files={[{
        path: 'server/logs/app.log', size: 2048, lineCount: 42, component: 'web-agent', stream: 'log', category: 'server', sample: '2026-08-21 INFO start',
      }, {
        path: 'server/worker/w.out', size: 128, component: 'worker', stream: 'log', category: 'server',
      }]}
      clusters={[]}
      summaryOnly={false}
      {...baseProps}
    />)
    // Collapsed by default: the toggle names the count, the rows are hidden.
    expect(screen.getByText('证据文件（2）')).toBeTruthy()
    expect(screen.queryByText('server/logs/app.log')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /证据文件（2）/ }))
    // Nested directory tree: `server` expands to `logs`, then the basename.
    expect(screen.getByText('server')).toBeTruthy()
    expect(screen.getByText('logs')).toBeTruthy()
    expect(screen.getByText('app.log')).toBeTruthy()
    expect(screen.getByText(/2\.0 KB · 42 行 · 服务端/)).toBeTruthy()
    expect(screen.getByText('2026-08-21 INFO start')).toBeTruthy()
    expect(screen.getByText('worker')).toBeTruthy()
    expect(screen.getByText('w.out')).toBeTruthy()
    expect(screen.queryByText('证据摘要（2）')).toBeNull()
  })

  it('labels summary-only listings distinctly and renders nothing when empty', () => {
    const { rerender } = render(<QzhEvidenceFiles files={[]} clusters={[]} summaryOnly {...baseProps} />)
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<QzhEvidenceFiles
      files={[{ path: 'a.log', size: 5, component: 'x', stream: 'log', category: 'server' }]}
      clusters={[]}
      summaryOnly
      {...baseProps}
    />)
    expect(screen.getByText('证据摘要（1）')).toBeTruthy()
  })

  it('filters the evidence tree by a search query and collapses all on demand', () => {
    render(<QzhEvidenceFiles
      files={[
        { path: 'server/logs/app.log', size: 5, component: 'x', stream: 'log', category: 'server' },
        { path: 'server/worker/w.out', size: 5, component: 'x', stream: 'log', category: 'server' },
      ]}
      clusters={[]}
      summaryOnly={false}
      archives={[]}
      caseId={'case' as QzhCaseView['id']}
      onDownloadArchive={vi.fn()}
      onPreviewFile={vi.fn()}
    />)
    fireEvent.click(screen.getByRole('button', { name: /证据文件（2）/ }))
    // Search narrows the tree to matching files (ancestors forced open).
    fireEvent.change(screen.getByLabelText('搜索证据文件'), { target: { value: 'app' } })
    expect(screen.getByText('app.log')).toBeTruthy()
    expect(screen.queryByText('w.out')).toBeNull()
    // Clearing the search restores the full tree; collapse-all folds folders.
    fireEvent.change(screen.getByLabelText('搜索证据文件'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '全部收起' }))
    expect(screen.queryByText('app.log')).toBeNull()
    expect(screen.queryByText('w.out')).toBeNull()
  })

  it('requests a preview when a file row is clicked', () => {
    const onPreviewFile = vi.fn()
    render(<QzhEvidenceFiles
      files={[{ path: 'logs/app.log', size: 5, component: 'x', stream: 'log', category: 'server' }]}
      clusters={[]}
      summaryOnly={false}
      archives={[]}
      caseId={'case' as QzhCaseView['id']}
      onDownloadArchive={vi.fn()}
      onPreviewFile={onPreviewFile}
    />)
    fireEvent.click(screen.getByRole('button', { name: /证据文件（1）/ }))
    // Directory groups default to expanded; click the file row (basename).
    fireEvent.click(screen.getByRole('button', { name: /app\.log/ }))
    // file.path is forwarded verbatim (already carries the category prefix).
    expect(onPreviewFile).toHaveBeenCalledWith('logs/app.log')
  })
})

describe('QzhImportHero', () => {
  it('lists selected files per side with sizes and a large-file hint', () => {
    render(<QzhImportHero
      entries={[
        { path: 'server/logs/a.log', size: 2048, source: 'file', sample: '', category: 'server', component: 'web-agent', stream: 'log' },
        { path: 'server/logs/big.out', size: 3 * 1024 * 1024, source: 'file', sample: '', category: 'server', component: 'worker', stream: 'log' },
        { path: 'terminal/agent.log', size: 128, source: 'file', sample: '', category: 'terminal', component: 'agent', stream: 'log' },
      ]}
      clusters={[]}
      onFiles={vi.fn()}
      status=""
    />)
    // Groups fold by default (only the count line), then expand on click.
    expect(screen.getByText(/服务端 2 个文件/)).toBeTruthy()
    expect(screen.getByText(/终端 1 个文件/)).toBeTruthy()
    expect(screen.queryByText('server/logs/a.log')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /服务端 2 个文件/ }))
    expect(screen.getByText('server/logs/a.log')).toBeTruthy()
    expect(screen.getByText('server/logs/big.out')).toBeTruthy()
    expect(screen.getByText(/2\.0 KB/)).toBeTruthy()
    // A file beyond the local preview bound flags the truncation.
    expect(screen.getByText(/大文件，本地预览截断/)).toBeTruthy()
  })
})

describe('QZH session title', () => {
  it('composes a readable title from customer, version, and the first failure line', () => {
    expect(buildSessionTitle({
      customerLabel: '客户A', productVersion: 'release/v3.10.3', failureDescription: 'DELETE 请求 500\n更多细节',
    })).toBe('客户A · release/v3.10.3 · DELETE 请求 500')
  })

  it('falls back to partial facts and truncates a long failure line', () => {
    expect(buildSessionTitle({ customerLabel: '', productVersion: '', failureDescription: '终端 agent 认证失败，服务端 SQL 慢查询超时' }))
      .toBe('终端 agent 认证失败，服务端 …')
    expect(buildSessionTitle({})).toBe('QZH 日志分析')
  })
})
