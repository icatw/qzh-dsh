import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { decodeZipLogMember, isEncryptedZip, listZipLogEntries, logSample } from '../src/log-import.ts'
import { qzhComponentLabel, scanQzhLogLayout } from '../src/log-layout.ts'

describe('QZH log parser', () => {
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

})

describe('QZH zip encryption detection', () => {
  it('flags AES (method 99) and encrypted archives, passing plain zips', () => {
    // AES: compression method 99 in the local file header.
    const aes = new Uint8Array(34)
    const view = new DataView(aes.buffer)
    view.setUint32(0, 0x04034b50, true) // local file header signature
    view.setUint16(8, 99, true)          // compression method = AES
    aes.set([1, 2, 3, 4], 30)            // member name
    expect(isEncryptedZip(aes)).toBe(true)

    // Traditional encryption: flag bit 0 set on a stored member.
    const classic = new Uint8Array(34)
    const classicView = new DataView(classic.buffer)
    classicView.setUint32(0, 0x04034b50, true)
    classicView.setUint16(6, 0x1, true)  // encryption flag
    classicView.setUint16(8, 0, true)    // stored
    classic.set([1, 2, 3, 4], 30)
    expect(isEncryptedZip(classic)).toBe(true)

    // A plain deflate zip is not encrypted.
    expect(isEncryptedZip(zipSync({ 'a.log': strToU8('INFO ok') }))).toBe(false)
  })
})
