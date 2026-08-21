import { unzipSync } from 'fflate/browser'
import { scanQzhLogLayout, type QzhLogCategory, type QzhLogFile } from './log-layout.ts'

/** A file discovered from a directory or ZIP archive. */
export interface ImportedLogEntry extends QzhLogFile {
  size: number
  source: 'file' | 'archive'
  /** Bounded first-line sample the browser read locally; lets the Agent judge the real layout. */
  sample: string
  /** Field side the file was imported under. */
  category: QzhLogCategory
}

/** Maximum text read from one log file during the local preview. */
export const MAX_PREVIEW_BYTES = 2_000_000
const LOG_MEMBER_SAMPLE_BYTES = 64 * 1024
const LOG_SIGNAL = /(?:\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}|\b(?:ERROR|WARN(?:ING)?|INFO|DEBUG|TRACEBACK|EXCEPTION)\b)/i

/** Maximum characters retained in one file's layout sample. */
export const LOG_SAMPLE_MAX_CHARS = 1_024
/** Maximum leading non-empty lines retained in one file's layout sample. */
export const LOG_SAMPLE_MAX_LINES = 4

/** Take the first few non-empty lines as a compact layout sample.
 * @param text - bounded log preview text.
 * @returns the leading non-empty lines, capped in lines and characters.
 */
export function logSample(text: string): string {
  const lines: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue
    lines.push(line)
    if (lines.length >= LOG_SAMPLE_MAX_LINES) break
  }
  return lines.join('\n').slice(0, LOG_SAMPLE_MAX_CHARS)
}

/** Normalize browser-relative and archive paths for deterministic matching.
 * @param path - browser or archive relative path.
 * @returns normalized slash-separated path.
 */
export function normalizeImportPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '/')
}

/** List supported log entries from a ZIP payload without writing to disk.
 * @param bytes - ZIP archive bytes.
 * @param category - field side the archive was imported under.
 * @returns log-like entries discovered from archive extensions and content.
 */
export function listZipLogEntries(bytes: Uint8Array, category: QzhLogCategory): ImportedLogEntry[] {
  const archive = unzipSync(bytes)
  const paths = Object.keys(archive).filter(path => isLikelyLogMember(path, archive[path]))
  const samples: Record<string, string> = {}
  for (const path of paths) {
    const member = archive[path]
    if (member === undefined) continue
    const sample = new TextDecoder().decode(member.subarray(0, LOG_MEMBER_SAMPLE_BYTES))
    samples[path] = logSample(sample)
  }
  const files = scanQzhLogLayout(paths, samples)
  return files.map(file => ({
    ...file,
    size: archive[file.path]?.byteLength ?? 0,
    source: 'archive' as const,
    sample: samples[file.path] ?? '',
    category,
  }))
}

/** Keep text-like log members while ignoring generic ZIP metadata files. */
function isLikelyLogMember(path: string, bytes: Uint8Array | undefined): boolean {
  if (bytes === undefined || path.endsWith('/')) return false
  const extension = /\.([^.\/]+)$/.exec(path)?.[1]?.toLowerCase()
  if (extension === 'log' || extension === 'out') return true
  if (extension !== 'txt') return false
  const sample = new TextDecoder().decode(bytes.subarray(0, LOG_MEMBER_SAMPLE_BYTES))
  return !sample.includes('\0') && LOG_SIGNAL.test(sample)
}

/** Read one ZIP member as UTF-8, bounded for safe UI preview.
 * @param bytes - ZIP archive bytes.
 * @param path - archive member path.
 * @returns bounded UTF-8 preview, or an empty string for a missing member.
 */
export function decodeZipLogMember(bytes: Uint8Array, path: string): string {
  const member = unzipSync(bytes)[path]
  return member === undefined ? '' : new TextDecoder().decode(member.subarray(0, MAX_PREVIEW_BYTES))
}
