/** A discovered QZH log file grouped by its service and stream. */
export interface QzhLogFile {
  path: string
  /** Canonical QZH component when known, otherwise an inferred archive label. */
  component: string
  stream: 'log' | 'error' | 'unknown'
}

/** Which field side a log bundle came from. */
export type QzhLogCategory = 'server' | 'terminal'

/** One data-driven rule mapping a QZH service filename fragment to a component. */
export interface QzhComponentRule {
  /** Lowercased filename fragment that identifies the service. */
  fragment: string
  /** Canonical component label the fragment maps to. */
  component: string
}

/**
 * QZH service-name rules as data. Adding a new service is a row here, not a
 * scan-logic change, so field archives with new components keep their labels
 * without touching the scanner. The longest matching fragment wins, so a
 * `qzh_agent_flush` file never collapses into the shorter `qzh_agent` rule.
 */
export const QZH_COMPONENT_RULES: readonly QzhComponentRule[] = [
  { fragment: 'qzh_web_agent', component: 'web-agent' },
  { fragment: 'qzh_log_center', component: 'log-center' },
  { fragment: 'qzh_agent_flush', component: 'agent-flush' },
  { fragment: 'qzh_agent', component: 'agent' },
]

const GENERIC_DIRECTORY_NAMES = new Set(['data', 'log', 'logs', 'var', 'tmp', 'services'])

/** Infer a human-readable component label from an arbitrary imported path. */
export function qzhComponentLabel(path: string): string {
  const segments = path.split('/').filter(Boolean)
  const parent = segments.at(-2)
  if (parent !== undefined && !GENERIC_DIRECTORY_NAMES.has(parent.toLowerCase())) return parent
  const filename = segments.at(-1) ?? path
  const stem = filename.replace(/\.[^.]+$/, '')
  return stem === '' ? 'log' : stem
}

/** Error-stream signal from a file name (`*-error.log`, `stderr.txt`, …). */
const ERROR_FILENAME = /(?:^|[-_.])(error|err|stderr)(?:[-_.]|$)/i

/** Error markers that make a sample read like an error log. */
const ERROR_CONTENT_MARKERS = /\b(?:ERROR|CRITICAL|EXCEPTION|TRACEBACK)\b/i

/** Match a known QZH service rule against a lowercased filename; longest fragment wins. */
function knownComponent(filename: string): string | undefined {
  const lower = filename.toLowerCase()
  let best: QzhComponentRule | undefined
  for (const rule of QZH_COMPONENT_RULES) {
    if (lower.includes(rule.fragment) && (best === undefined || rule.fragment.length > best.fragment.length)) {
      best = rule
    }
  }
  return best?.component
}

/**
 * Whether a content sample reads like an error log: a majority of its first
 * non-empty lines carry error markers. Only consulted when the filename gives
 * no error signal, so an ordinary log with occasional ERROR lines is not
 * reclassified as an error stream.
 * @param sample - bounded log preview text.
 * @param lineCount - how many leading non-empty lines are judged.
 * @returns true when error markers dominate the judged lines.
 */
export function looksLikeErrorStream(sample: string, lineCount = 8): boolean {
  const scanned = sample.split(/\r?\n/).filter(line => line.trim() !== '').slice(0, lineCount)
  if (scanned.length === 0) return false
  const errorLines = scanned.filter(line => ERROR_CONTENT_MARKERS.test(line)).length
  return errorLines / scanned.length >= 0.5
}

/** Describe supported log-like files from any imported relative layout.
 * @param paths - imported browser or archive paths.
 * @param samples - optional bounded content per normalized path; when present,
 * a file whose name gives no error signal but whose sample reads like an error
 * log is classified as an `error` stream.
 * @returns sorted QZH log file descriptors.
 */
export function scanQzhLogLayout(paths: readonly string[], samples?: Readonly<Record<string, string>>): QzhLogFile[] {
  return paths
    .map(path => path.replaceAll('\\', '/').replace(/^\.\//, ''))
    .filter(path => !path.endsWith('/') && /\.(log|out|txt)$/i.test(path))
    .map((path): QzhLogFile => {
      const filename = path.slice(path.lastIndexOf('/') + 1)
      const sample = samples?.[path]
      const stream = ERROR_FILENAME.test(filename)
        ? 'error'
        : sample !== undefined && looksLikeErrorStream(sample)
          ? 'error'
          : 'log'
      return { path, component: knownComponent(filename) ?? qzhComponentLabel(path), stream }
    })
    .sort((left, right) => left.path.localeCompare(right.path))
}
