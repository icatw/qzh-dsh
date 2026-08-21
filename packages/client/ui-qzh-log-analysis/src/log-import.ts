import { unzipSync } from 'fflate'
import { scanQzhLogLayout, type QzhLogFile } from './log-layout.ts'

/** A file discovered from a directory or ZIP archive. */
export interface ImportedLogEntry extends QzhLogFile {
  size: number
  source: 'file' | 'archive'
}

/** Maximum text read from one log file during the local preview. */
export const MAX_PREVIEW_BYTES = 2_000_000

/** Normalize browser-relative and archive paths for deterministic matching.
 * @param path - browser or archive relative path.
 * @returns normalized slash-separated path.
 */
export function normalizeImportPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '/')
}

/** List supported log entries from a ZIP payload without writing to disk.
 * @param bytes - ZIP archive bytes.
 * @returns supported entries found under the QZH log layout.
 */
export function listZipLogEntries(bytes: Uint8Array): ImportedLogEntry[] {
  const archive = unzipSync(bytes)
  return scanQzhLogLayout(Object.keys(archive)).map(file => ({
    ...file,
    size: archive[file.path]?.byteLength ?? 0,
    source: 'archive' as const,
  }))
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
