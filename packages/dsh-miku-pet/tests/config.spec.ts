// config 纯逻辑单测:stripJsonc / assertClientConfig / applyUserOverrides
import { describe, expect, it } from 'vitest'
import { stripJsonc, assertClientConfig, applyUserOverrides, EMPTY_CONF, type UserOverrides } from '../src/client/config.ts'
import type { ClientConfig } from '../src/client/types.ts'

const validRaw = {
  pets: [{ id: 'main', name: 'Miku', size: 220, position: { corner: 'top-right', marginX: 20, marginY: 96 } }],
  animations: {
    idle: ['idle'],
    turn: [],
    drag: ['drag'],
    clicks: ['blink1', 'blink2'],
    moves: { default: { minDist: 60 }, actions: [] },
    categories: [{ id: 'small', weight: 36, actions: ['scratch', 'blink1'] }],
  },
  animationWeights: { idle: 40, turn: 0, move: 0 },
}

describe('stripJsonc', () => {
  it('removes line comments and block comments', () => {
    const src = '{\n  // line comment\n  "a": 1, /* block */ "b": 2\n}'
    const out = stripJsonc(src)
    expect(out).not.toContain('line comment')
    expect(out).not.toContain('block')
    expect(JSON.parse(out)).toEqual({ a: 1, b: 2 })
  })

  it('keeps colon-like sequences such as http:// intact', () => {
    const src = '{ "url": "http://x/y" }'
    expect(JSON.parse(stripJsonc(src))).toEqual({ url: 'http://x/y' })
  })
})

describe('assertClientConfig', () => {
  it('accepts a valid config', () => {
    const cfg = assertClientConfig(validRaw)
    expect(cfg.pets).toHaveLength(1)
    expect(cfg.pets[0].position.corner).toBe('top-right')
    expect(cfg.animationWeights.idle).toBe(40)
  })

  it('rejects a non-object', () => {
    expect(() => assertClientConfig(null)).toThrow()
    expect(() => assertClientConfig('x')).toThrow()
  })

  it('rejects a missing pets list', () => {
    expect(() => assertClientConfig({ animations: validRaw.animations, animationWeights: validRaw.animationWeights })).toThrow(/pets/)
  })

  it('rejects an illegal corner', () => {
    const bad = { ...validRaw, pets: [{ id: 'main', size: 220, position: { corner: 'middle', marginX: 0, marginY: 0 } }] }
    expect(() => assertClientConfig(bad)).toThrow(/corner/)
  })

  it('rejects duplicate pet ids', () => {
    const dup = {
      ...validRaw,
      pets: [
        { id: 'main', size: 220, position: { corner: 'top-right', marginX: 0, marginY: 0 } },
        { id: 'main', size: 180, position: { corner: 'top-left', marginX: 0, marginY: 0 } },
      ],
    }
    expect(() => assertClientConfig(dup)).toThrow(/重复/)
  })

  it('clamps non-finite weights out', () => {
    const badW = { ...validRaw, animationWeights: { idle: -1, turn: 0, move: 0 } }
    expect(() => assertClientConfig(badW)).toThrow(/animationWeights/)
  })
})

describe('applyUserOverrides', () => {
  const base: ClientConfig = assertClientConfig(validRaw)

  it('returns the base when no override is given', () => {
    expect(applyUserOverrides(base, {})).toEqual(base)
  })

  it('replaces pets when the user override provides a non-empty list', () => {
    const user: UserOverrides = {
      pets: [{ id: 'second', size: 160, position: { corner: 'bottom-left', marginX: 10, marginY: 10 } }],
    }
    const next = applyUserOverrides(base, user)
    expect(next.pets.map((p) => p.id)).toEqual(['second'])
  })

  it('keeps base pets when the user override provides an empty list', () => {
    const next = applyUserOverrides(base, { pets: [] })
    expect(next.pets).toEqual(base.pets)
  })

  it('replaces animation weights when provided', () => {
    const next = applyUserOverrides(base, { animationWeights: { idle: 10, turn: 10, move: 10 } })
    expect(next.animationWeights.idle).toBe(10)
  })

  it('keeps EMPTY_CONF usable as a fallback base', () => {
    expect(EMPTY_CONF.pets).toEqual([])
  })
})
