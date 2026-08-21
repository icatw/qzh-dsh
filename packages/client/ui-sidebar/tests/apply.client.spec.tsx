/** Sidebar shell slot registration and its plain runtime/layout callbacks. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { SidebarRootInjected } from '@deepseek-ai/dsh-client-ui-sidebar/client'

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const layout = { toggleSidebar: vi.fn() }
  const workspaces = { startSession: vi.fn() }
  let sessionSnapshot = {
    ids: [] as string[],
    byId: {} as Record<string, { agentPreset?: string }>,
    current: undefined as string | undefined,
  }
  const sessions = {
    open: vi.fn((id: string) => { sessionSnapshot = { ...sessionSnapshot, current: id } }),
    clear: vi.fn(() => { sessionSnapshot = { ...sessionSnapshot, current: undefined } }),
    list: {
      getSnapshot: () => sessionSnapshot,
      subscribe: () => () => {},
    },
  }
  ctx.provide('layout', layout)
  ctx.provide('sessions', sessions as never)
  ctx.provide('workspaces', workspaces as never)
  const workbenchSnapshot = { mode: 'qzh' as 'qzh' | 'standard' }
  const setMode = vi.fn((mode: 'qzh' | 'standard') => { workbenchSnapshot.mode = mode })
  ctx.provide('workbench', {
    store: { getSnapshot: () => workbenchSnapshot, subscribe: () => () => {} },
    setMode,
  } as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const slots = ctx.get('slots') as SlotRegistry
  if (declare) {
    slots.register(
      { name: 'root', children: { 'sidebar': { kind: 'single', scope: 'root' } } } as never,
      () => null,
    )
  }
  return { ctx, slots, layout, workspaces, sessions, setMode, workbenchSnapshot, setSessionSnapshot: (next: typeof sessionSnapshot) => { sessionSnapshot = next } }
}

describe('ui-sidebar apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'layout', 'workbench', 'sessions', 'workspaces', 'locale'])
  })

  it('registers the shell and declares its child seats', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('sidebar')).toHaveLength(1)
    expect(b.slots.spec('sidebar.workspaces')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.settings')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.footer.action')).toEqual({ kind: 'list', scope: 'root' })
    // Copy rides the standard locale seat, not the inject face.
    expect(b.slots.entries('sidebar')[0]!.locale).toBe('sidebar')
    const injected = (b.slots.entries('sidebar')[0]!.inject as () => SidebarRootInjected)()
    expect(Object.keys(injected)).toEqual(['startSession', 'selectWorkbench', 'hooks', 'toggleSidebar'])
    // Both arms delegate to the runtime's shared New Session action.
    injected.startSession('workspace' as never)
    expect(b.workspaces.startSession).toHaveBeenCalledWith('workspace', 'qzh')
    injected.startSession()
    expect(b.workspaces.startSession).toHaveBeenLastCalledWith(undefined, 'qzh')
    injected.toggleSidebar()
    expect(b.layout.toggleSidebar).toHaveBeenCalledOnce()
  })

  it('switches workbench after leaving a mismatched current session', async () => {
    const b = await bench()
    b.setSessionSnapshot({
      ids: ['qzh-1'],
      byId: { 'qzh-1': { agentPreset: 'qzh' } },
      current: 'qzh-1',
    })
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = (b.slots.entries('sidebar')[0]!.inject as () => SidebarRootInjected)()
    injected.selectWorkbench('standard')
    expect(b.sessions.clear).toHaveBeenCalledOnce()
    expect(b.setMode).toHaveBeenCalledWith('standard')
    expect(b.setMode.mock.invocationCallOrder[0]).toBeGreaterThan(b.sessions.clear.mock.invocationCallOrder[0]!)
    injected.startSession()
    expect(b.workspaces.startSession).toHaveBeenCalledWith(undefined, 'standard')
  })

  it('fails when no live owner declared the sidebar slot', async () => {
    const b = await bench(false)
    await expect(b.ctx.plugin({ inject: [...inject], apply })).rejects.toThrow(/not declared/)
  })

  it('removes the entry and child declaration on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('sidebar')).toHaveLength(0)
    expect(b.slots.spec('sidebar.workspaces')).toBeUndefined()
    expect(b.slots.spec('sidebar.footer.action')).toBeUndefined()
  })
})
