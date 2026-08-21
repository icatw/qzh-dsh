/** A discovered QZH log file grouped by its service and stream. */
export interface QzhLogFile {
  path: string
  component: 'web-agent' | 'log-center' | 'agent' | 'agent-flush' | 'unknown'
  stream: 'log' | 'error' | 'unknown'
}

/** Recognize supported files under the imported `/data/logs` layout.
 * @param paths - imported browser or archive paths.
 * @returns sorted QZH log file descriptors.
 */
export function scanQzhLogLayout(paths: readonly string[]): QzhLogFile[] {
  return paths
    .map(path => path.replaceAll('\\', '/').replace(/^\.\//, ''))
    .filter(path => path.startsWith('data/logs/') || path.startsWith('/data/logs/') || path.includes('/data/logs/'))
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
              : 'unknown'
      const stream = filename.includes('error') ? 'error' : filename.includes('log') ? 'log' : 'unknown'
      return { path, component, stream }
    })
    .sort((left, right) => left.path.localeCompare(right.path))
}
