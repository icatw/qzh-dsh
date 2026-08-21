import type { QzhEvidenceCluster } from '@deepseek-ai/dsh-api-remotes/client'
import css from './QzhLogAnalysisSection.module.css'

interface Props {
  readonly clusters: readonly QzhEvidenceCluster[]
}
/** Render every error cluster included in the reviewed payload. */
export function QzhClusterTable({ clusters }: Props) {
  return (
    <section className={css.evidenceSection} aria-labelledby="qzh-evidence-clusters">
      <div className={css.sectionHeading}>
        <h3 id="qzh-evidence-clusters">将发送的异常聚类</h3>
        <span>{clusters.length} 类</span>
      </div>
      <div className={css.evidenceRows}>
        {clusters.map(cluster => (
          <div className={css.clusterRow} key={cluster.key}>
            <div>
              <strong>{cluster.component} · {cluster.severity}</strong>
              <span>{cluster.key}</span>
              {cluster.sample !== undefined && <code>{cluster.sample}</code>}
            </div>
            <b>{cluster.count} 次</b>
          </div>
        ))}
      </div>
    </section>
  )
}
