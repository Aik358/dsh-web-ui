import { describe, expect, it } from 'vitest'
import {
  createLedgerDocument, deserializeLedger, foldUsage, ledgerDayKeys, localDateKey, pruneLedger, totalTokens,
} from '../src/core/ledger.ts'
import { emptyTotals } from '../src/core/types.ts'

describe('localDateKey', () => {
  it('formats a local-date key', () => {
    // 2026-08-29 12:00 local, constructed via Date components to stay TZ-neutral.
    const date = new Date(2026, 7, 29, 12, 0, 0)
    expect(localDateKey(date.getTime())).toBe('2026-08-29')
  })
})

describe('foldUsage', () => {
  it('accumulates per day, provider, and model', () => {
    const doc = createLedgerDocument()
    const at = new Date(2026, 7, 29, 10, 0, 0).getTime()
    foldUsage(doc, at, 'kimi-coding', 'kimi-latest', { ...emptyTotals(), inputTokens: 100, outputTokens: 50, calls: 1 })
    foldUsage(doc, at, 'kimi-coding', 'kimi-latest', { ...emptyTotals(), inputTokens: 10, outputTokens: 5, calls: 1 })
    foldUsage(doc, at, 'kimi-coding', 'other', { ...emptyTotals(), outputTokens: 7, calls: 1 })
    expect(doc.days['2026-08-29']?.['kimi-coding']?.['kimi-latest']).toMatchObject({ inputTokens: 110, outputTokens: 55, calls: 2 })
    expect(doc.days['2026-08-29']?.['kimi-coding']?.['other']).toMatchObject({ outputTokens: 7, calls: 1 })
  })

  it('ignores empty reports', () => {
    const doc = createLedgerDocument()
    foldUsage(doc, Date.now(), 'p', 'm', emptyTotals())
    expect(Object.keys(doc.days)).toHaveLength(0)
  })
})

describe('pruneLedger', () => {
  it('drops days older than the retention window', () => {
    const doc = createLedgerDocument()
    doc.days['2026-07-01'] = {}
    doc.days['2026-08-28'] = {}
    doc.days['2026-08-29'] = {}
    const pruned = pruneLedger(doc, '2026-08-29', 30)
    expect(pruned).toBe(1)
    expect(doc.days['2026-07-01']).toBeUndefined()
    expect(doc.days['2026-08-28']).toBeDefined()
    expect(doc.days['2026-08-29']).toBeDefined()
  })
})

describe('deserializeLedger', () => {
  it('revives a serialized document', () => {
    const doc = createLedgerDocument()
    foldUsage(doc, new Date(2026, 7, 29, 10, 0, 0).getTime(), 'deepseek', 'deepseek-v4-pro', { ...emptyTotals(), inputTokens: 5, calls: 1 })
    const revived = deserializeLedger(JSON.parse(JSON.stringify(doc)))
    expect(revived.days['2026-08-29']?.deepseek?.['deepseek-v4-pro']).toMatchObject({ inputTokens: 5, calls: 1 })
  })

  it('never throws on garbage', () => {
    for (const garbage of [null, undefined, 42, 'x', {}, { days: null }, { days: { bad: 3 } }, { days: { '2026-13-99': { p: { m: { inputTokens: 'x' } } } } }]) {
      expect(() => deserializeLedger(garbage)).not.toThrow()
    }
    // Non-numeric buckets revive to zero, and an all-zero report folds to nothing.
    expect(deserializeLedger({ days: { '2026-08-29': { p: { m: { inputTokens: '7', calls: NaN } } } } }).days['2026-08-29']).toBeUndefined()
  })
})

describe('ledgerDayKeys + totalTokens', () => {
  it('sorts days ascending and totals all buckets', () => {
    const doc = createLedgerDocument()
    doc.days['2026-08-29'] = {}
    doc.days['2026-08-27'] = {}
    expect(ledgerDayKeys(doc)).toEqual(['2026-08-27', '2026-08-29'])
    expect(totalTokens({ ...emptyTotals(), inputTokens: 1, cacheReadTokens: 2, cacheWriteTokens: 3, outputTokens: 4 })).toBe(10)
  })
})
