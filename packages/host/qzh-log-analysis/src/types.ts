import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Stable identity of one QZH analysis case. */
export type QzhCaseId = Branded<'QzhCaseId'>

/** The service-side QZH checkout used by the first analysis slice. */
export type QzhRepository = 'server'

/** Which field side a log bundle came from. */
export type QzhLogCategory = 'server' | 'terminal'

/** A user verdict on one completed analysis. */
export type QzhFeedbackKind = 'like' | 'dislike'

/** Lifecycle of one case in the first Host API slice. */
export type QzhCaseState = 'draft' | 'evidence-ready' | 'analyzing' | 'completed' | 'completed_with_limitations' | 'failed'

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
  readonly category: QzhLogCategory
  readonly size: number
  /** Bounded first-line layout sample submitted with the evidence. */
  readonly sample?: string
}

/** One local error cluster retained with a case. */
export interface QzhEvidenceCluster {
  readonly key: string
  readonly component: string
  readonly category: QzhLogCategory
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
  /** User verdict on the completed report. */
  readonly feedback?: QzhFeedbackKind
  /** Optional free-text note attached to the feedback. */
  readonly feedbackComment?: string
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

/** Browser upload of the original log bundle for durable per-case storage. */
export interface QzhArchiveUpload {
  /** Original archive file name (audit only; never used in a filesystem path). */
  readonly filename: string
  /** The archive bytes, base64-encoded by the browser (zip). */
  readonly contentBase64: string
}

/** One extracted log file in the case evidence tree. */
export interface QzhEvidenceTreeFile {
  /** Real relative path inside the evidence bundle. */
  readonly path: string
  readonly size: number
  /** Line count, present only when the file was small enough to count cheaply. */
  readonly lineCount?: number
  readonly component: string
  readonly stream: string
  readonly category: QzhLogCategory
  /** Bounded first-line layout sample (redacted). */
  readonly sample?: string
}

/** One bounded evidence search hit. */
export interface QzhLogMatch {
  readonly path: string
  readonly line: number
  /** Redacted, bounded excerpt around the hit. */
  readonly excerpt: string
}

/** Evidence tree + clusters served by the list tool. */
export interface QzhLogListResult {
  readonly root?: string
  readonly files: readonly QzhEvidenceTreeFile[]
  readonly totalFiles: number
  readonly totalBytes: number
  readonly truncated: boolean
  readonly clusters: readonly QzhEvidenceCluster[]
  /** True when only the submitted summary backs the listing (no full archive). */
  readonly summaryOnly?: boolean
}

/** Bounded evidence search result. */
export interface QzhLogSearchResult {
  readonly query: string
  readonly matches: readonly QzhLogMatch[]
  readonly truncated: boolean
}

/** Bounded line-range read from an extracted evidence file. */
export interface QzhLogReadResult {
  readonly path: string
  readonly startLine: number
  readonly endLine: number
  readonly totalLines: number
  /** Redacted text of the requested line range. */
  readonly text: string
}
