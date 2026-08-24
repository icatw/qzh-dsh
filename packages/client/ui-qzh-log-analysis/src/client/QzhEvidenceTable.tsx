import { useState } from 'react'
import type { QzhEvidenceFile } from '@deepseek-ai/dsh-api-remotes/client'
import { qzhComponentLabel } from '../log-layout.ts'
import css from './QzhLogAnalysisSection.module.css'

interface Props {
  readonly files: readonly QzhEvidenceFile[]
}
/** Render the file list included in the reviewed payload, folded by default
 *  so a large bundle does not stretch the confirmation page. */
export function QzhEvidenceTable({ files }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <section className={css.evidenceSection} aria-labelledby="qzh-evidence-files">
      <div className={css.sectionHeading}>
        <h3 id="qzh-evidence-files">将发送的日志文件</h3>
        <button type="button" className={css.evidenceToggle} onClick={() => { setOpen(current => !current) }} aria-expanded={open}>
          <span>{files.length} 个文件</span>
          <span className={css.evidenceToggleAction}>{open ? '收起' : '展开'}</span>
        </button>
      </div>
      {open && (
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
      )}
    </section>
  )
}
