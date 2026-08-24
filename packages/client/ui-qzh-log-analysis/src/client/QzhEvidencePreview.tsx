import type { QzhEvidenceSummary } from '@deepseek-ai/dsh-api-remotes/client'
import { QzhEvidenceTable } from './QzhEvidenceTable.tsx'
import type { QzhUploadPreview } from './store.ts'
import css from './QzhLogAnalysisSection.module.css'

interface Props {
  readonly evidence: QzhEvidenceSummary
  readonly uploads?: readonly QzhUploadPreview[]
  /** Whether this summary has already been submitted to the analysis Host. */
  readonly submitted?: boolean
}
/** Preview the file manifest and layout excerpt covered by consent. */
export function QzhEvidencePreview({ evidence, uploads = [], submitted = false }: Props) {
  return (
    <section className={css.reviewCard} aria-labelledby="qzh-evidence-review">
      <div className={css.reviewHeader}>
        <div>
          <h2 id="qzh-evidence-review">{submitted ? '已发送内容' : '确认发送内容'}</h2>
          <p>{submitted
            ? '以下是已提交给内网 Host 的文件清单、首行样例和完整日志包；由 Agent 自行扫描分析。'
            : '以下文件清单、首行样例和列出的完整日志包会发送给内网 Host，由 Agent 自行扫描分析。'}</p>
        </div>
        <span className={css.reviewBadge} data-submitted={submitted}>{submitted ? '已提交' : '待发送'}</span>
      </div>
      <QzhEvidenceTable files={evidence.files} />
      {uploads.length > 0 && (
        <section className={css.evidenceSection} aria-labelledby="qzh-upload-preview">
          <div className={css.sectionHeading}>
            <h3 id="qzh-upload-preview">完整日志包</h3>
            <span>确认后上传</span>
          </div>
          <ul className={css.uploadPreviewList}>
            {uploads.map(upload => (
              <li key={`${upload.category}:${upload.filename}`}>
                <code title={upload.filename}>{upload.filename}</code>
                <span>{upload.category === 'server' ? '服务端' : '终端'} · {formatBytes(upload.size)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
