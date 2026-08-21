import css from './QzhLogAnalysisSection.module.css'

interface Props {
  readonly customerLabel: string
  readonly productVersion: string
  readonly failureDescription: string
  readonly consent: boolean
  readonly onCustomerLabel: (value: string) => void
  readonly onProductVersion: (value: string) => void
  readonly onFailureDescription: (value: string) => void
  readonly onConsent: (value: boolean) => void
}
/** Collect optional context and the explicit outbound consent. */
export function QzhConsentPanel({
  customerLabel, productVersion, failureDescription, consent,
  onCustomerLabel, onProductVersion, onFailureDescription, onConsent,
}: Props) {
  return (
    <section className={css.consentCard} aria-labelledby="qzh-consent-heading">
      <div className={css.sectionHeading}>
        <div>
          <h2 id="qzh-consent-heading">确认后开始分析</h2>
          <p>只发送上方列出的摘要，提交后由 QZH Agent 读取只读源码镜像。</p>
        </div>
        <span className={css.stepLabel}>第 2 步</span>
      </div>
      <div className={css.formGrid}>
        <label>客户标识（可选）<input value={customerLabel} onChange={event => { onCustomerLabel(event.currentTarget.value) }} /></label>
        <label>QZH 版本（可选）<input value={productVersion} onChange={event => { onProductVersion(event.currentTarget.value) }} /></label>
        <label className={css.formWide}>现场现象（可选）<textarea value={failureDescription} onChange={event => { onFailureDescription(event.currentTarget.value) }} rows={3} /></label>
      </div>
      <label className={css.consentLabel}>
        <input type="checkbox" checked={consent} onChange={event => { onConsent(event.currentTarget.checked) }} />
        <span>我确认将以上文件清单、异常聚类和错误样例发送到公司内网 QZH 分析 Host；原始日志不会自动上传。</span>
      </label>
    </section>
  )
}
