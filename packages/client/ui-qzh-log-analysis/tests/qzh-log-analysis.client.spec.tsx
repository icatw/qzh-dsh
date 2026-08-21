// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId, SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { QzhCaseView, QzhEvidenceSummary } from '@deepseek-ai/dsh-api-remotes/client'
import { inject as qzhInject } from '../src/client/index.ts'
import { QzhLogAnalysisSection } from '../src/client/QzhLogAnalysisSection.tsx'
import { QzhAnalysisStatus } from '../src/client/QzhAnalysisStatus.tsx'
import { QzhSessionHeaderAction } from '../src/client/QzhSessionHeaderAction.tsx'
import { createQzhSessionStore, type QzhSessionState } from '../src/client/store.ts'

afterEach(cleanup)

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
    await waitFor(() => expect(screen.getByText('确认分析摘要')).toBeTruthy())
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
})
