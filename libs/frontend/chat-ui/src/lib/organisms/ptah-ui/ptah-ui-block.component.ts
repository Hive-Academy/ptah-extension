import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  InjectionToken,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  type OnInit,
  type Signal,
} from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import { SurfaceMarkdownPipe } from '@ptah-extension/markdown';
import {
  SurfaceRendererComponent,
  type SurfaceInteractionState,
} from '@ptah-extension/declarative-dashboard';
import {
  SURFACE_LIMITS,
  compilePtahUiBlock,
  renderSurfaceText,
  resolveCompiledPtahUiBlock,
  type CompilePtahUiBlockResult,
  type PtahUiAgentsInput,
  type PtahUiLimitsInput,
  type PtahUiSourceName,
  type RenderPtahUiBlockResult,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { TurnSourceSnapshot } from '@ptah-extension/shared';
import { PtahUiLiveWindow } from '../../services/ptah-ui-live-window';
import {
  PTAH_UI_HOST_SOURCES,
  type PtahUiHostSources,
} from '../../services/ptah-ui-host-sources';
import { PtahUiAgentsSource } from './sources/ptah-ui-agents.source';
import { PtahUiLaneLimitsSource } from './sources/ptah-ui-lane-limits.source';

/**
 * The fence pipeline in its two D5 halves: `compile` parses and converts once
 * per body; `resolve` resolves the compiled block against the current sources
 * and validates it, as often as a used source changes.
 */
export interface PtahUiBlockPipeline {
  readonly compile: typeof compilePtahUiBlock;
  readonly resolve: typeof resolveCompiledPtahUiBlock;
}

/**
 * The pipeline every `ptah-ui` block runs. A token rather than a direct call
 * so a spec can count (or break) compile and resolve runs; same precedent as
 * `SURFACE_VIEW_MODEL_BUILDER` in `declarative-dashboard`.
 */
export const PTAH_UI_BLOCK_PIPELINE = new InjectionToken<PtahUiBlockPipeline>(
  'PTAH_UI_BLOCK_PIPELINE',
  {
    providedIn: 'root',
    factory: () => ({
      compile: compilePtahUiBlock,
      resolve: resolveCompiledPtahUiBlock,
    }),
  },
);

/**
 * The live-source adapters a block reads `$agents` and `$limits` through
 * (component 4a): `agentsInput` projects the store facts of one turn,
 * `acquireLimits`/`releaseLimits` reference-count the lane plan-limit read.
 */
export interface PtahUiBlockLiveSources {
  agentsInput(
    hostSources: PtahUiHostSources,
    turnIndex: number,
  ): Signal<PtahUiAgentsInput>;
  acquireLimits(): Signal<PtahUiLimitsInput>;
  releaseLimits(): void;
}

/**
 * Provided by default from the root `PtahUiAgentsSource` and
 * `PtahUiLaneLimitsSource` adapters (decision #52). The factory lives here, in
 * the lazy `ptah-ui` entry, so the adapters and `chat-streaming` stay out of
 * the eager closure; nothing eager provides it.
 *
 * The block still injects it as optional: a host or a spec that provides it
 * explicitly as `null` gets the absent path, where `$agents` and `$limits`
 * resolve to "unavailable" and the block stays valid (R10.7).
 */
export const PTAH_UI_BLOCK_LIVE_SOURCES =
  new InjectionToken<PtahUiBlockLiveSources>('PTAH_UI_BLOCK_LIVE_SOURCES', {
    providedIn: 'root',
    factory: (): PtahUiBlockLiveSources => {
      // Resolved on first use, not here: every block injects this token, and a
      // block that names neither source must not build the agent monitor or
      // plan-limit stores.
      const injector = inject(Injector);
      return {
        agentsInput: (hostSources, turnIndex) =>
          injector.get(PtahUiAgentsSource).agentsInput(hostSources, turnIndex),
        acquireLimits: () => injector.get(PtahUiLaneLimitsSource).acquire(),
        releaseLimits: () => injector.get(PtahUiLaneLimitsSource).release(),
      };
    },
  });

/**
 * Display only (Req 2.17): no selection, no submit. The renderer keeps its
 * local view actions (sort, filter, page, expand), which never leave it.
 */
const READ_ONLY_INTERACTION: SurfaceInteractionState = {
  selection: null,
  selectionUnsynced: false,
  pendingValues: new Map(),
  issues: new Map(),
  actions: new Map(),
  submitDisabled: true,
};

const SURFACE_ID_PREFIX = 'ptah-ui-';
const UTF8 = new TextEncoder();
const NO_SOURCES: ReadonlySet<PtahUiSourceName> = new Set();
/** A thrown compile or resolve; assignable to both pipeline result types. */
const INTERNAL_ERROR: { readonly ok: false; readonly reason: string } = {
  ok: false,
  reason: 'internal error',
};

function utf8JsonBytes(value: unknown): number {
  return UTF8.encode(JSON.stringify(value)).length;
}

/** `ptah-ui-<node id, id-safe>-<ordinal>`, within the surface id length cap. */
function blockSurfaceId(nodeId: string, ordinal: number): string {
  const suffix = `-${ordinal}`;
  const room =
    SURFACE_LIMITS.maxSurfaceIdLength -
    SURFACE_ID_PREFIX.length -
    suffix.length;
  const safeNodeId = nodeId.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, room);
  return `${SURFACE_ID_PREFIX}${safeNodeId}${suffix}`;
}

