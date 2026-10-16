// @vitest-environment node
import { describe, expect, it } from 'vitest'

// Raw import of every source file (excluding tests) via Vite's glob, so the
// scan covers everything src ships without needing node fs modules.
const sources = import.meta.glob('../**/*.{ts,tsx,css}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('no stale links', () => {
  it('no link or href anywhere in src points at a removed route', () => {
    // A stale internal link keeps a removed page reachable from the UI.
    const forbidden = /\/console\/(trace|audit\b|results|real-world|evaluation|security|profile)/

    const offenders = Object.entries(sources)
      .filter(([key]) => !/\.test\.(tsx?|css)$/.test(key) && !key.endsWith('/App.tsx'))
      .filter(([, text]) => forbidden.test(text))
      .map(([key]) => key)

    expect(offenders).toEqual([])
  })
})
