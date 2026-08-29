/** The managed lan-bind patch block: parse, strip, and write semantics. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LAN_BIND_BLOCK_BEGIN, LAN_BIND_BLOCK_END, lanBindState, managedBlock, managedBlockHost, stripManagedBlock, writeLanBind } from '../src/lan-bind.ts'

const tempDirs: string[] = []

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'remote-web-ui-lan-bind-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('managedBlockHost', () => {
  it('parses the pinned host out of the block', () => {
    expect(managedBlockHost(managedBlock('0.0.0.0'))).toBe('0.0.0.0')
    expect(managedBlockHost(managedBlock('127.0.0.1'))).toBe('127.0.0.1')
  })

  it('returns undefined without a managed block', () => {
    expect(managedBlockHost('- id: other\n  config:\n    host: 0.0.0.0\n')).toBeUndefined()
    expect(managedBlockHost('')).toBeUndefined()
  })

  it('surfaces a hand-edited host instead of claiming a known state', () => {
    const handEdited = managedBlock('0.0.0.0').replace("'0.0.0.0'", "'192.168.1.5'")
    expect(managedBlockHost(handEdited)).toBe('192.168.1.5')
  })
})

describe('stripManagedBlock', () => {
  it('removes the block and keeps surrounding content byte-identical', () => {
    const before = '- id: a\n  config:\n    x: 1\n'
    const content = `${before}${LAN_BIND_BLOCK_BEGIN}\n- id: webserver\n  config:\n    host: !!js ctx.webStartup.host ?? '0.0.0.0'\n${LAN_BIND_BLOCK_END}\n- id: b\n`
    expect(stripManagedBlock(content)).toBe(`${before}- id: b\n`)
  })

  it('leaves content without a block untouched', () => {
    const content = '- id: only\n'
    expect(stripManagedBlock(content)).toBe(content)
  })
})

describe('writeLanBind / lanBindState', () => {
  it('appends the block, preserves other rows, and rewrites in place', () => {
    const home = tempHome()
    const patch = join(home, 'profiles', 'web', 'cordis.patch.yml')
    mkdirSync(join(home, 'profiles', 'web'), { recursive: true })
    writeFileSync(patch, '- insert:\n    - id: remote-web-ui\n      name: \'@linxin666/dsh-remote-web-ui\'\n')
    writeLanBind('0.0.0.0', 'web', home)
    const afterOn = readFileSync(patch, 'utf8')
    expect(afterOn).toContain('- id: remote-web-ui')
    expect(managedBlockHost(afterOn)).toBe('0.0.0.0')
    expect(lanBindState('web', home)).toEqual({ blockPresent: true, host: '0.0.0.0' })
    // Flipping rewrites the same block (no duplication).
    writeLanBind('127.0.0.1', 'web', home)
    const afterOff = readFileSync(patch, 'utf8')
    expect(managedBlockHost(afterOff)).toBe('127.0.0.1')
    expect(afterOff.split(LAN_BIND_BLOCK_BEGIN)).toHaveLength(2)
    expect(lanBindState('web', home)).toEqual({ blockPresent: true, host: '127.0.0.1' })
  })

  it('reports a missing file as untouched', () => {
    const home = tempHome()
    expect(lanBindState('web', home)).toEqual({ blockPresent: false, host: undefined })
  })

  it('leaves no temp file behind', () => {
    const home = tempHome()
    writeLanBind('0.0.0.0', 'web', home)
    expect(lanBindState('web', home).blockPresent).toBe(true)
  })
})