/**
 * Whether a snapshot's sources are final: no snapshot at all (no host data,
 * every source `unavailable`, or a block that names no turn source), or a
 * terminal turn none of whose sources is still `pending`. A block frozen
 * before this point re-resolves once on it.
 */
function isSettled(snapshot: TurnSourceSnapshot | null): boolean {
  return (
    snapshot === null ||
    (snapshot.state === 'terminal' &&
      snapshot.diff.kind !== 'pending' &&
      snapshot.tests.kind !== 'pending' &&
      snapshot.usage.kind !== 'pending')
  );
}

/**
 * PtahUiBlockComponent - one closed ```` ```ptah-ui ```` fence of an assistant
 * message (TASK_2026_610, component 9, decision 10; TASK_2026_623 component 4).
 *
 * - Compile once per body (D5): the body is parsed and converted once; input
 *   changes re-resolve the compiled block and never parse again. Only the
 *   sources the block names are read: the turn snapshot for `$diff`/`$tests`/
 *   `$usage`, the live `$agents` facts, and the `$limits` read, which is
 *   acquired only while a block that names it is mounted and live.
 * - Valid block: the validated surface through `ptah-surface-renderer` at
 *   container width, with a read-only interaction state and only the `void`
 *   `renderFailed` output bound (it switches the block to the fallback,
 *   "could not display").
 * - Invalid block (any compile failure, a reserved display id included), or a
 *   pipeline that throws: the raw fence through the same `<markdown>` +
 *   `surfaceMarkdown` path as any other fence, so the code HTML is identical,
 *   plus a muted reason line OUTSIDE the code, linked with `aria-describedby`.
 *   Copy actions read node text, never this DOM (A-5).
 * - Live cap: the block registers with the tab's `PtahUiLiveWindow`. Once it
 *   falls outside the newest `PTAH_UI_LIVE_CAP` blocks it becomes a snapshot
 *   for the rest of its life: the result is frozen (no source reads), the
 *   renderer sits in an `inert` subtree, a visually hidden text alternative
 *   renders beside it, and change detection is detached after that render.
 *   A block frozen while its snapshot is not yet settled (an open turn, or a
 *   `$diff` awaiting its late push) stays attached and re-resolves exactly
 *   once when the snapshot settles, then detaches; no further source reads.
 */
