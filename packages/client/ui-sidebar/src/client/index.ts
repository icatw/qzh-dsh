/** Registers the sidebar shell into the layout-owned slot. */
import type { ClientContext, ISessions, IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkbenchMode } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { SidebarRootInjected } from './contract/slots.ts'
import { SidebarRoot } from './SidebarRoot.tsx'
import { en, zh, type SidebarKey } from './locales.ts'

export type {
  SidebarFooterActionOwnerProps, SidebarRootComponentProps, SidebarRootInjected,
  SidebarSectionOwnerProps, SidebarSettingsOwnerProps,
} from './contract/slots.ts'
export type { SidebarKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Sidebar shell controls copy. */
    sidebar: SidebarKey
  }
}

/** Dictionary namespace owned by this plugin (shell controls copy). */
const NS = 'sidebar'

/** Services required by the sidebar plugin. */
export const inject = ['slots', 'layout', 'workbench', 'sessions', 'workspaces', 'locale']

/** Registers the sidebar shell and its service callbacks.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const sessions = ctx.get('sessions') as unknown as ISessions
  const workspaces = ctx.get('workspaces') as unknown as IWorkspaces
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar: dictionaries')

  const matchesWorkbench = (agentPreset: string | undefined, mode: WorkbenchMode): boolean => (
    mode === 'qzh' ? agentPreset === 'qzh' : agentPreset !== 'qzh'
  )
  const injectProps = (): SidebarRootInjected => ({
    // The shell's New Session button rides the runtime's shared action
    // (current Session Workspace, then recent Workspace).
    startSession: (workspaceId) => {
      const mode = ctx.workbench.store.getSnapshot().mode
      workspaces.startSession(workspaceId, mode === 'qzh' ? 'qzh' : 'standard')
    },
    selectWorkbench: (mode: WorkbenchMode) => {
      // Move the session first, then publish the mode. Publishing before the
      // selection changes lets the QZH workbench sync see the old qzh session
      // and immediately pull the switcher back to QZH — so "通用 → 新会话"
      // still minted a qzh blank.
      const sessionList = sessions.list.getSnapshot()
      const current = sessionList.current
      const currentSummary = current === undefined ? undefined : sessionList.byId[current]
      if (currentSummary === undefined || !matchesWorkbench(currentSummary.agentPreset, mode)) {
        const candidate = sessionList.ids.find(id => {
          const summary = sessionList.byId[id]
          return summary !== undefined && matchesWorkbench(summary.agentPreset, mode)
        })
        if (candidate === undefined) sessions.clear()
        else sessions.open(candidate)
      }
      ctx.workbench.setMode(mode)
    },
    hooks: { workbench: ctx.workbench.store },
    toggleSidebar: () => { ctx.layout.toggleSidebar() },
  })
  ctx.effect(
    () => ctx.slots.register({
      name: 'sidebar',
      locale: NS,
      // The shell owns geometry; ui-workspace registers the whole browsing
      // region (header, search, session list, workspace dialogs), ui-settings
      // registers the foot trigger + settings panel.
      children: {
        'sidebar.workspaces': { kind: 'single', scope: 'root' },
        'sidebar.settings': { kind: 'single', scope: 'root' },
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
      },
      inject: injectProps,
    }, SidebarRoot),
    'ui-sidebar: slot registration',
  )
}
