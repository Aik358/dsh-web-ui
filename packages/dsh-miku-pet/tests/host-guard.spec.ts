// 宿主路由守卫单测:resolveAsset / sanitizeAction / sanitizeUserConfig
// 覆盖评审指出的防穿越与配置保留要求
import { describe, expect, it } from 'vitest'
import { resolveAsset, sanitizeAction, sanitizeUserConfig } from '../src/index.ts'
import { sep } from 'node:path'

describe('resolveAsset', () => {
  const root = 'C:' + sep + 'pet' + sep + 'thumb'

  it('resolves a plain relative path inside the root', () => {
    const out = resolveAsset(root, 'idle' + sep + 'a.webp')
    expect(out).toBe(root + sep + 'idle' + sep + 'a.webp')
  })

  it('returns undefined for empty input', () => {
    expect(resolveAsset(root, '')).toBeUndefined()
  })

  it('returns undefined for traversal outside the root', () => {
    expect(resolveAsset(root, '..' + sep + '..' + sep + 'secret')).toBeUndefined()
    expect(resolveAsset(root, 'a' + sep + '..' + sep + '..' + sep + 'b')).toBeUndefined()
  })
})

describe('sanitizeAction', () => {
  it('accepts a plain single-segment action', () => {
    expect(sanitizeAction('idle')).toBe('idle')
    expect(sanitizeAction('work')).toBe('work')
  })

  it('rejects traversal and separators', () => {
    expect(sanitizeAction('..')).toBeNull()
    expect(sanitizeAction('../..')).toBeNull()
    expect(sanitizeAction('a/../b')).toBeNull()
    expect(sanitizeAction('a\\b')).toBeNull()
  })

  it('rejects empty and control characters', () => {
    expect(sanitizeAction('')).toBeNull()
    expect(sanitizeAction('a\u0000b')).toBeNull()
  })
})

describe('sanitizeUserConfig', () => {
  const goodPet = { id: 'main', size: 220, position: { corner: 'top-right', marginX: 20, marginY: 96 } }

  it('accepts a minimal pets list', () => {
    const out = sanitizeUserConfig({ pets: [goodPet] })
    expect(out).not.toBeNull()
    expect(out!.pets).toHaveLength(1)
    expect(out!.pets[0]).toMatchObject({ id: 'main', size: 220 })
  })

  it('preserves the pet name', () => {
    const out = sanitizeUserConfig({ pets: [{ ...goodPet, name: 'Miku' }] })
    expect(out!.pets[0]).toMatchObject({ name: 'Miku' })
  })

  it('rejects a non-object / empty pets list', () => {
    expect(sanitizeUserConfig(null)).toBeNull()
    expect(sanitizeUserConfig({ pets: [] })).toBeNull()
    expect(sanitizeUserConfig('x')).toBeNull()
  })

  it('rejects an illegal corner or non-finite margins', () => {
    expect(sanitizeUserConfig({ pets: [{ ...goodPet, position: { corner: 'middle', marginX: 0, marginY: 0 } }] })).toBeNull()
    expect(sanitizeUserConfig({ pets: [{ ...goodPet, position: { corner: 'top-right', marginX: NaN, marginY: 0 } }] })).toBeNull()
  })

  it('rejects an id with path-escape characters', () => {
    expect(sanitizeUserConfig({ pets: [{ ...goodPet, id: '../evil' }] })).toBeNull()
    expect(sanitizeUserConfig({ pets: [{ ...goodPet, id: 'a\\b' }] })).toBeNull()
  })

  it('keeps animations / animationWeights overrides instead of dropping them', () => {
    const animated = {
      pets: [goodPet],
      animations: { idle: ['idle'], categories: [{ id: 'eat', weight: 99, actions: ['eat'] }] },
      animationWeights: { idle: 1, turn: 0, move: 0 },
    }
    const out = sanitizeUserConfig(animated)
    expect(out!.animations).toEqual(animated.animations)
    expect(out!.animationWeights).toEqual(animated.animationWeights)
  })
})