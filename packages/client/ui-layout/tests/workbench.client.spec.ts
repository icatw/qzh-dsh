import { describe, expect, it } from 'vitest'
import { WorkbenchController } from '../src/client/workbench.ts'

describe('WorkbenchController', () => {
  it('defaults to QZH and publishes mode changes', () => {
    const controller = new WorkbenchController()
    const snapshot = controller.store.getSnapshot()
    expect(snapshot).toEqual({ mode: 'qzh' })
    controller.setMode('standard')
    expect(controller.store.getSnapshot()).toEqual({ mode: 'standard' })
    controller.setMode('standard')
    expect(controller.store.getSnapshot()).toEqual({ mode: 'standard' })
  })
})
