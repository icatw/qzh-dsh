import type { QzhEvidenceSummary } from '@deepseek-ai/dsh-api-remotes/client'
import type { ImportedLogEntry } from '../log-import.ts'
import type { LogErrorCluster } from '../log-parser.ts'

/** The maximum amount of evidence the review card renders and submits. */
export const QZH_VISIBLE_CLUSTER_LIMIT = 8
export const QZH_VISIBLE_SAMPLE_LIMIT = 24

/** Build the exact reviewed payload sent by the consent action. */
export function buildQzhEvidence(
  entries: readonly ImportedLogEntry[],
  clusters: readonly LogErrorCluster[],
): QzhEvidenceSummary {
  const visibleClusters = clusters.slice(0, QZH_VISIBLE_CLUSTER_LIMIT)
  const samples = visibleClusters.flatMap(cluster => cluster.samples).slice(0, QZH_VISIBLE_SAMPLE_LIMIT)
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
    clusters: visibleClusters.map(cluster => ({
      key: cluster.key,
      component: cluster.component,
      category: cluster.category,
      severity: cluster.severity,
      count: cluster.count,
      ...(cluster.firstTimestamp === undefined ? {} : { firstTimestamp: cluster.firstTimestamp }),
      ...(cluster.lastTimestamp === undefined ? {} : { lastTimestamp: cluster.lastTimestamp }),
      ...(cluster.samples[0] === undefined ? {} : { sample: cluster.samples[0] }),
    })),
    ...(samples.length === 0 ? {} : { excerpt: samples.join('\n') }),
  }
}
