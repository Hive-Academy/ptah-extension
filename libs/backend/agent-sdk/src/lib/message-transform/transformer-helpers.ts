import type {
  Logger,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import type { IModelResolver } from '../auth-env.port';
import type { SessionLifecycleManager } from '../helpers/session-lifecycle-manager';
import type { LiveUsageTracker } from '../helpers/live-usage-tracker';
import type { SessionTurnStateRegistry } from '../helpers/session-turn-state.registry';

export interface TransformerHelpers {
  readonly logger: Logger;
  readonly subagentRegistry: SubagentRegistryService;
  readonly modelResolver: IModelResolver;
  readonly sessionLifecycle: SessionLifecycleManager;
  readonly usageTracker: LiveUsageTracker;
  /** Per-session turn state; producers emit `turn_state` events from it. */
  readonly turnState: SessionTurnStateRegistry;
}
