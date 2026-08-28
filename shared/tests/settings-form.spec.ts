import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { CardForm, booleanField, choiceField, numberField, secretField, textField, type BatchedWrite, type BatchResult } from '../client/settings/settings-form.ts'
// The shared vitest env has no runtime: stub the snapshot-store factory so
// bind() works in tests.
vi.mock('@deepseek-ai/dsh-client-store', () => {
  const createSnapshotStore = (initial: unknown) => {
    let value = initial
    return {
      getSnapshot: () => value,
      set: (next: unknown) => { value = next },
      subscribe: () => () => {},
    }
  }
  return { createSnapshotStore }
})

/** Minimal in-memory scope backing a CardForm test. */
class FakeScope<T extends Record<string, unknown>> implements SettingsScope<T> {
  value: T
  base: T
  user: Partial<T> = {}
  writable = true
  status: 'ready' | 'loading' = 'ready'
  private listeners = new Set<() => void>()
  set = vi.fn(async (field: string, value: unknown) => { (this.user as Record<string, unknown>)[field] = value })
  unset = vi.fn(async (field: string) => { delete (this.user as Record<string, unknown>)[field] })
  mutate = vi.fn(async (ops: ReadonlyArray<{ op: string; path: Array<string | number>; value?: unknown }>) => {
    for (const item of ops) {
      const field = String(item.path[item.path.length - 1])
      if (item.op === 'unset') delete (this.user as Record<string, unknown>)[field]
      else (this.user as Record<string, unknown>)[field] = item.value
    }
    this.reflect()
  })
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  /** Notify subscribers after a mutation, the way a real scope does. */
  notify(): void {
    for (const listener of this.listeners) listener()
  }
  getSnapshot(): SettingsScopeSnapshot<T> {
    return {
      status: this.status,
      writable: this.writable,
      value: this.value,
      base: this.base,
      user: this.user,
      revision: 1,
      mode: 'host',
    }
  }
  constructor(value: T) {
    this.value = value
    this.base = value
  }
  /** Apply the stored value over the base, the way a real scope projects its section. */
  private reflect(): void {
    this.value = { ...this.base, ...this.user }
  }
  /** Resolve after a save writes, mirroring the Host's read-back. */
  settle(): void {
    this.reflect()
  }
  /** Override the set/unset spies to reflect writes like the real scope. */
  autoReflect(): void {
    this.set.mockImplementation(async (field: string, value: unknown) => {
      (this.user as Record<string, unknown>)[field] = value
      this.reflect()
    })
    this.unset.mockImplementation(async (field: string) => {
      delete (this.user as Record<string, unknown>)[field]
      this.reflect()
    })
  }
}

describe('shared settings-form field specs', () => {
  it('numberField formats stored numbers and clears on empty draft', () => {
    const spec = numberField('size')
    expect(spec.format(32)).toBe('32')
    expect(spec.format(undefined)).toBe('')
    expect(spec.parse('')).toEqual({ kind: 'clear' })
    expect(spec.parse(' 64 ')).toEqual({ kind: 'set', value: 64 })
    expect(spec.parse('abc')).toBeUndefined()
  })

  it('numberField honors integer and min constraints', () => {
    const spec = numberField('size', { integer: true, min: 32 })
    expect(spec.parse('32')).toEqual({ kind: 'set', value: 32 })
    expect(spec.parse('32.5')).toBeUndefined()
    expect(spec.parse('31')).toBeUndefined()
  })

  it('booleanField trims drafts and treats the empty string as a clear', () => {
    const spec = booleanField('enabled')
    expect(spec.parse(' true ')).toEqual({ kind: 'set', value: true })
    expect(spec.parse('false')).toEqual({ kind: 'set', value: false })
    expect(spec.parse('')).toEqual({ kind: 'clear' })
    expect(spec.parse('yes')).toBeUndefined()
  })

  it('textField trims drafts and clears on empty input', () => {
    const spec = textField('name')
    expect(spec.parse('  hugo  ')).toEqual({ kind: 'set', value: 'hugo' })
    expect(spec.parse('')).toEqual({ kind: 'clear' })
  })

  it('choiceField accepts only listed choices', () => {
    const spec = choiceField('model', ['a', 'b'])
    expect(spec.format('a')).toBe('a')
    expect(spec.format('zzz')).toBe('')
    expect(spec.parse('b')).toEqual({ kind: 'set', value: 'b' })
    expect(spec.parse('zzz')).toBeUndefined()
    expect(spec.parse('')).toEqual({ kind: 'clear' })
  })
})

