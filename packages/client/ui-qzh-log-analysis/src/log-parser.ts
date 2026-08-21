import type { QzhLogCategory, QzhLogFile } from './log-layout.ts'

/** One timestamped line extracted from a QZH log. */
export interface ParsedLogEvent {
  path: string
  component: QzhLogFile['component']
  stream: QzhLogFile['stream']
  category: QzhLogCategory
  lineNumber: number
  timestamp: number | undefined
  severity: 'error' | 'warn' | 'info' | 'unknown'
  message: string
}

/** A deterministic error family assembled across services and streams. */
export interface LogErrorCluster {
  key: string
  component: QzhLogFile['component']
  category: QzhLogCategory
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

/** Level word at line start, tolerating a leading bracketed tag or prefix. */
const LEVEL_AT_START = /^(?:\[[^\]]*\]\s*)?(?:ERROR|CRITICAL|EXCEPTION|TRACEBACK|WARN|WARNING)\b/

function severityOf(line: string, hasTimestamp: boolean): ParsedLogEvent['severity'] {
  const upper = line.toUpperCase()
  // A timestamp anchors the level word anywhere in the line; without one the
  // level must start the line so column headers (e.g. summary.txt's
  // "service ... warn error ...") are not mistaken for real log events.
  if (/\b(ERROR|CRITICAL|EXCEPTION|TRACEBACK)\b/.test(upper) && (hasTimestamp || LEVEL_AT_START.test(upper))) return 'error'
  if (/\b(WARN|WARNING)\b/.test(upper) && (hasTimestamp || LEVEL_AT_START.test(upper))) return 'warn'
  if (/\b(INFO|DEBUG)\b/.test(upper)) return 'info'
  return 'unknown'
}

/** Parse one bounded text preview into timestamped error and warning events.
 * @param file - discovered file descriptor.
 * @param text - bounded UTF-8 preview.
 * @param category - field side the file was imported under.
 * @returns extracted error, warning, and error-stream events.
 */
export function parseLogText(file: QzhLogFile, text: string, category: QzhLogCategory): ParsedLogEvent[] {
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (line.trim() === '') return []
    const timestamp = parseLogTimestamp(line)
    const severity = severityOf(line, timestamp !== undefined)
    if (severity !== 'error' && severity !== 'warn' && file.stream !== 'error') return []
    return [{
      path: file.path,
      component: file.component,
      stream: file.stream,
      category,
      lineNumber: index + 1,
      timestamp,
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
    const key = `${event.category}:${event.component}:${event.severity}:${fingerprint(event.message)}`
    const existing = clusters.get(key)
    if (existing === undefined) {
      clusters.set(key, {
        key, component: event.component, category: event.category, severity: event.severity, count: 1,
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
