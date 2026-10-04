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
  renderPtahUiBlock,
  renderSurfaceText,
  type RenderPtahUiBlockResult,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { TurnSourceSnapshot } from '@ptah-extension/shared';
import { PtahUiLiveWindow } from '../../services/ptah-ui-live-window';

/** The fence pipeline: parse, convert, resolve sources, validate. */
export type PtahUiBlockPipeline = typeof renderPtahUiBlock;

/**
 * The pipeline every `ptah-ui` block runs. A token rather than a direct call
 * so a spec can count (or break) pipeline runs; same precedent as
 * `SURFACE_VIEW_MODEL_BUILDER` in `declarative-dashboard`.
 */
export const PTAH_UI_BLOCK_PIPELINE = new InjectionToken<PtahUiBlockPipeline>(
  'PTAH_UI_BLOCK_PIPELINE',
  { providedIn: 'root', factory: () => renderPtahUiBlock },
);

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
 * PtahUiBlockComponent - one closed ```` ```ptah-ui ```` fence of an assistant
 * message (TASK_2026_610, component 9, decision 10).
 *
 * - Valid block: the validated surface through `ptah-surface-renderer`, with
 *   a read-only interaction state and only the `void` `renderFailed` output
 *   bound (it switches the block to the fallback, "could not display").
 * - Invalid block, or a pipeline that throws: the raw fence through the same
 *   `<markdown>` + `surfaceMarkdown` path as any other fence, so the code HTML
 *   is identical, plus a muted reason line OUTSIDE the code, linked with
 *   `aria-describedby`. Copy actions read node text, never this DOM (A-5).
 * - Live cap: the block registers with the tab's `PtahUiLiveWindow`. Once it
 *   falls outside the newest `PTAH_UI_LIVE_CAP` blocks it becomes a snapshot
 *   for the rest of its life: the result is frozen (no source reads), the
 *   renderer sits in an `inert` subtree, a visually hidden text alternative
 *   renders beside it, and change detection is detached after that render.
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
  private readonly live = signal<Signal<boolean> | null>(null);

  private readonly surfaceId = computed(() =>
    blockSurfaceId(this.nodeId(), this.ordinal()),
  );
  protected readonly reasonId = computed(() => `${this.surfaceId()}-reason`);

  /**
   * One pipeline run per input change while live; none once frozen, because
   * the frozen branch reads no input at all.
   */
  private readonly result = computed((): RenderPtahUiBlockResult => {
    const frozen = this.frozen();
    if (frozen !== null) return frozen;
    const body = this.body();
    const options = {
      surfaceId: this.surfaceId(),
      snapshot: this.snapshot(),
      countBytes: utf8JsonBytes,
    };
    try {
      return this.pipeline(body, options);
    } catch {
      // The shipped pipeline never throws; an injected one might. Either way
      // the message renders and this block falls back (Req 2.4).
      return { ok: false, reason: 'internal error' };
    }
  });

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
  }

  ngOnInit(): void {
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
    // Detach only after the snapshot markup (inert wrapper, text alternative)
    // has rendered once; nothing reattaches it.
    afterNextRender(() => this.cdr.detach(), { injector: this.injector });
  }
}
