/**
 * Ptah CLI Module - Barrel exports
 *
 * @see TASK_2025_167 Batch 2 - Ptah CLI Adapter + Registry
 * @see TASK_2025_176 - PtahCliRegistry refactoring
 */

export { PtahCliAdapter } from './ptah-cli-adapter';
export type { PtahCliPremiumConfig } from './ptah-cli-adapter';
export { PtahCliRegistry } from './ptah-cli-registry';
export type { SpawnAgentFailure } from './ptah-cli-registry';

// Extracted helper services (TASK_2025_176)
export { PtahCliConfigPersistence } from './helpers';
export { PtahCliSpawnOptions, type PtahSpawnAssembly } from './helpers';
export { PtahCliStreamLoop, type PtahCliStreamLoopConfig } from './helpers';
export {
  PTAH_CLI_KEY_PREFIX,
  PTAH_CLI_AGENTS_CONFIG_KEY,
  generateAgentId,
  summarizeToolInput,
  sanitizeErrorMessage,
} from './helpers';