describe('CardForm', () => {
  const fields = () => [booleanField('enabled'), numberField('size'), textField('name'), choiceField('model', ['a', 'b'])]

  it('exposes a ready, clean, writable shell over a served namespace', () => {
    const scope = new FakeScope({ enabled: true, size: 32 })
    const form = new CardForm(scope, fields())
    expect(form.shell()).toMatchObject({ available: true, exposed: true, writable: true, dirty: false, invalid: false })
  })

  it('stages edits and writes them on save', async () => {
    const scope = new FakeScope<Record<string, unknown>>({ enabled: true, size: 32 })
    scope.autoReflect()
    const form = new CardForm(scope, fields())
    const actions = form.actions()
    actions.edit('size', '64')
    actions.edit('name', 'hugo')
    expect(form.shell().dirty).toBe(true)
    expect(form.field('size')).toMatchObject({ text: '64', overridden: true, invalid: false })
    await form.save()
    expect(scope.mutate).toHaveBeenCalledTimes(1)
    expect(scope.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['size'], value: 64 },
      { op: 'set', path: ['name'], value: 'hugo' },
    ])
    expect(form.shell().dirty).toBe(false)
    expect(form.field('size')).toMatchObject({ text: '64', overridden: true })
  })

  it('blocks the save while a draft is invalid and keeps it staged', async () => {
    const scope = new FakeScope<Record<string, unknown>>({ size: 32 })
    scope.autoReflect()
    const form = new CardForm(scope, fields())
    form.actions().edit('size', 'not-a-number')
    expect(form.shell().invalid).toBe(true)
    await form.save()
    expect(scope.set).not.toHaveBeenCalled()
    expect(form.shell().dirty).toBe(true)
  })

  it('clears only the fields the save actually wrote, preserving in-flight edits', async () => {
    const scope = new FakeScope<Record<string, unknown>>({ enabled: true, size: 32, name: 'old' })
    scope.autoReflect()
    const form = new CardForm(scope, fields())
    const actions = form.actions()
    actions.edit('name', 'new')
    // A deferred write keeps the save in flight so we can stage a second edit mid-save.
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const originalSet = scope.set.getMockImplementation()
    scope.set.mockImplementation(async (field: string, value: unknown) => {
      await gate
      await originalSet!(field, value)
    })
    const saving = form.save()
    actions.edit('size', '99')
    release!()
    await saving
    expect(form.field('size')).toMatchObject({ text: '99', invalid: false })
    expect(form.shell().dirty).toBe(true)
    await form.save()
    expect(form.shell().dirty).toBe(false)
  })

  it('keeps an in-flight edit to the SAME field being saved', async () => {
    const scope = new FakeScope<Record<string, unknown>>({ enabled: true, size: 32, name: 'old' })
    scope.autoReflect()
    const form = new CardForm(scope, fields())
    const actions = form.actions()
    actions.edit('name', 'new')
    // A deferred write keeps the save in flight so we can re-edit the same
    // field mid-save.
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const originalSet = scope.set.getMockImplementation()
    scope.set.mockImplementation(async (field: string, value: unknown) => {
      await gate
      await originalSet!(field, value)
    })
    const saving = form.save()
    actions.edit('name', 'newer')
    release!()
    await saving
    // The newer draft survives: only the entry this save started from is
    // cleared, not a draft the user staged while the write was in flight.
    expect(form.field('name')).toMatchObject({ text: 'newer', invalid: false })
    expect(form.shell().dirty).toBe(true)
    await form.save()
    expect(form.shell().dirty).toBe(false)
  })

  it('marks the shell failed when the atomic mutation is refused', async () => {
    const scope = new FakeScope<Record<string, unknown>>({ name: 'old' })
    // The host validator refuses the batch: nothing lands, drafts survive.
    scope.mutate.mockRejectedValue(new Error('settings-rejected'))
    const form = new CardForm(scope, fields())
    form.actions().edit('name', 'new')
    await form.save()
    expect(form.shell()).toMatchObject({ failed: true, dirty: true })
    expect(form.shell().failedReason).toBe('settings-rejected')
  })

  it('resets a field back to its base value', () => {
    const scope = new FakeScope<Record<string, unknown>>({ enabled: true })
    const form = new CardForm(scope, fields())
    const actions = form.actions()
    actions.edit('enabled', 'false')
    expect(form.field('enabled').text).toBe('false')
    actions.resetField('enabled')
    expect(form.field('enabled')).toMatchObject({ text: 'true', overridden: false })
  })

  it('dispose stops later scope mutations from reaching bound stores', () => {
    const scope = new FakeScope<Record<string, unknown>>({ name: 'before' })
    const form = new CardForm(scope, fields())
    const store = form.bind(() => form.field('name').text)
    expect(store.getSnapshot()).toBe('before')
    // Idempotent: a second dispose keeps the first teardown's guarantees.
    form.dispose()
    form.dispose()
    scope.user.name = 'after'
    scope.settle()
    scope.notify()
    expect(store.getSnapshot()).toBe('before')
  })
})

