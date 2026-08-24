import type { QzhEvidenceSummary } from '@deepseek-ai/dsh-api-remotes/client'
import type { ImportedLogEntry } from '../log-import.ts'

/** The maximum amount of evidence the review card renders and submits. */
export const QZH_VISIBLE_SAMPLE_LIMIT = 24

/** Build the exact reviewed payload sent by the consent action: the file
 *  manifest plus a bounded layout excerpt. Error clustering is the Agent's
 *  job (via qzh_search_logs), not the browser's. */
export function buildQzhEvidence(entries: readonly ImportedLogEntry[]): QzhEvidenceSummary {
  const samples = entries.flatMap(entry => entry.sample === '' ? [] : [entry.sample]).slice(0, QZH_VISIBLE_SAMPLE_LIMIT)
  return {
    consent: { approved: true, destination: 'internal-qzh-analysis' },
    files: entries.map(entry => ({
      path: entry.path,
      component: entry.component,
      stream: entry.stream,
      size: entry.size,
      category: entry.category,
      ...(entry.sample === '' ? {} : { sample: entry.sample }),
    })),
    ...(samples.length === 0 ? {} : { excerpt: samples.join('\n') }),
  }
}
