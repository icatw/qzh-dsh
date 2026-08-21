import type { QzhEvidenceSummary } from '@deepseek-ai/dsh-api-remotes/client'
import { QzhClusterTable } from './QzhClusterTable.tsx'
import { QzhEvidenceTable } from './QzhEvidenceTable.tsx'
import css from './QzhLogAnalysisSection.module.css'

interface Props {
  readonly evidence: QzhEvidenceSummary
}
/** Preview the exact file, cluster, and excerpt payload covered by consent. */
export function QzhEvidencePreview({ evidence }: Props) {
  return (
    <section className={css.reviewCard} aria-labelledby="qzh-evidence-review">
      <div className={css.reviewHeader}>
        <div>
          <h2 id="qzh-evidence-review">确认分析摘要</h2>
          <p>下面展示的内容会原样提交给内网 Host；完整日志不会上传。</p>
        </div>
        <span className={css.reviewBadge}>仅摘要</span>
      </div>
      <QzhEvidenceTable files={evidence.files} />
      <QzhClusterTable clusters={evidence.clusters} />
      <section className={css.evidenceSection} aria-labelledby="qzh-evidence-excerpt">
        <div className={css.sectionHeading}>
          <h3 id="qzh-evidence-excerpt">将发送的错误样例</h3>
          <span>{evidence.excerpt === undefined ? '无样例' : `${evidence.excerpt.split('\n').length} 条`}</span>
        </div>
        {evidence.excerpt === undefined
          ? <p className={css.muted}>没有解析出可外发的错误样例。</p>
          : <pre className={css.excerpt}>{evidence.excerpt}</pre>}
      </section>
    </section>
  )
}
