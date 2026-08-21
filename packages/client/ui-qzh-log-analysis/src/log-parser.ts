import type { QzhLogFile } from './log-layout.ts'

/** One timestamped line extracted from a QZH log. */
export interface ParsedLogEvent {
  path: string
  component: QzhLogFile['component']
  stream: QzhLogFile['stream']
  lineNumber: number
  timestamp: number | undefined
  severity: 'error' | 'warn' | 'info' | 'unknown'
  message: string
}

/** A deterministic error family assembled across services and streams. */
export interface LogErrorCluster {
  key: string
  component: QzhLogFile['component']
  severity: 'error' | 'warn' | 'unknown'
  count: number
  firstTimestamp: number | undefined
  lastTimestamp: number | undefined
  samples: string[]
}

const TIMESTAMP = /(?:^|\[)(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:[.,]\d{3})?)/

/** Parse common ISO and Python logging timestamps without assuming a timezone.
 * @param line - one log line.
 * @returns epoch milliseconds when a supported timestamp is present.
 */
export function parseLogTimestamp(line: string): number | undefined {
  const match = TIMESTAMP.exec(line)
  if (match === null) return undefined
  const parsed = Date.parse(`${match[1]!}T${match[2]!.replace(',', '.')}`)
  return Number.isNaN(parsed) ? undefined : parsed
}

function severityOf(line: string): ParsedLogEvent['severity'] {
  const upper = line.toUpperCase()
  if (/\b(ERROR|CRITICAL|EXCEPTION|TRACEBACK)\b/.test(upper)) return 'error'
  if (/\b(WARN|WARNING)\b/.test(upper)) return 'warn'
  if (/\b(INFO|DEBUG)\b/.test(upper)) return 'info'
  return 'unknown'
}

/** Parse one bounded text preview into timestamped error and warning events.
 * @param file - discovered file descriptor.
 * @param text - bounded UTF-8 preview.
 * @returns extracted error, warning, and error-stream events.
 */
export function parseLogText(file: QzhLogFile, text: string): ParsedLogEvent[] {
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (line.trim() === '') return []
    const severity = severityOf(line)
    if (severity !== 'error' && severity !== 'warn' && file.stream !== 'error') return []
    return [{
      path: file.path,
      component: file.component,
      stream: file.stream,
      lineNumber: index + 1,
      timestamp: parseLogTimestamp(line),
      severity,
      message: line.replace(TIMESTAMP, '').replace(/^\s*[-|:]\s*/, '').trim(),
    }]
  })
}

function fingerprint(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<id>')
    .replace(/\b\d+(?:\.\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

/** Cluster warnings and errors across files, retaining short local samples.
 * @param events - parsed log events.
 * @returns deterministic error clusters ordered by descending count.
 */
export function clusterLogErrors(events: readonly ParsedLogEvent[]): LogErrorCluster[] {
  const clusters = new Map<string, LogErrorCluster>()
  for (const event of events) {
    if (event.severity !== 'error' && event.severity !== 'warn' && event.severity !== 'unknown') continue
    const key = `${event.component}:${event.severity}:${fingerprint(event.message)}`
    const existing = clusters.get(key)
    if (existing === undefined) {
      clusters.set(key, {
        key, component: event.component, severity: event.severity, count: 1,
        firstTimestamp: event.timestamp, lastTimestamp: event.timestamp,
        samples: [event.message.slice(0, 240)],
      })
      continue
    }
    existing.count += 1
    if (event.timestamp !== undefined) {
      existing.firstTimestamp = existing.firstTimestamp === undefined ? event.timestamp : Math.min(existing.firstTimestamp, event.timestamp)
      existing.lastTimestamp = existing.lastTimestamp === undefined ? event.timestamp : Math.max(existing.lastTimestamp, event.timestamp)
    }
    if (existing.samples.length < 3 && !existing.samples.includes(event.message)) existing.samples.push(event.message.slice(0, 240))
  }
  return [...clusters.values()].sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
}
