import { computed, inject, Injector, type Signal } from '@angular/core';
import type { PtahUiHostSources } from '@ptah-extension/chat-ui';
import type { LiveModelStatsPayload } from '@ptah-extension/chat-state';
import { SubagentExecutionStore } from '@ptah-extension/chat-streaming';
import type {
  ContextCapacity,
  ExecutionChatMessage,
  ExecutionNode,
} from '@ptah-extension/shared';
import { collectTurnAgentFacts } from './transcript-agent-facts';

/** One transcript slot: its current message record (a signal on the default path). */
export interface TranscriptHostSourceSlot {
  readonly record: () => ExecutionChatMessage;
}

/** What the transcript hands its host sources. */
export interface TranscriptPtahUiHostSourcesInput {
  readonly tabId: Signal<string>;
  readonly sessionId: Signal<string | null>;
  /**
   * The transcript's slots (`vm().slots`). The records are read per slot, so a
   * content-only streaming write reaches `turnFacts`; `vm().messages` changes
   * only on a structural change (decision #94) and must not be used.
   */
  readonly slots: Signal<readonly TranscriptHostSourceSlot[]>;
  /** Trees not yet persisted on their assistant message records. */
  readonly activeTrees: Signal<readonly ExecutionNode[]>;
  /** The tab's live model stats; the only source of a context capacity. */
  readonly liveModelStats: Signal<LiveModelStatsPayload | null>;
}

const NO_CAPACITIES: readonly ContextCapacity[] = Object.freeze([]);

/**
 * The transcript's `PTAH_UI_HOST_SOURCES` (TASK_2026_623, components 7 and 9):
 * per-tab live facts that lazy chat-ui code (the `ptah-ui` block and the
 * display sync) reads without importing `chat`.
 *
 * Each transcript builds its own instance from its own inputs and provides
 * it in its `providers`, so a display sync mounted in that transcript's
 * template resolves this tab's sources and never another tab's (decision #81).
 *
 * - `turnFacts`: `collectTurnAgentFacts` over the current records.
 * - `turnIndexOf(messageId)`: the same turn rule as `turnFacts` and a display
 *   candidate's `turnKey`. Index `i` is the turn opened by the `i`-th user
 *   message (from 0), so it addresses `turnFacts()[i]`; a message before the
 *   first user message, or one the transcript does not hold, is `null`. It
 *   reads a signal, so a reactive caller re-runs when turns change. O(1).
 * - `capacities`: `[liveModelStats.contextCapacity]` when the tab has one,
 *   `[]` otherwise (decision #54). `$agents` reads only this list.
 *
 * Construct in an injection context (the transcript display feed does this).
 */
export function createTranscriptPtahUiHostSources(
  input: TranscriptPtahUiHostSourcesInput,
): PtahUiHostSources {
  const injector = inject(Injector);
  const records = computed(() => input.slots().map((slot) => slot.record()));
  const turnFacts = computed(() =>
    collectTurnAgentFacts(records(), input.activeTrees(), (key) => {
      const store = injector.get(SubagentExecutionStore);
      store.entries();
      return store.treeFor(key);
    }),
  );
  const turnIndexByMessage = computed(() => turnIndexes(records()));
  const contextCapacity = computed(
    () => input.liveModelStats()?.contextCapacity ?? null,
  );
  const capacities = computed((): readonly ContextCapacity[] => {
    const capacity = contextCapacity();
    return capacity === null ? NO_CAPACITIES : [capacity];
  });
  return {
    tabId: input.tabId,
    sessionId: input.sessionId,
    turnFacts,
    turnIndexOf: (messageId) => turnIndexByMessage().get(messageId) ?? null,
    capacities,
  };
}

/**
 * Message id -> turn index. A user message opens the next turn; every later
 * message belongs to it until the next user message. Messages before the
 * first user message are absent (no turn).
 */
function turnIndexes(
  messages: readonly ExecutionChatMessage[],
): ReadonlyMap<string, number> {
  const indexes = new Map<string, number>();
  let turn = -1;
  for (const message of messages) {
    if (message.role === 'user') turn += 1;
    if (turn >= 0) indexes.set(message.id, turn);
  }
  return indexes;
}
