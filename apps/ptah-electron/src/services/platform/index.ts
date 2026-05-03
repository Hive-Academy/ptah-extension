/**
 * Electron Platform Implementations (TASK_2025_203)
 *
 * Platform-specific implementations of the abstraction interfaces
 * defined in @ptah-extension/rpc-handlers.
 */

export { ElectronPlatformCommands } from './electron-platform-commands';
export { ElectronPlatformAuth } from './electron-platform-auth';
export { ElectronSaveDialog } from './electron-save-dialog';
export { ElectronModelDiscovery } from './electron-model-discovery';
// === TRACK_3_CRON_SCHEDULER_BEGIN ===
export { ElectronPowerMonitor } from './electron-power-monitor';
// === TRACK_3_CRON_SCHEDULER_END ===
