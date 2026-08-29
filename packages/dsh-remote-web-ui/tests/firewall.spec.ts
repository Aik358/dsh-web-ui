/** Firewall backend detection and summary semantics with a fake runner. */
import { describe, expect, it } from 'vitest'
import { detectFirewallBackend, type CommandRunner, type ToolResult } from '../src/firewall.ts'

/** A runner scripted per command prefix. */
function fakeRunner(responses: Record<string, ToolResult>): CommandRunner {
  return (cmd, args) => {
    const key = [cmd, ...args].join(' ')
    for (const [pattern, result] of Object.entries(responses)) {
      if (key.includes(pattern)) return result
    }
    return { ok: false, out: '', err: 'not scripted' }
  }
}

describe('detectFirewallBackend', () => {
  it('uses netsh on Windows', () => {
    const backend = detectFirewallBackend('win32', fakeRunner({ netsh: { ok: true, out: '', err: '' } }))
    expect(backend?.label).toBe('netsh')
  })

  it('prefers a running firewalld, then ufw, then iptables on Linux', () => {
    const firewalld = detectFirewallBackend('linux', fakeRunner({
      'firewall-cmd --state': { ok: true, out: 'running', err: '' },
    }))
    expect(firewalld?.label).toBe('firewalld')
    const ufw = detectFirewallBackend('linux', fakeRunner({
      'firewall-cmd --state': { ok: false, out: '', err: 'not running' },
      'ufw --version': { ok: true, out: 'ufw 0.36', err: '' },
    }))
    expect(ufw?.label).toBe('ufw')
    const iptables = detectFirewallBackend('linux', fakeRunner({
      'firewall-cmd --state': { ok: false, out: '', err: 'not running' },
      ufw: { ok: false, out: '', err: '', missing: true },
    }))
    expect(iptables?.label).toBe('iptables')
  })

  it('skips an installed-but-idle firewalld', () => {
    const backend = detectFirewallBackend('linux', fakeRunner({
      'firewall-cmd --state': { ok: false, out: '', err: 'FirewallD is not running' },
    }))
    // No ufw/iptables scripted => falls through to the (always-scriptable)
    // iptables backend in the fake; the point is it is NOT firewalld.
    expect(backend?.label).not.toBe('firewalld')
  })

  it('reports nothing to manage on macOS', () => {
    expect(detectFirewallBackend('darwin', fakeRunner({}))).toBeUndefined()
  })
})

describe('rule maintenance (netsh shape)', () => {
  it('recreates the rule delete-and-add, and removes it when LAN turns off', () => {
    const calls: string[] = []
    let exists = false
    const run: CommandRunner = (cmd, args) => {
      const key = [cmd, ...args].join(' ')
      calls.push(key)
      if (key.includes('show rule')) return { ok: exists, out: '', err: '' }
      if (key.includes('delete rule')) {
        exists = false
        return { ok: true, out: '', err: '' }
      }
      if (key.includes('add rule')) {
        exists = true
        return { ok: true, out: '', err: '' }
      }
      return { ok: false, out: '', err: 'unexpected' }
    }
    const backend = detectFirewallBackend('win32', run)
    expect(backend).toBeDefined()
    expect(backend?.addRule(3080)).toBe(true)
    expect(calls.some(key => key.includes('localport=3080'))).toBe(true)
    expect(backend?.ruleExists(3080)).toBe(true)
    expect(backend?.removeRule(3080)).toBe(true)
    expect(exists).toBe(false)
  })
})
