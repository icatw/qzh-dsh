import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { clusterLogErrors, parseLogText } from '../src/log-parser.ts'
import { decodeZipLogMember, listZipLogEntries } from '../src/log-import.ts'
import { scanQzhLogLayout } from '../src/log-layout.ts'

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

  it('reads only supported /data/logs members from a ZIP', () => {
    const bytes = zipSync({
      'data/logs/qzh_agent.log': strToU8('2026-08-21 10:00:00 ERROR flush failed'),
      'data/config.yaml': strToU8('not a log'),
    })
    const entries = listZipLogEntries(bytes)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ path: 'data/logs/qzh_agent.log', source: 'archive', component: 'agent' })
    expect(decodeZipLogMember(bytes, entries[0]!.path)).toContain('flush failed')
  })
})
