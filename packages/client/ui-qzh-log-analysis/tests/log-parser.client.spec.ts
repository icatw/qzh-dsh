import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { clusterLogErrors, parseLogText } from '../src/log-parser.ts'
import { decodeZipLogMember, listZipLogEntries } from '../src/log-import.ts'
import { qzhComponentLabel, scanQzhLogLayout } from '../src/log-layout.ts'

describe('QZH log parser', () => {
  it('recognizes the server and endpoint layout and clusters repeated errors', () => {
    const [file] = scanQzhLogLayout(['data/logs/qzh_web_agent_error.log'])
    expect(file).toMatchObject({ component: 'web-agent', stream: 'error' })
    const events = parseLogText(file!, '[2026-08-21 10:00:00.123] ERROR request 123 failed\n[2026-08-21 10:01:00.123] ERROR request 456 failed')
    expect(events).toHaveLength(2)
    expect(events[0]?.timestamp).toBeDefined()
    const clusters = clusterLogErrors(events)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toMatchObject({ severity: 'error', count: 2 })
  })

  it('discovers log members without requiring a fixed archive directory', () => {
    const bytes = zipSync({
      'runtime/server/qzh_agent.log': strToU8('2026-08-21 10:00:00 ERROR flush failed'),
      'data/config.yaml': strToU8('not a log'),
      'metadata/summary.txt': strToU8('generated summary'),
    })
    const entries = listZipLogEntries(bytes)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ path: 'runtime/server/qzh_agent.log', source: 'archive', component: 'agent' })
    expect(decodeZipLogMember(bytes, entries[0]!.path)).toContain('flush failed')
  })

  it('accepts common service log paths when a ZIP has no /data/logs prefix', () => {
    const bytes = zipSync({
      'services/web/qzh_web_agent.log': strToU8('2026-08-21 10:00:00 ERROR request failed'),
      'manifest.json': strToU8('{}'),
      'summary.txt': strToU8('not a log'),
    })
    const entries = listZipLogEntries(bytes)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ path: 'services/web/qzh_web_agent.log', source: 'archive', component: 'web-agent' })
    expect(parseLogText(entries[0]!, decodeZipLogMember(bytes, entries[0]!.path))).toHaveLength(1)
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
})
