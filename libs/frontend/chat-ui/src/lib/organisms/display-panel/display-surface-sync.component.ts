import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import type {
  CompilePtahUiBlockResult,
  CompiledPtahUiBlock,
  PtahUiAgentsInput,
  PtahUiLimitsInput,
  RenderPtahUiBlockResult,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { TurnSourceSnapshot } from '@ptah-extension/shared';
import {
  PTAH_UI_DISPLAY_DOCK_SYNC,
  type PtahUiDisplayDockSync,
} from '../../services/ptah-ui-display-dock';
import { PTAH_UI_HOST_SOURCES } from '../../services/ptah-ui-host-sources';
import {
  PTAH_UI_BLOCK_LIVE_SOURCES,
  PTAH_UI_BLOCK_PIPELINE,
} from '../ptah-ui/ptah-ui-block.component';
import {
  applyDisplayFences,
  compileDisplayFences,
  displayFenceSources,
  type CompiledDisplayFence,
  type DisplayCandidate,
  type DisplayCompile,
  type DisplaySurfacesResult,
} from './display-surfaces';

/** Turn-source snapshots by message id (the transcript's `ptahUiSnapshots`). */
export type DisplayTurnSnapshots = ReadonlyMap<string, TurnSourceSnapshot>;

const NO_SNAPSHOTS: DisplayTurnSnapshots = new Map();
const UTF8 = new TextEncoder();

function utf8JsonBytes(value: unknown): number {
  return UTF8.encode(JSON.stringify(value)).length;
}

/** The inputs one resolve read; an identical set reuses its result. */
interface ResolveEntry {
  readonly compiled: CompiledPtahUiBlock;
  readonly snapshot: TurnSourceSnapshot | null;
  readonly agents: PtahUiAgentsInput | null;
  readonly limits: PtahUiLimitsInput | null;
  readonly result: RenderPtahUiBlockResult;
}

/**
 * DisplaySurfaceSyncComponent - the headless display sync of one transcript
 * (TASK_2026_623, D3, D10-D12, component 5).
 *
 * - Segments the transcript's display candidates and compiles each closed
 *   display fence once per surface id and body (D5); unclosed fences yield
 *   nothing (R2.7).
 * - Resolves them in R2.8 order against the sources each names (the message's
 *   turn snapshot, the turn's live `$agents`, the shared `$limits` read, held
 *   only while some fence names it), applies the id rule and the cap through
 *   the pure `applyDisplayFences`, and publishes surfaces and per-fence
 *   statuses to the dock store through `PTAH_UI_DISPLAY_DOCK_SYNC`.
 * - D12: asks the store to auto-open only for a fence that is applied, in a
 *   `live` candidate, and not yet in the tab's `seenBlockKeys`; every fence it
 *   publishes is then marked seen, so a remount never re-triggers. It never
 *   touches focus (R1.7) and never handles the turn summary (R1.10).
 * - Without the dock-sync provider it does nothing: no compile, no source
 *   read, no throw.
 */
@Component({
  selector: 'ptah-display-surface-sync',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
export class DisplaySurfaceSyncComponent {
  private readonly dock = inject(PTAH_UI_DISPLAY_DOCK_SYNC, { optional: true });
  private readonly hostSources = inject(PTAH_UI_HOST_SOURCES, {
    optional: true,
  });
  private readonly pipeline = inject(PTAH_UI_BLOCK_PIPELINE);
  private readonly liveSources = inject(PTAH_UI_BLOCK_LIVE_SOURCES, {
    optional: true,
  });

  /** The chat tab whose dock the sync writes. */
  readonly tabId = input.required<string>();
  /** The transcript's display candidates, in transcript order. */
  readonly candidates = input.required<readonly DisplayCandidate[]>();
  /** Turn-source snapshots by message id; a missing entry is `unavailable`. */
  readonly snapshots = input<DisplayTurnSnapshots>(NO_SNAPSHOTS);

  /** Compile results of the latest pass, by `surfaceId NUL body`. */
  private compileCache = new Map<string, CompilePtahUiBlockResult>();
  /** Resolve results of the latest pass, by fence key. */
  private resolveCache = new Map<string, ResolveEntry>();
  /** One `$agents` signal per turn index a fence of the latest pass named. */
  private agentsByTurn = new Map<number, Signal<PtahUiAgentsInput>>();
  /** The acquired `$limits` read; `null` while the sync holds none. */
  private readonly limitsHeld = signal<Signal<PtahUiLimitsInput> | null>(null);

  /** Closed display fences, compiled; re-runs only when the candidates change. */
  private readonly fences = computed((): readonly CompiledDisplayFence[] => {
    const next = new Map<string, CompilePtahUiBlockResult>();
    const compile: DisplayCompile = (body, surfaceId) => {
      const key = `${surfaceId}\u0000${body}`;
      const result =
        next.get(key) ??
        this.compileCache.get(key) ??
        this.pipeline.compile(body, surfaceId);
      next.set(key, result);
      return result;
    };
    const fences = compileDisplayFences(this.candidates(), compile);
    // Only the bodies still on screen stay cached, so the cache never grows
    // past the transcript's own fences.
    this.compileCache = next;
    return fences;
  });

  private readonly usesLimits = computed(() =>
    displayFenceSources(this.fences()).has('limits'),
  );

  /** The panel: fences resolved and applied over the dock's last surfaces (D10). */
  private readonly result = computed((): DisplaySurfacesResult => {
    const fences = this.fences();
    const tabId = this.tabId();
    const dock = this.dock;
    const previous =
      dock === null ? null : untracked(() => dock.surfaces(tabId));
    const nextResolves = new Map<string, ResolveEntry>();
    const nextAgents = new Map<number, Signal<PtahUiAgentsInput>>();
    const result = applyDisplayFences(
      fences,
      (compiled, candidate, fenceKey) =>
        this.resolveFence(
          compiled,
          candidate,
          fenceKey,
          nextResolves,
          nextAgents,
        ),
      previous,
    );
    this.resolveCache = nextResolves;
    this.agentsByTurn = nextAgents;
    return result;
  });

  constructor() {
    if (this.dock === null) return;
    const dock = this.dock;
    // Registered before the publish effect, so a first pass that names
    // `$limits` resolves against the held read rather than "unavailable".
    effect(() => {
      const wanted = this.usesLimits();
      untracked(() => this.holdLimits(wanted));
    });
    effect(() => {
      const tabId = this.tabId();
      const result = this.result();
      untracked(() => publish(dock, tabId, result));
    });
    inject(DestroyRef).onDestroy(() => this.holdLimits(false));
  }

  /** Resolves one fence over the sources it names; unchanged inputs reuse the result. */
  private resolveFence(
    compiled: CompiledPtahUiBlock,
    candidate: DisplayCandidate,
    fenceKey: string,
    nextResolves: Map<string, ResolveEntry>,
    nextAgents: Map<number, Signal<PtahUiAgentsInput>>,
  ): RenderPtahUiBlockResult {
    const used = compiled.usedSources;
    const snapshot =
      used.has('diff') || used.has('tests') || used.has('usage')
        ? (this.snapshots().get(candidate.messageId) ?? null)
        : null;
    const agents = used.has('agents')
      ? this.agentsFor(candidate.messageId, nextAgents)
      : null;
    const held = used.has('limits') ? this.limitsHeld() : null;
    const limits = held === null ? null : held();

    const previous = this.resolveCache.get(fenceKey);
    const result =
      previous !== undefined &&
      previous.compiled === compiled &&
      previous.snapshot === snapshot &&
      previous.agents === agents &&
      previous.limits === limits
        ? previous.result
        : this.pipeline.resolve(compiled, {
            snapshot,
            agents,
            limits,
            countBytes: utf8JsonBytes,
          });
    nextResolves.set(fenceKey, { compiled, snapshot, agents, limits, result });
    return result;
  }

  /**
   * The `$agents` input of the message's turn, or `null` (rendered
   * "unavailable") without host sources, an adapter, or a turn.
   */
  private agentsFor(
    messageId: string,
    nextAgents: Map<number, Signal<PtahUiAgentsInput>>,
  ): PtahUiAgentsInput | null {
    const host = this.hostSources;
    const sources = this.liveSources;
    if (host === null || sources === null) return null;
    const turnIndex = host.turnIndexOf(messageId);
    if (turnIndex === null) return null;
    let agents = nextAgents.get(turnIndex) ?? this.agentsByTurn.get(turnIndex);
    if (agents === undefined) {
      agents = untracked(() => sources.agentsInput(host, turnIndex));
    }
    nextAgents.set(turnIndex, agents);
    return agents();
  }

  /** Takes or drops the shared `$limits` read as fences start or stop naming it. */
  private holdLimits(wanted: boolean): void {
    const sources = this.liveSources;
    if (sources === null || wanted === (this.limitsHeld() !== null)) return;
    if (wanted) {
      this.limitsHeld.set(sources.acquireLimits());
    } else {
      this.limitsHeld.set(null);
      sources.releaseLimits();
    }
  }
}

/**
 * Writes one computation to the store, then applies D12: one auto-open
 * request per applied fence of a live candidate the tab has not seen, then
 * marks every published fence seen.
 */
function publish(
  dock: PtahUiDisplayDockSync,
  tabId: string,
  result: DisplaySurfacesResult,
): void {
  dock.setSurfaces(tabId, {
    surfaces: result.surfaces,
    statuses: result.statuses,
  });
  const unseen = result.fences.filter(
    (fence) => !dock.hasSeen(tabId, fence.fenceKey),
  );
  if (unseen.length === 0) return;
  for (const fence of unseen) {
    if (fence.live && fence.status.kind === 'applied') {
      dock.requestAutoOpen(tabId, fence.turnKey, fence.status.surfaceKey);
    }
  }
  dock.markSeen(
    tabId,
    unseen.map((fence) => fence.fenceKey),
  );
}
