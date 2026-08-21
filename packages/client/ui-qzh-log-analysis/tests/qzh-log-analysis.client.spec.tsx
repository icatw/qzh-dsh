// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QzhLogAnalysisSection } from '../src/client/QzhLogAnalysisSection.tsx'

afterEach(cleanup)

describe('QZH log analysis workbench', () => {
  it('shows the local-only evidence preview and read-only guardrail', () => {
    render(<QzhLogAnalysisSection close={() => {}} />)
    expect(screen.getByRole('heading', { name: '日志分析' })).toBeTruthy()
    expect(screen.getByText('只读边界：当前页面没有代码编辑、Shell、仓库下载或 LLM 调用能力。')).toBeTruthy()
    expect(screen.getByLabelText('选择日志目录')).toBeTruthy()
  })

  it('summarizes supported files locally and skips unsupported files', async () => {
    render(<QzhLogAnalysisSection close={() => {}} />)
    const input = screen.getByLabelText('选择日志目录')
    const log = new File(['2026-08-21T10:00:00Z ERROR request failed\nINFO recovered'], 'qzh_web_agent.log', { type: 'text/plain' })
    const note = new File(['not a log'], 'notes.json', { type: 'application/json' })

    fireEvent.change(input, { target: { files: [log, note] } })

    await waitFor(() => {
      expect(screen.getByText('已读取 1 个日志文件，聚类出 1 类异常；尚未向服务端或 LLM 发送数据。')).toBeTruthy()
    })
    expect(screen.getByText(/web-agent · data\/logs\/qzh_web_agent\.log/)).toBeTruthy()
    expect(screen.getByText(/B · 文件/)).toBeTruthy()
    expect(screen.getByText(/request failed/)).toBeTruthy()
  })

  it('does not call Host until the outbound consent is checked', async () => {
    const createCase = vi.fn().mockResolvedValue({ id: 'qzh-case-test', state: 'draft', createdAt: 1, updatedAt: 1 })
    const setEvidence = vi.fn().mockResolvedValue({ id: 'qzh-case-test', state: 'evidence-ready', createdAt: 1, updatedAt: 2 })
    render(<QzhLogAnalysisSection close={() => {}} createCase={createCase} setEvidence={setEvidence} />)
    const input = screen.getByLabelText('选择日志目录')
    fireEvent.change(input, { target: { files: [new File(['2026-08-21T10:00:00Z ERROR request failed'], 'qzh_web_agent.log')] } })
    await waitFor(() => expect(screen.getByRole('button', { name: '提交已确认摘要到内网 Host' })).toBeTruthy())
    const submit = screen.getByRole('button', { name: '提交已确认摘要到内网 Host' })
    expect(submit).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(submit).toHaveProperty('disabled', false)
    fireEvent.click(submit)
    await waitFor(() => expect(createCase).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(setEvidence).toHaveBeenCalledTimes(1))
    expect(setEvidence.mock.calls[0]?.[1]).toMatchObject({ files: [{ path: 'data/logs/qzh_web_agent.log' }] })
  })
})
