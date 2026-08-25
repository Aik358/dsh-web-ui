// pickers 纯逻辑单测:pick / randomBetween / rollKind / pickWeightedCategory / pickCategoryAction
import { describe, expect, it } from 'vitest'
import { pick, randomBetween, rollKind, pickWeightedCategory, pickCategoryAction } from '../src/client/pickers.ts'
import type { Category, Weights } from '../src/client/types.ts'

describe('pick', () => {
  it('returns a member of the pool', () => {
    const pool = ['a', 'b', 'c']
    for (let i = 0; i < 50; i++) expect(pool).toContain(pick(pool))
  })

  it('excludes the given member when the pool has alternatives', () => {
    const pool = ['a', 'b', 'c']
    for (let i = 0; i < 50; i++) expect(pick(pool, 'a')).not.toBe('a')
  })

  it('falls back to the full pool for a single-element pool with the same exclude', () => {
    expect(pick(['a'], 'a')).toBe('a')
  })
})

describe('randomBetween', () => {
  it('always returns within [min, max)', () => {
    for (let i = 0; i < 200; i++) {
      const v = randomBetween(2, 8)
      expect(v).toBeGreaterThanOrEqual(2)
      expect(v).toBeLessThan(8)
    }
  })
})

describe('rollKind', () => {
  const w: Weights = { idle: 40, turn: 0, move: 0 }
  it('maps roll boundaries to the weighted buckets', () => {
    expect(rollKind(0.0, w)).toBe('idle')
    expect(rollKind(0.39, w)).toBe('idle')
    expect(rollKind(0.4, w)).toBe('action') // idle 40 / categories 60 -> roll >= 0.4 落入 action
    expect(rollKind(0.99, w)).toBe('action')
  })

  it('maps the turn and move bands when weighted', () => {
    const w2: Weights = { idle: 20, turn: 10, move: 10 }
    expect(rollKind(0.15, w2)).toBe('idle')
    expect(rollKind(0.25, w2)).toBe('turn')
    expect(rollKind(0.35, w2)).toBe('move')
    expect(rollKind(0.5, w2)).toBe('action')
  })
})

describe('pickWeightedCategory', () => {
  const cats: Category[] = [
    { id: 'a', weight: 36, actions: ['x', 'y'] },
    { id: 'b', weight: 24, actions: ['z'] },
  ]
  it('returns null for an empty category pool', () => {
    expect(pickWeightedCategory([], 'left')).toBeNull()
  })

  it('picks from the weighted categories', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const c = pickWeightedCategory(cats, 'left')
      expect(c).not.toBeNull()
      seen.add(c!.id)
    }
    expect(seen.has('a') && seen.has('b')).toBe(true)
  })

  it('excludes noMirror categories when facing right, falling back when all are excluded', () => {
    const mirror: Category[] = [
      { id: 'm', weight: 10, actions: ['x'], noMirror: true },
      { id: 'n', weight: 10, actions: ['y'] },
    ]
    for (let i = 0; i < 100; i++) expect(pickWeightedCategory(mirror, 'right')!.id).not.toBe('m')
    // 全部 noMirror -> 回退原池
    const allMirror: Category[] = [{ id: 'm', weight: 10, actions: ['x'], noMirror: true }]
    expect(pickWeightedCategory(allMirror, 'right')!.id).toBe('m')
  })
})

describe('pickCategoryAction', () => {
  it('falls back to the idle pool when no category is usable', () => {
    const r = pickCategoryAction([], ['stop1', 'stop2'], 'left', 'stop1')
    expect(r.id).toBe('FALLBACK')
    expect(['stop1', 'stop2']).toContain(r.name)
  })

  it('picks an action from a usable category', () => {
    const cats: Category[] = [{ id: 'a', weight: 10, actions: ['blink1', 'blink2'] }]
    const r = pickCategoryAction(cats, ['stop1'], 'left', 'blink1')
    expect(r.id).toBe('a')
    expect(['blink1', 'blink2']).toContain(r.name)
  })
})
