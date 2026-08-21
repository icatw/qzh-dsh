/** A discovered QZH log file grouped by its service and stream. */
export interface QzhLogFile {
  path: string
  component: 'web-agent' | 'log-center' | 'agent' | 'agent-flush' | 'unknown'
  stream: 'log' | 'error' | 'unknown'
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
              : 'unknown'
      const stream = /(?:^|[-_.])(error|err|stderr)(?:[-_.]|$)/.test(filename) ? 'error' : 'log'
      return { path, component, stream }
    })
    .sort((left, right) => left.path.localeCompare(right.path))
}
