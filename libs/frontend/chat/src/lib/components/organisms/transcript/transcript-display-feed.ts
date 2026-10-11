import { computed, effect, inject, untracked, type Signal } from '@angular/core';
import type { DisplayCandidate } from '@ptah-extension/chat-ui/display-panel';
import type { PtahUiHostSources } from '@ptah-extension/chat-ui';
import type { TabState } from '@ptah-extension/chat-types';
import type {
  ExecutionChatMessage,
  TurnChangeSet,
} from '@ptah-extension/shared';
import type { ChangeSetMarks } from '../../../services/change-set/change-set.store';
import { DisplayDockState } from '../../../services/display-dock/display-dock.state';
import { collectDisplayCandidates } from './transcript-display-candidates';
import { createTranscriptPtahUiHostSources } from './transcript-ptah-ui-host-sources';
import { TranscriptTurnSummaries } from './transcript-turn-summaries';
import type { TurnSnapshots } from './transcript-turn-snapshots';

/** The part of the transcript's gated view model the feed reads. */
export interface TranscriptDisplayView {
  readonly slots: readonly {
    readonly id: string;
    readonly record: () => ExecutionChatMessage;
  }[];
  readonly streamingBoundary: number;
}

/** What the transcript hands its display feed. */
export interface TranscriptDisplayFeedInput {
  /** Electron only [user scope]; the VS Code webview computes nothing (R1.14). */
  readonly enabled: boolean;
  readonly tabId: Signal<string>;
  /** The tab: its session id and live model stats (the context capacity). */
  readonly tab: Signal<TabState | null>;
  /** The transcript's gated `vm`: frozen while the tab is hidden. */
  readonly view: Signal<TranscriptDisplayView>;
  /** The transcript's `ptahUiSnapshots`. */
  readonly snapshots: Signal<TurnSnapshots>;
  /** The tab streams (`streaming` or `resuming`); read from the tab, ungated. */
  readonly streaming: Signal<boolean>;
  /** The tab's finalized messages, compaction noise filtered; ungated. */
  readonly finalized: Signal<readonly ExecutionChatMessage[]>;
  readonly marksFor: (changeSet: TurnChangeSet) => ChangeSetMarks;
}

const NO_CANDIDATES: readonly DisplayCandidate[] = [];

/**
 * The display-panel feed of one transcript (TASK_2026_623, component 7): what
 * the transcript provides, mounts and publishes for its tab's dock.
 *
 * - `hostSources`: this transcript's `PTAH_UI_HOST_SOURCES` (component 9,
 *   decision #102). The transcript provides it in its own `providers`, so
 *   every `ptah-ui` block and the display sync under it read this tab's turn
 *   facts and capacity, never another tab's (decision #81).
 * - `candidates`: the display sync's input (D3), built from each slot's
 *   CURRENT record, never `vm().messages`: on the presentation-records path
 *   `messages` changes only on a structural change while a streaming text
 *   write updates its record signal alone, so reading the records makes a
 *   display fence appear as it streams (R2.7, decision #94). The previous
 *   result is passed back, so a tick that touches no display text keeps the
 *   same array and the sync does not re-run (#95).
 * - `summaries`: the turn summary chips and the dock's summary map (R6).
 * - The live turn (decision #99): the last user message's id while the tab
 *   streams, `null` otherwise, published to the dock so a user close records
 *   the turn (R1.8). Read from the tab, not the gated view, so a turn that
 *   ends while the tab is hidden still clears.
 *
 * One instance per transcript; no module-level state. Construct in an
 * injection context (a component field initializer).
 */
export class TranscriptDisplayFeed {
  private readonly dock = inject(DisplayDockState, { optional: true });
  readonly enabled: boolean;
  readonly hostSources: PtahUiHostSources;
  readonly summaries: TranscriptTurnSummaries;
  readonly candidates: Signal<readonly DisplayCandidate[]>;
  /** The last candidates; one per instance (the `_allMessagesCache` pattern). */
  private previousCandidates: readonly DisplayCandidate[] = NO_CANDIDATES;

  constructor(input: TranscriptDisplayFeedInput) {
    this.enabled = input.enabled;
    const slots = computed(() => input.view().slots);
    this.hostSources = createTranscriptPtahUiHostSources({
      tabId: input.tabId,
      sessionId: computed(() => input.tab()?.claudeSessionId ?? null),
      slots,
      liveModelStats: computed(() => input.tab()?.liveModelStats ?? null),
    });
    this.candidates = computed((): readonly DisplayCandidate[] => {
      if (!input.enabled) return NO_CANDIDATES;
      const view = input.view();
      const records = view.slots.map((slot) => slot.record());
      const next = collectDisplayCandidates(
        records,
        view.streamingBoundary,
        this.previousCandidates,
      );
      this.previousCandidates = next;
      return next;
    });
    this.summaries = new TranscriptTurnSummaries({
      tabId: input.tabId,
      slots,
      snapshots: input.snapshots,
      marksFor: input.marksFor,
    });
    this.publishLiveTurn(input);
  }

  private publishLiveTurn(input: TranscriptDisplayFeedInput): void {
    const dock = this.dock;
    if (dock === null) return;
    const liveTurnKey = computed((): string | null => {
      if (!input.streaming()) return null;
      const messages = input.finalized();
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === 'user') return messages[index].id;
      }
      return null;
    });
    effect(() => {
      const tabId = input.tabId();
      const turnKey = liveTurnKey();
      untracked(() => {
        if (dock.tab(tabId).liveTurnKey !== turnKey) {
          dock.setLiveTurn(tabId, turnKey);
        }
      });
    });
  }
}
