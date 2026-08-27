/**
 * tsdown config for the better-session-manager package.
 *
 * Three artifacts share lib/:
 * - lib/index.js — node half (this preset's primary entry), route registration.
 * - lib/client.js — browser half (closure-factory artifact for the loader).
 * - lib/better-session-import.js — standalone import runner (companion below):
 *   spawned as its own process by the host half so log decoding never blocks
 *   the server event loop, and imported directly by scripts/dsh-better-
 *   session.mjs. Node-only: node:zlib / node:sqlite stay bundled-external via
 *   platform detection (platform 'node').
 */
import { clientBundle } from '../../shared/tsdown.client.ts'
import type { UserConfig } from 'tsdown'

const importRunner: UserConfig = {
  name: '@linxin666/dsh-client-ui-better-session-manager/better-session-import',
  entry: { 'better-session-import': 'src/core/import-worker-entry.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
}

export default clientBundle('@linxin666/dsh-client-ui-better-session-manager', ['src/index.ts'], {
  companions: [importRunner],
})
