import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { clusterLogErrors, parseLogText } from '../src/log-parser.ts'
import { decodeZipLogMember, listZipLogEntries, logSample } from '../src/log-import.ts'
import { qzhComponentLabel, scanQzhLogLayout } from '../src/log-layout.ts'

describe('QZH log parser', () => {
  it('recognizes the server and endpoint layout and clusters repeated errors', () => {
    const [file] = scanQzhLogLayout(['data/logs/qzh_web_agent_error.log'])
    expect(file).toMatchObject({ component: 'web-agent', stream: 'error' })
    const events = parseLogText(file!, '[2026-08-21 10:00:00.123] ERROR request 123 failed\n[2026-08-21 10:01:00.123] ERROR request 456 failed', 'server')
    expect(events).toHaveLength(2)
    expect(events[0]?.timestamp).toBeDefined()
    expect(events[0]?.category).toBe('server')
    const clusters = clusterLogErrors(events)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toMatchObject({ severity: 'error', count: 2, category: 'server' })
  })

  it('discovers log members without requiring a fixed archive directory', () => {
    const bytes = zipSync({
      'runtime/server/qzh_agent.log': strToU8('2026-08-21 10:00:00 ERROR flush failed'),
      'data/config.yaml': strToU8('not a log'),
      'metadata/summary.txt': strToU8('generated summary'),
    })
    const entries = listZipLogEntries(bytes, 'terminal')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ path: 'runtime/server/qzh_agent.log', source: 'archive', component: 'agent', category: 'terminal' })
    expect(decodeZipLogMember(bytes, entries[0]!.path)).toContain('flush failed')
  })

  it('accepts common service log paths when a ZIP has no /data/logs prefix', () => {
    const bytes = zipSync({
      'services/web/qzh_web_agent.log': strToU8('2026-08-21 10:00:00 ERROR request failed'),
      'manifest.json': strToU8('{}'),
      'summary.txt': strToU8('not a log'),
    })
    const entries = listZipLogEntries(bytes, 'server')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ path: 'services/web/qzh_web_agent.log', source: 'archive', component: 'web-agent', category: 'server' })
    expect(parseLogText(entries[0]!, decodeZipLogMember(bytes, entries[0]!.path), 'server')).toHaveLength(1)
  })

  it('infers a component label for generic logs instead of displaying unknown', () => {
    expect(scanQzhLogLayout([
      'services/auth/logs.txt', 'services/qzh-web-system/logs.txt', 'summary.txt',
    ])).toMatchObject([
      { path: 'services/auth/logs.txt', component: 'auth' },
      { path: 'services/qzh-web-system/logs.txt', component: 'qzh-web-system' },
      { path: 'summary.txt', component: 'summary' },
    ])
    expect(qzhComponentLabel('services/auth/logs.txt')).toBe('auth')
  })

  it('maps QZH service names through the data rules with the longest fragment winning', () => {
    const files = scanQzhLogLayout([
      'runtime/qzh_agent_flush.log',
      'runtime/qzh_agent.log',
      'runtime/qzh_web_agent_error.log',
      'runtime/qzh_log_center.log',
    ])
    expect(files.find(file => file.path === 'runtime/qzh_agent.log')).toMatchObject({ component: 'agent', stream: 'log' })
    expect(files.find(file => file.path === 'runtime/qzh_agent_flush.log')).toMatchObject({ component: 'agent-flush', stream: 'log' })
    expect(files.find(file => file.path === 'runtime/qzh_log_center.log')).toMatchObject({ component: 'log-center', stream: 'log' })
    expect(files.find(file => file.path === 'runtime/qzh_web_agent_error.log')).toMatchObject({ component: 'web-agent', stream: 'error' })
  })

  it('classifies an error stream from content when the file name carries no signal', () => {
    expect(scanQzhLogLayout(['runtime/app-runtime.log'], {
      'runtime/app-runtime.log': 'ERROR boom\nCRITICAL crash\nEXCEPTION traceback\nINFO startup ok',
    })[0]).toMatchObject({ path: 'runtime/app-runtime.log', component: 'runtime', stream: 'error' })
    expect(scanQzhLogLayout(['runtime/app-runtime.log'], {
      'runtime/app-runtime.log': 'INFO startup ok\nDEBUG detail\nWARN slow\nINFO ready',
    })[0]).toMatchObject({ stream: 'log' })
  })

  it('keeps unknown nested archive layouts without dropping or mislabelling files', () => {
    expect(scanQzhLogLayout([
      'customer-abc/bundle/logs/app-runtime.log',
      'customer-abc/bundle/logs/db-worker.log',
      'customer-abc/bundle/logs/qzh_metrics.log',
    ])).toMatchObject([
      { path: 'customer-abc/bundle/logs/app-runtime.log', component: 'app-runtime' },
      { path: 'customer-abc/bundle/logs/db-worker.log', component: 'db-worker' },
      { path: 'customer-abc/bundle/logs/qzh_metrics.log', component: 'qzh_metrics' },
    ])
  })

  it('carries a bounded first-line sample on imported entries for layout judgment', () => {
    expect(logSample('2026-08-21 10:00:00 ERROR boom\n\n2026-08-21 10:01:00 WARN slow\nINFO ready')).toBe(
      '2026-08-21 10:00:00 ERROR boom\n2026-08-21 10:01:00 WARN slow\nINFO ready',
    )
    const bytes = zipSync({
      'runtime/server/qzh_agent.log': strToU8(
        '2026-08-21 10:00:00 ERROR flush failed\n'
        + '2026-08-21 10:00:01 ERROR flush failed\n'
        + '2026-08-21 10:00:02 ERROR flush failed\n'
        + '2026-08-21 10:00:03 ERROR flush failed\n'
        + '2026-08-21 10:00:04 ERROR flush failed\n'
        + '2026-08-21 10:00:05 WARN slow tail',
      ),
      'data/config.yaml': strToU8('not a log'),
    })
    const [entry] = listZipLogEntries(bytes, 'terminal')
    expect(entry?.sample).toContain('ERROR flush failed')
    expect(entry?.sample).not.toContain('WARN slow tail')
  })

  it('splits clusters by field side so the same error stays separate per category', () => {
    const [file] = scanQzhLogLayout(['logs/qzh_web_agent.log'])
    const serverEvents = parseLogText(file!, '2026-08-21 10:00:00 ERROR request failed', 'server')
    const terminalEvents = parseLogText(file!, '2026-08-21 10:00:00 ERROR request failed', 'terminal')
    const clusters = clusterLogErrors([...serverEvents, ...terminalEvents])
    expect(clusters).toHaveLength(2)
    expect(clusters.map(cluster => cluster.category).sort()).toEqual(['server', 'terminal'])
  })

  it('ignores column headers that mention a level word without a timestamp', () => {
    const [file] = scanQzhLogLayout(['summary.txt'])
    const header = 'service\tstatus\ttotal\tdebug\tinfo\twarn\terror\tfirst_time\tlast_time\trequest_id_hits'
    const events = parseLogText(file!, `${header}\n2026-08-21 10:00:00 ERROR boom`, 'server')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ severity: 'error', message: 'ERROR boom' })
    expect(clusterLogErrors(events)).toMatchObject([{ severity: 'error', count: 1 }])
  })

  it('keeps untimestamped lines whose level word starts the line', () => {
    const [file] = scanQzhLogLayout(['runtime/app-runtime.log'])
    const events = parseLogText(file!, 'ERROR boom\nWARN slow\nINFO ready', 'terminal')
    expect(events).toHaveLength(2)
    expect(events.map(event => event.severity)).toEqual(['error', 'warn'])
  })

  it('recognizes a level word anywhere when a timestamp anchors the line', () => {
    const [file] = scanQzhLogLayout(['runtime/app-runtime.log'])
    const events = parseLogText(file!, '2026-08-21 10:00:00 request ERROR boom', 'server')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ severity: 'error' })
  })
})
