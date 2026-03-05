/**
 * Ptah CLI Helpers - Barrel exports
 *
 * Services extracted from PtahCliRegistry for better maintainability
 * and single responsibility.
 *
 * @see TASK_2025_176 - PtahCliRegistry refactoring
 */

// Pure utility functions and constants
export {
  PTAH_CLI_KEY_PREFIX,
  PTAH_CLI_AGENTS_CONFIG_KEY,
  generateAgentId,
  summarizeToolInput,
  sanitizeErrorMessage,
} from './ptah-cli-registry.utils';

// Config persistence (injectable singleton)
export { PtahCliConfigPersistence } from './ptah-cli-config-persistence.service';

// Spawn options assembly (injectable singleton)
export {
  PtahCliSpawnOptions,
  type PtahSpawnAssembly,
} from './ptah-cli-spawn-options.service';

// Stream processing loop (per-call plain class)
export {
  PtahCliStreamLoop,
  type PtahCliStreamLoopConfig,
} from './ptah-cli-stream-loop.service';
