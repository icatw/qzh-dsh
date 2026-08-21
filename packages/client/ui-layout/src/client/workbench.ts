import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Product workbench shown by the Web shell. */
export type WorkbenchMode = 'qzh' | 'standard'

/** Current workbench selection. */
export interface WorkbenchSnapshot {
  mode: WorkbenchMode
}

/** Cross-plugin workbench selection service. */
export interface IWorkbench {
  readonly store: SnapshotStore<WorkbenchSnapshot>
  setMode(mode: WorkbenchMode): void
}

/** Owns the current product workbench without changing DSH session semantics. */
export class WorkbenchController implements IWorkbench {
  readonly store = createSnapshotStore<WorkbenchSnapshot>({ mode: 'qzh' })

  setMode(mode: WorkbenchMode): void {
    if (this.store.getSnapshot().mode === mode) return
    this.store.set({ mode })
  }
}
