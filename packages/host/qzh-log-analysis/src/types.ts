import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Stable identity of one QZH analysis case. */
export type QzhCaseId = Branded<'QzhCaseId'>

/** The service-side QZH checkout used by the first analysis slice. */
export type QzhRepository = 'server'

/** Lifecycle of one case in the first Host API slice. */
export type QzhCaseState = 'draft' | 'evidence-ready' | 'analyzing' | 'completed' | 'failed'

/** Case creation fields supplied by the browser. */
export interface QzhCreateCaseRequest {
  readonly customerLabel?: string
  readonly productVersion?: string
  readonly failureDescription?: string
}

/** One parsed log file summary retained with a case. */
export interface QzhEvidenceFile {
  readonly path: string
  readonly component: string
  readonly stream: string
  readonly size: number
}

/** One local error cluster retained with a case. */
export interface QzhEvidenceCluster {
  readonly key: string
  readonly component: string
  readonly severity: string
  readonly count: number
  readonly firstTimestamp?: number
  readonly lastTimestamp?: number
  readonly sample?: string
}

/** Browser-approved evidence summary. Raw logs are not implicitly accepted. */
export interface QzhEvidenceSummary {
  readonly consent: QzhEvidenceConsent
  readonly files: readonly QzhEvidenceFile[]
  readonly clusters: readonly QzhEvidenceCluster[]
  readonly excerpt?: string
}

/** Explicit destination acknowledgement attached to one evidence submission. */
export interface QzhEvidenceConsent {
  readonly approved: boolean
  readonly destination: 'internal-qzh-analysis'
}

/** Point-in-time case view returned by the Host API. */
export interface QzhCaseView {
  readonly id: QzhCaseId
  /** Session that owns this case and its analysis transcript. */
  readonly sessionId: SessionId
  readonly state: QzhCaseState
  readonly createdAt: number
  readonly updatedAt: number
  readonly customerLabel?: string
  readonly productVersion?: string
  readonly failureDescription?: string
  readonly evidence?: QzhEvidenceSummary
  /** Kept for wire compatibility; always equals sessionId in this release. */
  readonly analysisSessionId?: SessionId
  /** Final Chinese report extracted from the DSH assistant message. */
  readonly report?: string
  /** Stable failure detail when the DSH analysis turn cannot complete. */
  readonly analysisError?: string
}

/** Result returned when a QZH analysis turn is admitted to the DSH Agent Loop. */
export interface QzhAnalysisStartResult {
  readonly case: QzhCaseView
  readonly sessionId: SessionId
}

/** A bounded code match returned from the mirror. */
export interface QzhCodeMatch {
  readonly path: string
  readonly line: number
  readonly text: string
}

/** Search result with the exact mirror revision used. */
export interface QzhCodeSearchResult {
  readonly repository: QzhRepository
  readonly commit: string
  readonly query: string
  readonly matches: readonly QzhCodeMatch[]
}

/** Bounded source excerpt returned from a read-only mirror. */
export interface QzhCodeReadResult {
  readonly repository: QzhRepository
  readonly commit: string
  readonly path: string
  readonly startLine: number
  readonly endLine: number
  readonly text: string
}
