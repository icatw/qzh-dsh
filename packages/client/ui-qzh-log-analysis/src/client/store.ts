import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { QzhCaseView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ImportedLogEntry } from '../log-import.ts'

/** JSON-safe state shared by the QZH details panel and the session header action. */
export interface QzhSessionState {
  entries: ImportedLogEntry[]
  status: string
  consent: boolean
  customerLabel: string
  productVersion: string
  failureDescription: string
  caseView?: QzhCaseView
  panelOpen: boolean
}

type QzhSessionActions = {
  setImported: (draft: QzhSessionState, entries: readonly ImportedLogEntry[]) => void
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
      customerLabel: '', productVersion: '', failureDescription: '', panelOpen: true,
    }),
    persist: 'dsh.qzh.log-analysis',
    actions: {
      setImported: (draft, entries) => {
        draft.entries = [...entries]
        draft.panelOpen = true
        // A new local import starts a new evidence submission. Do not keep a
        // stale in-memory Host case ID across imports or Host restarts.
        delete draft.caseView
      },
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