/** A settings scope exposing the optional batch surface for the batch tests. */
class BatchScope<T extends Record<string, unknown>> implements SettingsScope<T> {
  value: T
  base: T
  user: Partial<T> = {}
  writable = true
  status: 'ready' | 'loading' = 'ready'
  set = vi.fn(async () => {})
  unset = vi.fn(async () => {})
  mutate = vi.fn(async (_ops: ReadonlyArray<{ op: string; path: string[]; value?: unknown }>) => {})
  private listeners = new Set<() => void>()
  constructor(value: T) {
    this.value = value
    this.base = value
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  getSnapshot(): SettingsScopeSnapshot<T> {
    return {
      status: this.status,
      writable: this.writable,
      value: this.value,
      base: this.base,
      user: this.user,
      revision: 1,
      mode: 'host',
    }
  }
}

describe('CardForm atomic save', () => {
  const batchFields = () => [numberField('size'), textField('name'), textField('url')]

  it('sends every planned write in one atomic scope.mutate call', async () => {
    const scope = new BatchScope<Record<string, unknown>>({ size: 32 })
    const form = new CardForm(scope, batchFields())
    const actions = form.actions()
    actions.edit('size', '64')
    actions.edit('name', 'hugo')
    await form.save()
    expect(scope.mutate).toHaveBeenCalledTimes(1)
    expect(scope.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['size'], value: 64 },
      { op: 'set', path: ['name'], value: 'hugo' },
    ])
    expect(scope.set).not.toHaveBeenCalled()
    expect(scope.unset).not.toHaveBeenCalled()
    expect(form.shell().dirty).toBe(false)
  })

  it('keeps every draft staged when the atomic mutation fails', async () => {
    const scope = new BatchScope<Record<string, unknown>>({ name: 'old', url: 'old-url' })
    scope.mutate.mockRejectedValue(new Error('rejected by the host validator'))
    const form = new CardForm(scope, batchFields())
    const actions = form.actions()
    actions.edit('name', 'new')
    actions.edit('url', 'new-url')
    await form.save()
    // The mutation is atomic: nothing landed, so every draft stays staged.
    expect(form.shell().failed).toBe(true)
    expect(form.shell().failedReason).toBe('rejected by the host validator')
    expect(form.shell().dirty).toBe(true)
    expect(form.field('url')).toMatchObject({ text: 'new-url' })
  })

  it('rides the same atomic mutation for secret fields without read-back comparison', async () => {
    const scope = new BatchScope<Record<string, unknown>>({ model: 'm' })
    const form = new CardForm(scope, [textField('model'), secretField('apiKey')])
    const actions = form.actions()
    actions.edit('apiKey', 'sk-secret')
    await form.save()
    expect(scope.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['apiKey'], value: 'sk-secret' }])
    expect(form.shell().failed).toBe(false)
    expect(form.shell().dirty).toBe(false)
  })

  it('clears a field with an unset operation when its draft is empty', async () => {
    const scope = new BatchScope<Record<string, unknown>>({ model: 'm', apiKey: 'existing' })
    const form = new CardForm(scope, [textField('model'), secretField('apiKey')])
    form.actions().edit('apiKey', '')
    await form.save()
    expect(scope.mutate).toHaveBeenCalledWith([{ op: 'unset', path: ['apiKey'] }])
    expect(form.shell().failed).toBe(false)
  })
})

describe('CardForm secret field (atomic path)', () => {
  it('treats a redacted secret write as landed without read-back comparison', async () => {
    const scope = new FakeScope<Record<string, unknown>>({ model: 'm' })
    // Redact the apiKey secret: the scope never reflects it into the user layer.
    scope.set.mockImplementation(async () => {})
    scope.unset.mockImplementation(async () => {})
    const form = new CardForm(scope, [textField('model'), secretField('apiKey')])
    form.actions().edit('apiKey', 'sk-secret')
    await form.save()
    expect(scope.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['apiKey'], value: 'sk-secret' }])
    expect(form.shell().failed).toBe(false)
    expect(form.shell().dirty).toBe(false)
  })
})
