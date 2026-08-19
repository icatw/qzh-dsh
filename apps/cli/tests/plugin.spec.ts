import { describe, expect, it } from 'vitest'
import { blockedBuildsHint } from '../src/plugin.ts'

describe('blockedBuildsHint', () => {
  it('returns the exact allowBuilds edit when pnpm left its placeholder', () => {
    const hint = blockedBuildsHint(
      'packages:\n  - .\n\nallowBuilds:\n  node-pty: set this to true or false\n',
      '/Users/me/.dsh/profiles/desktop',
    )
    expect(hint).toContain('node-pty')
    expect(hint).toContain('/Users/me/.dsh/profiles/desktop/pnpm-workspace.yaml')
    expect(hint).toContain('  node-pty: true')
  })

  it('lists every placeholder entry, scoped names included', () => {
    const hint = blockedBuildsHint(
      'allowBuilds:\n  node-pty: set this to true or false\n  @scope/pkg: set this to true or false\n',
      '/p',
    )
    expect(hint).toContain('  node-pty: true')
    expect(hint).toContain('  @scope/pkg: true')
  })

  it('returns undefined when no placeholder exists', () => {
    expect(blockedBuildsHint('packages:\n  - .\n', '/p')).toBeUndefined()
    expect(blockedBuildsHint('', '/p')).toBeUndefined()
    expect(blockedBuildsHint('allowBuilds:\n  node-pty: true\n', '/p')).toBeUndefined()
  })
})
