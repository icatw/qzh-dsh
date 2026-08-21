import type { QzhEvidenceFile } from '@deepseek-ai/dsh-api-remotes/client'
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
            <span className={css.path}>{file.path}</span>
            <span>{file.component} · {file.stream} · {file.size} B</span>
          </div>
        ))}
      </div>
    </section>
  )
}
