/** A discovered QZH log file grouped by its service and stream. */
export interface QzhLogFile {
  path: string
  /** Canonical QZH component when known, otherwise an inferred archive label. */
  component: string
  stream: 'log' | 'error' | 'unknown'
}

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

/** Describe supported log-like files from any imported relative layout.
 * @param paths - imported browser or archive paths.
 * @returns sorted QZH log file descriptors.
 */
export function scanQzhLogLayout(paths: readonly string[]): QzhLogFile[] {
  return paths
    .map(path => path.replaceAll('\\', '/').replace(/^\.\//, ''))
    .filter(path => !path.endsWith('/') && /\.(log|out|txt)$/i.test(path))
    .map((path): QzhLogFile => {
      const filename = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
      const component = filename.includes('qzh_web_agent')
        ? 'web-agent'
        : filename.includes('qzh_log_center')
          ? 'log-center'
          : filename.includes('qzh_agent_flush')
            ? 'agent-flush'
            : filename.includes('qzh_agent')
              ? 'agent'
              : qzhComponentLabel(path)
      const stream = /(?:^|[-_.])(error|err|stderr)(?:[-_.]|$)/.test(filename) ? 'error' : 'log'
      return { path, component, stream }
    })
    .sort((left, right) => left.path.localeCompare(right.path))
}
