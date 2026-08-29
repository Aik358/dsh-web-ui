/**
 * LAN bind toggle: the managed cordis patch block that defaults the web
 * server's bind host. On = a block pinning the host default to 0.0.0.0 (an
 * explicit --host flag still wins: the value is a !!js expression over
 * ctx.webStartup.host); off = the same block pinning the default to
 * 127.0.0.1. The harness watches the profile patch file and hot-reloads the
 * composition, so flipping the toggle re-binds the running server without a
 * restart. Until the user flips the toggle once, the plugin never touches
 * the patch file: an untouched installation keeps whatever bind the user
 * configured themselves.
 *
 * Ported from the dsh-LAN reference implementation (MIT): same block
 * markers, same toggle-block discipline, atomic file writes.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHome } from './dsh-home.ts'

export const LAN_BIND_BLOCK_BEGIN = '# --- remote-web-ui lan-bind block (managed - do not edit) ---'
export const LAN_BIND_BLOCK_END = '# --- end remote-web-ui lan-bind block ---'

/** The two bind defaults the managed block pins. */
export type LanBindHost = '0.0.0.0' | '127.0.0.1'

/** The absolute path of the profile patch file this toggle manages. */
export function profilePatchFile(profile: string, home: string = dshHome()): string {
  return join(home, 'profiles', profile, 'cordis.patch.yml')
}

function readPatchContent(file: string): string {
  if (!existsSync(file)) return ''
  return readFileSync(file, 'utf8')
}

/** Escape one literal string for embeddin into a RegExp pattern. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Remove the managed block (and its markers) from patch content. */
export function stripManagedBlock(content: string): string {
  const begin = escapeRegex(LAN_BIND_BLOCK_BEGIN)
  const end = escapeRegex(LAN_BIND_BLOCK_END)
  const pattern = new RegExp(`\\r?\\n?${begin}[\\s\\S]*?${end}\\r?\\n?`, 'g')
  return content.replace(pattern, '\n')
}

/** Render the managed block for one bind default. */
export function managedBlock(host: LanBindHost): string {
  return [
    LAN_BIND_BLOCK_BEGIN,
    '- id: webserver',
    '  config:',
    `    host: !!js ctx.webStartup.host ?? '${host}'`,
    '    port: !!js ctx.webStartup.port ?? 3080',
    LAN_BIND_BLOCK_END,
    '',
  ].join('\n')
}

/**
 * The bind default the managed block currently pins, or undefined when the
 * file carries no managed block. A block whose host line was hand-edited to
 * something else reports the literal as-is so the card can surface it
 * instead of silently claiming one of the two known states.
 */
export function managedBlockHost(content: string): LanBindHost | (string & {}) | undefined {
  const begin = content.indexOf(LAN_BIND_BLOCK_BEGIN)
  if (begin === -1) return undefined
  const end = content.indexOf(LAN_BIND_BLOCK_END, begin)
  const block = end === -1 ? content.slice(begin) : content.slice(begin, end)
  const match = /host:\s*!!js ctx\.webStartup\.host \?\? '([^']+)'/.exec(block)
  return match?.[1]
}

/** Full file-level state: whether the block exists and what it pins. */
export function lanBindState(profile: string, home: string = dshHome()): { blockPresent: boolean; host?: string } {
  const content = readPatchContent(profilePatchFile(profile, home))
  const host = managedBlockHost(content)
  return { blockPresent: host !== undefined, host }
}

/**
 * Write (or rewrite) the managed block with the given bind default. The rest
 * of the patch file is preserved byte-for-byte; the block is appended at the
 * end via temp-file + rename so a crash never leaves a torn patch behind.
 */
export function writeLanBind(host: LanBindHost, profile: string, home: string = dshHome()): void {
  const file = profilePatchFile(profile, home)
  const content = `${stripManagedBlock(readPatchContent(file)).trimEnd()}\\n\\n${managedBlock(host)}`
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.remote-web-ui-tmp`
  writeFileSync(temp, content)
  renameSync(temp, file)
}
