import type { QzhEvidenceSummary } from '@deepseek-ai/dsh-api-remotes/client'
import { QzhEvidenceTable } from './QzhEvidenceTable.tsx'
import css from './QzhLogAnalysisSection.module.css'

interface Props {
  readonly evidence: QzhEvidenceSummary
}
/** Preview the file manifest and layout excerpt covered by consent. */
export function QzhEvidencePreview({ evidence }: Props) {
  return (
    <section className={css.reviewCard} aria-labelledby="qzh-evidence-review">
      <div className={css.reviewHeader}>
        <div>
          <h2 id="qzh-evidence-review">确认发送内容</h2>
          <p>以下文件清单与首行样例将发送给内网 Host；完整日志包会一并上传，由 Agent 自行扫描分析。</p>
        </div>
        <span className={css.reviewBadge}>待发送</span>
      </div>
      <QzhEvidenceTable files={evidence.files} />
      {evidence.excerpt !== undefined && (
        <section className={css.evidenceSection} aria-labelledby="qzh-evidence-excerpt">
          <div className={css.sectionHeading}>
            <h3 id="qzh-evidence-excerpt">首行布局样例</h3>
            <span>{`${evidence.excerpt.split('\n').length} 条`}</span>
          </div>
          <pre className={css.excerpt}>{evidence.excerpt}</pre>
        </section>
      )}
    </section>
  )
}
