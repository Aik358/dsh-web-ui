/**
 * Standalone tsdown config for the dsh-miku-pet plugin.
 *
 * Uses the repo's shared client-bundle preset (shared/tsdown.client.ts):
 * closure-factory artifact for window.__ModuleLoader__, CSS Modules inlined,
 * externals resolved through the loader module table. The node half builds
 * from src and types ship from lib/types (tsc).
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-miku-pet', ['src/index.ts'], {
  libExternal: ['@deepseek-ai/dsh-home-paths'],
})
