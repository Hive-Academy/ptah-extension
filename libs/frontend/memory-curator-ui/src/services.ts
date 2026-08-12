/**
 * Memory Curator UI - Services-only entry point
 *
 * Lightweight barrel that exports only services (no components). Use this
 * import path when you need memory-curator services without pulling the memory
 * tab components — and the Thoth shell graph behind them — into the bundle:
 *
 *   import { VecEmbedderRecoveryService } from '@ptah-extension/memory-curator-ui/services';
 *
 * For components, use the main entry point:
 *
 *   import { MemoryCuratorTabComponent } from '@ptah-extension/memory-curator-ui';
 *
 * `VecEmbedderRecoveryService` is a `MESSAGE_HANDLERS` entry constructed at
 * bootstrap to receive vec-embedder recovery push messages — it must stay
 * EAGER. Only the components are deferred (TASK_2026_187, I-3/R4).
 */

export {
  VecEmbedderRecoveryService,
  type RecoveryToast,
} from './lib/services/vec-embedder-recovery.service';
export { MemoryRpcService } from './lib/services/memory-rpc.service';
