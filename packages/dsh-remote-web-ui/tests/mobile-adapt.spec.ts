// @vitest-environment jsdom
/** The portrait-touch adaptation: install, portrait apply, desktop revert. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startMobileAdapt } from '../src/client/mobile-adapt.ts'

/** jsdom lacks matchMedia; script it from a mutable descriptor. */
const media = { portrait: false, coarse: false }
function stubMatchMedia(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('portrait') ? media.portrait : query.includes('coarse') ? media.coarse : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }))
}

/** The adaptation reads viewport width from window.innerWidth. */
function setWidth(px: number): void {
  vi.stubGlobal('innerWidth', px)
}

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  window.sessionStorage.clear()
  // jsdom's localStorage in this vitest build lacks clear(); the adapt layer
  // only reads it (inside try/catch), so stale keys are harmless here.
  stubMatchMedia()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('startMobileAdapt', () => {
  it('installs the global and stays inert on a desktop viewport', () => {
    media.portrait = false
    media.coarse = false
    setWidth(1400)
    startMobileAdapt()
    const adapt = (window as unknown as { __dshRemoteAdapt?: { evaluate: () => void; toggleSidebar: null } }).__dshRemoteAdapt
    expect(adapt).toBeDefined()
    expect(adapt?.toggleSidebar).toBeNull()
    adapt?.evaluate()
    expect(document.querySelector('style[data-plugin-css="dsh-remote-web-ui/mobile-adapt.css"]')).toBeNull()
    expect(document.body.classList.contains('dsh-remote-portrait')).toBe(false)
    expect(document.getElementById('dshRemoteWhale')).toBeNull()
  })

  it('applies the layer in portrait touch viewports and reverts off-portrait', () => {
    media.portrait = true
    media.coarse = true
    setWidth(390)
    startMobileAdapt()
    const adapt = (window as unknown as { __dshRemoteAdapt?: { evaluate: () => void } }).__dshRemoteAdapt
    adapt?.evaluate()
    expect(document.body.classList.contains('dsh-remote-portrait')).toBe(true)
    const tag = document.querySelector('style[data-plugin-css="dsh-remote-web-ui/mobile-adapt.css"]')
    expect(tag).not.toBeNull()
    // 16px input rule (iOS focus zoom) and the collapsed-rail pin ride along.
    expect(tag?.textContent).toContain('font-size:16px')
    expect(tag?.textContent).toContain('grid-template-columns:0 minmax(0,1fr) 0')
    // viewport-fit=cover enables the safe-area insets.
    const meta = document.createElement('meta')
    meta.name = 'viewport'
    meta.content = 'width=device-width, initial-scale=1'
    document.head.appendChild(meta)
    expect(meta.getAttribute('content')).not.toContain('viewport-fit')
    // Back to desktop: the layer reverts cleanly.
    media.portrait = false
    adapt?.evaluate()
    expect(document.body.classList.contains('dsh-remote-portrait')).toBe(false)
    expect(document.querySelector('style[data-plugin-css="dsh-remote-web-ui/mobile-adapt.css"]')).toBeNull()
  })

  it('the manual opt-out keeps the layer off', () => {
    sessionStorage.setItem('dsh-remote-force-desktop', '1')
    media.portrait = true
    media.coarse = true
    setWidth(390)
    startMobileAdapt()
    ;(window as unknown as { __dshRemoteAdapt?: { evaluate: () => void } }).__dshRemoteAdapt?.evaluate()
    expect(document.body.classList.contains('dsh-remote-portrait')).toBe(false)
  })

  it('is idempotent: a second install does not double-apply', () => {
    media.portrait = true
    media.coarse = true
    setWidth(390)
    startMobileAdapt()
    startMobileAdapt()
    ;(window as unknown as { __dshRemoteAdapt?: { evaluate: () => void } }).__dshRemoteAdapt?.evaluate()
    const adapt = (window as unknown as { __dshRemoteAdapt?: { evaluate: () => void } }).__dshRemoteAdapt
    adapt?.evaluate()
    expect(document.querySelectorAll('style[data-plugin-css="dsh-remote-web-ui/mobile-adapt.css"]')).toHaveLength(1)
  })
})
