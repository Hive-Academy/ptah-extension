/**
 * Configuration Module - Public API
 * Exports ConfigManager service and related types
 */

export { ConfigManager } from './config-manager';
export type {
  ConfigurationChangeEvent,
  IFileSettingsStore,
} from './config-manager';
export type {
  ConfigWatcher,
  ConfigurationSchema,
  ConfigUpdateOptions,
} from './types';
