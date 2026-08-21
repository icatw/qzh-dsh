import type { QzhEvidenceFile } from '@deepseek-ai/dsh-api-remotes/client'
import { qzhComponentLabel } from '../log-layout.ts'
import css from './QzhLogAnalysisSection.module.css'

interface Props {
  readonly files: readonly QzhEvidenceFile[]
}
/** Render the complete file list included in the reviewed payload. */
export function QzhEvidenceTable({ files }: Props) {
  return (
    <section className={css.evidenceSection} aria-labelledby="qzh-evidence-files">
      <div className={css.sectionHeading}>
        <h3 id="qzh-evidence-files">将发送的日志文件</h3>
        <span>{files.length} 个文件</span>
      </div>
      <div className={css.evidenceRows}>
        {files.map(file => (
          <div className={css.evidenceRow} key={file.path}>
            <div className={css.evidenceMain}>
              <span>{file.path}</span>
              {file.sample !== undefined && file.sample !== '' && (
                <code className={css.evidenceSample} title={file.sample}>{file.sample}</code>
              )}
            </div>
            <span>
              <span className={css.categoryBadge}>{file.category === 'terminal' ? '终端' : '服务端'}</span>{' '}
              {file.component === 'unknown' ? qzhComponentLabel(file.path) : file.component} · {file.stream} · {file.size} B
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
