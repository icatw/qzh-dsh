import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { QzhCaseView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ImportedLogEntry } from '../log-import.ts'
import type { QzhLogCategory } from '../log-layout.ts'

/** Display-only metadata for a full archive that will be uploaded after consent. */
export interface QzhUploadPreview {
  readonly category: QzhLogCategory
  readonly filename: string
  readonly size: number
}

/** JSON-safe state shared by the QZH details panel and the session header action. */
export interface QzhSessionState {
  entries: ImportedLogEntry[]
  status: string
  consent: boolean
  customerLabel: string
  productVersion: string
  failureDescription: string
  uploads: QzhUploadPreview[]
  caseView?: QzhCaseView
  panelOpen: boolean
}

type QzhSessionActions = {
  setImported: (draft: QzhSessionState, entries: readonly ImportedLogEntry[], resetCase?: boolean) => void
  setUploads: (draft: QzhSessionState, uploads: readonly QzhUploadPreview[]) => void
  setStatus: (draft: QzhSessionState, status: string) => void
  setConsent: (draft: QzhSessionState, consent: boolean) => void
  setCustomerLabel: (draft: QzhSessionState, value: string) => void
  setProductVersion: (draft: QzhSessionState, value: string) => void
  setFailureDescription: (draft: QzhSessionState, value: string) => void
  setCaseView: (draft: QzhSessionState, value: QzhCaseView | undefined) => void
  setPanelOpen: (draft: QzhSessionState, value: boolean) => void
}

/** Create a fresh session-scoped QZH state handle. */
export function createQzhSessionStore(): EngineStoreHandle<QzhSessionState, QzhSessionActions> {
  return defineStore({
    init: (): QzhSessionState => ({
      entries: [], status: '导入日志开始分析。文件只在浏览器本地读取。', consent: false,
      customerLabel: '', productVersion: '', failureDescription: '', uploads: [], panelOpen: true,
    }),
    persist: 'dsh.qzh.log-analysis',
    actions: {
      setImported: (draft, entries, resetCase = true) => {
        draft.entries = [...entries]
        draft.panelOpen = true
        // A new local import starts a new evidence submission. Supplementary
        // imports in the details panel pass false and keep the current case.
        const shouldResetCase = resetCase ?? true
        draft.consent = false
        if (shouldResetCase) delete draft.caseView
      },
      setUploads: (draft, uploads) => { draft.uploads = [...uploads] },
      setStatus: (draft, status) => { draft.status = status },
      setConsent: (draft, consent) => { draft.consent = consent },
      setCustomerLabel: (draft, value) => { draft.customerLabel = value },
      setProductVersion: (draft, value) => { draft.productVersion = value },
      setFailureDescription: (draft, value) => { draft.failureDescription = value },
      setCaseView: (draft, value) => { if (value === undefined) delete draft.caseView; else draft.caseView = value },
      setPanelOpen: (draft, value) => { draft.panelOpen = value },
    },
  })
}
