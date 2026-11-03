import {
  Injector,
  computed,
  effect,
  inject,
  untracked,
  type Signal,
} from '@angular/core';
import type {
  ArtifactRecord,
  ExecutionChatMessage,
  ExecutionNode,
} from '@ptah-extension/shared';
import { ArtifactStore } from '../../../services/artifact.store';
import {
  publishedArtifactFromNode,
  type PublishedArtifact,
} from '../../../services/artifacts/published-artifact';
import { DisplayDockState } from '../../../services/display-dock/display-dock.state';
import { groupTurns } from './transcript-turns';

/** The part of the transcript's gated view model the reply cards read. */
export interface TranscriptTurnArtifactsView {
  readonly slots: readonly { readonly record: () => ExecutionChatMessage }[];
  readonly streamingBoundary: number;
}

/** What the transcript hands its reply cards. */
export interface TranscriptTurnArtifactsInput {
  /** The transcript's own tab: Open targets it, never the global active tab. */
  readonly tabId: Signal<string>;
  /** The transcript's gated `vm`: frozen while the tab is hidden. */
  readonly view: Signal<TranscriptTurnArtifactsView>;
}

/** Turn-ending message id -> the artifacts that turn published, in order. */
export type TurnArtifactAnchors = ReadonlyMap<string, readonly PublishedArtifact[]>;

const NO_ANCHORS: TurnArtifactAnchors = new Map();
const NO_ARTIFACTS: readonly PublishedArtifact[] = [];

/**
 * The reply cards of one transcript (TASK_2026_853_3401, plan C): one card per
 * artifact a finalized turn published, rendered after the turn's last
 * assistant message, the same anchor as the turn summary chip.
 *
 * - Source: complete, non-error `ptah_artifact_publish` nodes, found by a
 *   depth-first walk of each finalized turn's roots (`groupTurns`), in
 *   execution order. A still-streaming turn has no card yet.
 * - A finalized message's tree no longer changes, so its walk is cached by
 *   message identity; a streaming tick re-walks nothing that settled.
 * - Each new artifact id is passed once to `ArtifactStore.adoptPublishResult`,
 *   so a card resolves its record after a restart or in a tile whose session
 *   is not live (`artifacts:list` returns none there).
 * - Open and Full screen write to the dock of this transcript's `tabId`
 *   (bug A: never `activeTabId()`). Without a dock (VS Code, lanes) the card
 *   is read-only.
 *
 * Construct in an injection context (a component field initializer). The
 * artifact store is resolved only once an artifact exists, so a transcript
 * without artifacts never instantiates it.
 */
export class TranscriptTurnArtifacts {
  private readonly dock = inject(DisplayDockState, { optional: true });
  private readonly injector = inject(Injector);
  private readonly walked = new WeakMap<ExecutionChatMessage, readonly PublishedArtifact[]>();
  private readonly adopted = new Set<string>();
  private store: ArtifactStore | null = null;

  /** Open and Full screen work only with a dock to open. */
  readonly openable = this.dock !== null;

  /** The reply cards of each turn-ending message id. */
  readonly byEndMessage: Signal<TurnArtifactAnchors>;

  constructor(private readonly source: TranscriptTurnArtifactsInput) {
    this.byEndMessage = computed(() => this.collect(), { equal: sameAnchors });
    effect(() => {
      const anchors = this.byEndMessage();
      untracked(() => this.adoptNew(anchors));
    });
  }

  /** The stored record of a card's artifact; reactive in a template or computed. */
  record(artifactId: string): ArtifactRecord | null {
    return this.artifactStore().recordById(artifactId);
  }

  /** The card's Open: the dock of this transcript's tab selects the artifact. */
  open(artifactId: string): void {
    this.dock?.openArtifact(this.source.tabId(), artifactId);
  }

  /** The card's Full screen: opens it, then asks for the full-screen viewer. */
  fullscreen(artifactId: string): void {
    const dock = this.dock;
    if (dock === null) return;
    const tabId = this.source.tabId();
    dock.openArtifact(tabId, artifactId);
    dock.requestFullscreenArtifact(tabId, artifactId);
  }

  private collect(): TurnArtifactAnchors {
    const view = this.source.view();
    if (view.slots.length === 0) return NO_ANCHORS;
    const records = view.slots.map((slot) => slot.record());
    let anchors: Map<string, readonly PublishedArtifact[]> | null = null;
    for (const turn of groupTurns(records, view.streamingBoundary)) {
      if (!turn.finalized) continue;
      const published: PublishedArtifact[] = [];
      for (const message of turn.assistants) {
        published.push(...this.walk(message));
      }
      if (published.length === 0) continue;
      anchors ??= new Map();
      anchors.set(turn.endMessageId, published);
    }
    return anchors ?? NO_ANCHORS;
  }

  /** One finalized message's published artifacts, depth-first in execution order. */
  private walk(message: ExecutionChatMessage): readonly PublishedArtifact[] {
    const cached = this.walked.get(message);
    if (cached !== undefined) return cached;
    const root = message.streamingState;
    const found: PublishedArtifact[] = [];
    if (root !== null) {
      const visit = (node: ExecutionNode): void => {
        const published = publishedArtifactFromNode(node);
        if (published !== null) found.push(published);
        for (const child of node.children) visit(child);
      };
      visit(root);
    }
    const result = found.length === 0 ? NO_ARTIFACTS : found;
    this.walked.set(message, result);
    return result;
  }

  private adoptNew(anchors: TurnArtifactAnchors): void {
    for (const artifacts of anchors.values()) {
      for (const artifact of artifacts) {
        // Keyed by revision too: a republish under the same id is a new record.
        const key = `${artifact.id}@${String(artifact.result['revision'])}`;
        if (this.adopted.has(key)) continue;
        this.adopted.add(key);
        void this.artifactStore().adoptPublishResult(artifact.result);
      }
    }
  }

  private artifactStore(): ArtifactStore {
    this.store ??= this.injector.get(ArtifactStore);
    return this.store;
  }
}

/** Same turns with the same artifact ids keep the previous map (no re-render). */
function sameAnchors(left: TurnArtifactAnchors, right: TurnArtifactAnchors): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [key, artifacts] of left) {
    const other = right.get(key);
    if (
      other === undefined ||
      other.length !== artifacts.length ||
      !artifacts.every(
        (artifact, index) =>
          artifact.id === other[index].id &&
          artifact.title === other[index].title &&
          artifact.result['revision'] === other[index].result['revision'],
      )
    ) {
      return false;
    }
  }
  return true;
}