@Component({
  selector: 'ptah-ui-block',
  standalone: true,
  imports: [MarkdownModule, SurfaceMarkdownPipe, SurfaceRendererComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (renderable(); as content) {
      <div
        class="my-2"
        data-testid="ptah-ui-block"
        [attr.data-ptah-ui-mode]="snapshotMode() ? 'snapshot' : 'live'"
        [attr.inert]="snapshotMode() ? '' : null"
      >
        <ptah-surface-renderer
          [renderable]="content"
          [interaction]="readOnlyInteraction"
          layoutWidth="container"
          (renderFailed)="markRenderFailed()"
        />
      </div>
      @if (snapshotMode()) {
        <p
          class="sr-only whitespace-pre-line"
          data-testid="ptah-ui-text-alternative"
        >
          {{ textAlternative() }}
        </p>
      }
    } @else {
      <markdown
        [data]="raw() | surfaceMarkdown: active()"
        [attr.aria-describedby]="reasonId()"
      />
      <p
        data-ptah-ui-reason
        class="text-xs text-base-content-muted"
        [id]="reasonId()"
      >
        Not rendered: {{ reason() }}
      </p>
    }
  `,
})
export class PtahUiBlockComponent implements OnInit {
  private readonly pipeline = inject(PTAH_UI_BLOCK_PIPELINE);
  private readonly liveWindow = inject(PtahUiLiveWindow);
  private readonly hostSources = inject(PTAH_UI_HOST_SOURCES, {
    optional: true,
  });
  private readonly liveSources = inject(PTAH_UI_BLOCK_LIVE_SOURCES, {
    optional: true,
  });
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  /** The whole fence, opening and closing lines included (the fallback text). */
  readonly raw = input.required<string>();
  /** The lines between the fence lines (the pipeline input). */
  readonly body = input.required<string>();
  /** Ordinal of this fence within its text node. */
  readonly ordinal = input.required<number>();
  readonly messageId = input.required<string>();
  readonly nodeId = input.required<string>();
  /** Transcript order of the owning message; higher is newer. */
  readonly orderKey = input.required<number>();
  /** Surface activity, forwarded to `surfaceMarkdown` exactly as the text node does. */
  readonly active = input(true);
  /** Host data for `$diff`/`$tests`/`$usage`; `null` resolves to `unavailable`. */
  readonly snapshot = input<TurnSourceSnapshot | null>(null);

  protected readonly readOnlyInteraction = READ_ONLY_INTERACTION;

  /** True once the block left the live window; never reverts for this instance. */
  protected readonly snapshotMode = signal(false);
  /** The result captured when the block became a snapshot. */
  private readonly frozen = signal<RenderPtahUiBlockResult | null>(null);
  /** Frozen on an unsettled snapshot: re-resolve once when it settles. */
  private readonly awaitingSettle = signal(false);
  private readonly live = signal<Signal<boolean> | null>(null);
  /** The acquired `$limits` read; `null` while this block holds none. */
  private readonly limitsHeld = signal<Signal<PtahUiLimitsInput> | null>(null);
  /** Set once the block is frozen and detached; it reads no source again. */
  private retired = false;

  private readonly surfaceId = computed(() =>
    blockSurfaceId(this.nodeId(), this.ordinal()),
  );
  protected readonly reasonId = computed(() => `${this.surfaceId()}-reason`);

  /** One compile per body (and surface id); snapshots and live sources never re-run it. */
  private readonly compiled = computed((): CompilePtahUiBlockResult => {
    const body = this.body();
    const surfaceId = this.surfaceId();
    try {
      return this.pipeline.compile(body, surfaceId);
    } catch {
      // The shipped pipeline never throws; an injected one might. Either way
      // the message renders and this block falls back (Req 2.4).
      return INTERNAL_ERROR;
    }
  });

  private readonly usedSources = computed(() => {
    const compiled = this.compiled();
    return compiled.ok ? compiled.usedSources : NO_SOURCES;
  });
  private readonly usesTurnSources = computed(() => {
    const used = this.usedSources();
    return used.has('diff') || used.has('tests') || used.has('usage');
  });
  private readonly usesAgents = computed(() =>
    this.usedSources().has('agents'),
  );
  private readonly usesLimits = computed(() =>
    this.usedSources().has('limits'),
  );

  /** The turn snapshot, read only for a block that names a turn source. */
  private readonly turnSnapshot = computed(() =>
    this.usesTurnSources() ? this.snapshot() : null,
  );

  /**
   * This block's turn index, kept in its own computed: streaming writes
   * re-run it, but an unchanged number stops propagation to `agentsSource`.
   */
  private readonly agentsTurnIndex = computed((): number | null => {
    if (!this.usesAgents()) return null;
    const host = this.hostSources;
    return host === null ? null : host.turnIndexOf(this.messageId());
  });

  /**
   * The adapter's `$agents` signal for this block's turn, created only for a
   * block that names `$agents`. `null` (rendered "unavailable") without host
   * sources, without an adapter, or for a message outside every turn.
   */
  private readonly agentsSource = computed(
    (): Signal<PtahUiAgentsInput> | null => {
      const turnIndex = this.agentsTurnIndex();
      const host = this.hostSources;
      const sources = this.liveSources;
      if (turnIndex === null || host === null || sources === null) return null;
      return untracked(() => sources.agentsInput(host, turnIndex));
    },
  );

  /**
   * One resolve per change of a used input while live; none once frozen,
   * because the frozen branch reads no input at all.
   */
  private readonly result = computed(
    (): RenderPtahUiBlockResult => this.frozen() ?? this.resolve(),
  );

  /** One resolve of the compiled block over the current used inputs. */
  private resolve(): RenderPtahUiBlockResult {
    const compiled = this.compiled();
    if (!compiled.ok) return { ok: false, reason: compiled.reason };
    const agents = this.agentsSource();
    const limits = this.usesLimits() ? this.limitsHeld() : null;
    const input = {
      snapshot: this.turnSnapshot(),
      agents: agents === null ? null : agents(),
      limits: limits === null ? null : limits(),
      countBytes: utf8JsonBytes,
    };
    try {
      return this.pipeline.resolve(compiled, input);
    } catch {
      return INTERNAL_ERROR;
    }
  }

  /** Set when the renderer reports a build failure for a validated surface. */
  private readonly rendererFailed = signal(false);

  protected readonly renderable = computed(() => {
    if (this.rendererFailed()) return null;
    const result = this.result();
    return result.ok ? result.content : null;
  });
  protected readonly reason = computed(() => {
    if (this.rendererFailed()) return 'could not display';
    const result = this.result();
    return result.ok ? '' : result.reason;
  });

  /** Plain-text alternative for the inert snapshot, without the revision footer. */
  protected readonly textAlternative = computed(() => {
    const content = this.renderable();
    if (content === null) return '';
    const lines = renderSurfaceText({
      surfaceId: this.surfaceId(),
      revision: 0,
      content,
      selection: null,
      lastSubmit: null,
    }).split('\n');
    return lines
      .slice(0, -1)
      .filter((line) => line.trim().length > 0)
      .join('\n');
  });

  constructor() {
    effect(() => {
      const live = this.live();
      if (live === null || live() || untracked(this.snapshotMode)) return;
      this.freeze();
    });
    // Reads the snapshot only while a frozen block awaits it; once refreshed,
    // `awaitingSettle` stays false and this effect has nothing left to track.
    effect(() => {
      if (!this.awaitingSettle() || !isSettled(this.turnSnapshot())) return;
      untracked(() => {
        this.awaitingSettle.set(false);
        this.frozen.set(this.resolve());
        this.retire();
      });
    });
    // A body that starts or stops naming `$limits` takes or drops the read.
    effect(() => {
      const wanted = this.usesLimits();
      untracked(() => this.holdLimits(wanted));
    });
    this.destroyRef.onDestroy(() => this.holdLimits(false));
  }

  ngOnInit(): void {
    // Take the `$limits` read before the first resolve, so a live block shows
    // "pending" rather than a transient "unavailable".
    this.holdLimits(untracked(this.usesLimits));
    const key = `${this.messageId()}:${this.nodeId()}:${this.ordinal()}`;
    const live = this.liveWindow.register(key, this.orderKey());
    this.destroyRef.onDestroy(() => this.liveWindow.release(key));
    this.live.set(live);
    // A remount outside the newest blocks starts as a snapshot.
    if (!live()) this.freeze();
  }

  /**
   * The renderer's `void` failure notification: the only output bound, since
   * it carries no agent data. The block falls back to its code block.
   */
  protected markRenderFailed(): void {
    this.rendererFailed.set(true);
  }

  private freeze(): void {
    this.frozen.set(untracked(this.result));
    this.snapshotMode.set(true);
    if (isSettled(untracked(this.turnSnapshot))) this.retire();
    else this.awaitingSettle.set(true);
  }

  /** The frozen block reads nothing again: drop the `$limits` read and detach. */
  private retire(): void {
    this.retired = true;
    this.holdLimits(false);
    this.detachAfterRender();
  }

  /** Acquires or releases this block's single `$limits` reference. */
  private holdLimits(wanted: boolean): void {
    const sources = this.liveSources;
    if (sources === null) return;
    const held = untracked(this.limitsHeld) !== null;
    if (wanted && !held && !this.retired) {
      this.limitsHeld.set(sources.acquireLimits());
    } else if (!wanted && held) {
      this.limitsHeld.set(null);
      sources.releaseLimits();
    }
  }

  /**
   * Detach only after the snapshot markup (inert wrapper, text alternative)
   * has rendered once; nothing reattaches it.
   */
  private detachAfterRender(): void {
    afterNextRender(() => this.cdr.detach(), { injector: this.injector });
  }
}
