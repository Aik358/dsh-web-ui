/**
 * Focused tests for the ORCA LINK (orca-link) skin port: scene layers,
 * wordmark/signal chrome, link-state projection, status character and
 * cleanup. Exercises the real skins/orca-link/hooks.mjs in jsdom.
 */

// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'

import defineSkinHooks from '../skins/orca-link/hooks.mjs'

function orcaSkinDir(): string {
  for (const base of [process.cwd(), path.resolve(process.cwd(), 'packages/skins/skin-center')]) {
    const dir = path.join(base, 'skins', 'orca-link')
    if (existsSync(path.join(dir, 'skin.json'))) return dir
  }
  throw new Error('cannot locate skins/orca-link directory')
}

function sidebarFixture(): void {
  const sidebar = document.createElement('div')
  sidebar.setAttribute('data-slot', 'sidebar')
  const pane = document.createElement('div')
  const logoRow = document.createElement('div')
  const brand = document.createElement('button')
  brand.setAttribute('aria-label', 'DeepSeek Harness')
  logoRow.append(brand)
  pane.append(logoRow)
  sidebar.append(pane)
  document.body.append(sidebar)
}

function conversationFixture(phase: string): HTMLElement {
  const root = document.createElement('div')
  root.setAttribute('data-phase', phase)
  const scroll = document.createElement('div')
  scroll.setAttribute('data-conversation-scroll', '')
  root.append(scroll)
  document.body.append(root)
  return root
}

function setup() {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  document.documentElement.setAttribute('data-dsh-skin', 'orca-link')
  document.title = 'orca-link-hooks-spec'
  const cleanups: Array<() => void> = []
  const theme = {
    get: () => (document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'),
    subscribe: () => () => {},
  }
  const ctx = {
    skinId: 'orca-link',
    scopeAttr: 'orca-link',
    assetBase: '/api/skin-center/v2/skins/orca-link',
    theme,
    onCleanup: (fn: () => void) => cleanups.push(fn),
  }
  const runCleanup = () => {
    for (const fn of cleanups.splice(0).reverse()) fn()
  }
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 10))
  return { ctx, runCleanup, cleanups, flush }
}

describe('orca-link hooks: scene layers and chrome', () => {
  it('mounts the two-layer light and dark scenes and resolves artwork through assetBase', () => {
    const { ctx, runCleanup } = setup()
    defineSkinHooks().apply(ctx)

    const light = document.body.querySelector('[data-skin-chrome="light-scene"]')
    const dark = document.body.querySelector('[data-skin-chrome="dark-scene"]')
    expect(light).not.toBeNull()
    expect(dark).not.toBeNull()
    // The crossfade layers carry BOTH the Layer and Hero/Active classes on one
    // element (the v1 stylesheet sizes them that way); a bare Layer wrapper
    // would end up static with 0 height.
    const hero = light?.querySelector('.orca-ch-lightSceneLayer.orca-ch-lightSceneHero')
    const active = light?.querySelector('.orca-ch-lightSceneLayer.orca-ch-lightSceneActive')
    expect(hero).not.toBeNull()
    expect(active).not.toBeNull()

    expect(document.body.style.getPropertyValue('--orca-link-light-hero-art')).toContain(
      'assets/orca-link-light-hero.webp',
    )
    expect(document.body.style.getPropertyValue('--orca-link-dark-active-art')).toContain(
      'assets/orca-link-dark-active.webp',
    )
    expect(document.body.hasAttribute('data-dsh-orca-link')).toBe(true)
    expect(document.body.querySelector('[data-skin-chrome="spine"]')).not.toBeNull()
    expect(document.body.querySelector('[data-skin-chrome="standby"]')).not.toBeNull()

    runCleanup()
    expect(document.body.querySelector('[data-skin-chrome="light-scene"]')).toBeNull()
    expect(document.body.querySelector('[data-skin-chrome="dark-scene"]')).toBeNull()
    expect(document.body.hasAttribute('data-dsh-orca-link')).toBe(false)
    expect(document.body.style.getPropertyValue('--orca-link-light-hero-art')).toBe('')
    expect(document.title).toBe('orca-link-hooks-spec')
  })

  it('mounts the wordmark and signal chip into the sidebar logo row', async () => {
    const { ctx, runCleanup, flush } = setup()
    sidebarFixture()
    defineSkinHooks().apply(ctx)

    const row = document.body.querySelector("[data-slot='sidebar'] > :first-child > :first-child")
    expect(row?.querySelector('[data-orca-link-wordmark]')).not.toBeNull()
    const chip = document.body.querySelector('[data-orca-link-signal]')
    expect(chip).not.toBeNull()
    await flush()
    expect(chip?.getAttribute('data-orca-link-status')).toBe('standby')

    runCleanup()
    expect(document.body.querySelector('[data-orca-link-signal]')).toBeNull()
    expect(document.body.querySelector('[data-orca-link-wordmark]')).toBeNull()
  })

  it('projects the conversation phase onto body[data-orca-scene] and back', async () => {
    const { ctx, runCleanup, flush } = setup()
    conversationFixture('settling')
    defineSkinHooks().apply(ctx)
    expect(document.body.getAttribute('data-orca-scene')).toBe('active')

    const root = document.body.querySelector('[data-phase]')
    root?.setAttribute('data-phase', 'hero')
    await flush()
    expect(document.body.getAttribute('data-orca-scene')).toBe('hero')

    root?.setAttribute('data-phase', 'active')
    await flush()
    expect(document.body.getAttribute('data-orca-scene')).toBe('active')

    runCleanup()
    expect(document.body.hasAttribute('data-orca-scene')).toBe(false)
  })

  it('mounts the status character and mirrors the projected link status', () => {
    const { ctx, runCleanup } = setup()
    sidebarFixture()
    const active = conversationFixture('active')
    const running = document.createElement('div')
    running.setAttribute('data-state', 'running')
    active.append(running)
    defineSkinHooks().apply(ctx)

    const character = document.body.querySelector('[data-orca-link-character]')
    expect(character).not.toBeNull()
    expect(character?.getAttribute('data-orca-link-status')).toBe('working')
    expect(character?.style.getPropertyValue('--orca-status-column')).not.toBe('')
    expect(character?.style.getPropertyValue('--orca-link-status-atlas')).toContain(
      'assets/orca-link-status-atlas.webp',
    )

    runCleanup()
    expect(document.body.querySelector('[data-orca-link-character]')).toBeNull()
  })
})
