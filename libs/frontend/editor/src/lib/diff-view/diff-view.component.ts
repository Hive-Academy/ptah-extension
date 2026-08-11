import {
  Component,
  input,
  output,
  computed,
  signal,
  ChangeDetectionStrategy,
  ElementRef,
  viewChild,
  viewChildren,
  effect,
  OnDestroy,
  NgZone,
  inject,
  untracked,
  afterNextRender,
  ChangeDetectorRef,
  TemplateRef,
  ViewContainerRef,
  type EmbeddedViewRef,
} from '@angular/core';
import type { LucideIconData } from 'lucide-angular';
import {
  LucideAngularModule,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Columns2,
  Minus,
  Plus,
  Rows2,
  Undo2,
  X,
} from 'lucide-angular';
import type * as monaco from 'monaco-editor';
import { rpcCall, VSCodeService } from '@ptah-extension/core';
import { MonacoLoaderService } from '../services/monaco-loader.service';
import type {
  EditorTab,
  GitApplyHunksOperation,
  GitHunkRef,
  HunkApplyFn,
} from '../services/editor/editor-tab.types';
import { diffComparisonLabel } from '../services/editor/editor-tab.types';

type MonacoApi = typeof monaco;

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Identifiers for the buttons of the hunk toolbar, in visual order.
 *
 * The set is comparison-dependent (`stage`/`revert` for a working-tree diff,
 * `unstage` for a staged one) and drives BOTH the rendered buttons and the
 * roving tabindex, so the two can never disagree about what exists.
 */
type HunkToolbarAction = 'prev' | 'next' | GitApplyHunksOperation;

/**
 * A hunk selection, bound to the exact diff snapshot it was made against.
 *
 * The token is what makes this safe to act on later. A hunk ordinal is
 * meaningless on its own: a revalidation landing between selection and click
 * renumbers `hunks` and issues a NEW token, and forwarding the old ordinal with
 * that new token would pass the backend's staleness check (which only asks
 * whether the repository moved since the token it was handed was issued) and
 * apply a hunk the user never saw. Every read of the selection re-checks the
 * token, so a superseded selection resolves to "nothing selected" rather than
 * to the wrong hunk.
 */
interface HunkSelection {
  /** Diff tab key the selection belongs to. */
  key: string;
  /** `GitHunkRef.index` — the ordinal the backend's apply RPC selects by. */
  index: number;
  /** `snapshotToken` of the diff that was on screen when this was chosen. */
  snapshotToken: string;
}

/**
 * Monaco line range for one hunk's MODIFIED side, clamped into the model.
 *
 * Positions come from git's `@@ -a,b +c,d @@`, never from Monaco's own change
 * regions: the two segment a file differently and git's segmentation is the one
 * the apply is expressed in, so an affordance placed by Monaco's boundaries
 * could sit on a hunk other than the one it stages.
 *
 * Two clamps, both reachable with real git output:
 *
 * - `c` is **0** for a hunk that removes from the very top of a file
 *   (`@@ -1,3 +0,0 @@`). Monaco lines are 1-based and line 0 does not exist.
 * - `d` is **0** for any pure-deletion hunk, which would make `c + d - 1` end
 *   BEFORE it starts. Such a hunk occupies no modified-side lines, so it is
 *   anchored to the single line it sits at.
 */
export function hunkLineRange(
  hunk: GitHunkRef,
  modelLineCount: number,
): { startLine: number; endLine: number } {
  const lastLine = Math.max(1, modelLineCount);
  const startLine = Math.min(lastLine, Math.max(1, hunk.modifiedStart));
  const rawEnd =
    hunk.modifiedLines > 0 ? startLine + hunk.modifiedLines - 1 : startLine;
  return {
    startLine,
    endLine: Math.min(lastLine, Math.max(startLine, rawEnd)),
  };
}

/**
 * The hunk covering a modified-side line, or `null` when the line is context.
 *
 * Backs the glyph-margin click. Clicking a line that belongs to no hunk must
 * change nothing — silently selecting the nearest hunk instead would let a
 * misplaced click stage something the user did not point at.
 */
export function hunkAtLine(
  hunks: readonly GitHunkRef[],
  line: number,
  modelLineCount: number,
): GitHunkRef | null {
  for (const hunk of hunks) {
    const { startLine, endLine } = hunkLineRange(hunk, modelLineCount);
    if (line >= startLine && line <= endLine) return hunk;
  }
  return null;
}

/** Both text models backing one diff tab, cached and reused across switches. */
interface DiffModelPair {
  original: monaco.editor.ITextModel;
  modified: monaco.editor.ITextModel;
}

/**
 * Backend setting key for the inline / side-by-side preference (D3).
 *
 * Served by the EXISTING `editor:getSetting` / `editor:updateSetting` pair on
 * all three hosts — D3 deliberately adds no new RPC method.
 */
const DIFF_LAYOUT_SETTING_KEY = 'editor.diff.renderSideBySide';

/**
 * Fallback copy for an apply that failed without usable backend copy.
 *
 * States that nothing was written, because that is the property the user needs
 * and the one the backend guarantees: every refusal path leaves the repository
 * in its exact pre-operation state (D2 AC7).
 */
const APPLY_FAILED_MESSAGE =
  'The hunk could not be applied. Nothing was written.';

/**
 * DiffViewComponent - Direct Monaco diff editor for side-by-side file comparison.
 *
 * Uses Monaco's createDiffEditor API directly rather than the
 * `<ngx-monaco-diff-editor>` wrapper because that wrapper disposes and
 * re-initialises the editor on every model setter call (flicker + tokenizer
 * thrash on streaming diffs). Loading is coordinated with the ngx wrapper
 * through `MonacoLoaderService` (shared via `window.monaco`), so this
 * component renders correctly even when it is the first Monaco surface to
 * mount in the session.
 *
 * The component takes ONE diff input — the diff tab record — rather than three
 * loose strings. Everything the chrome needs (which comparison, whether a side
 * is absent, binary or failed, how fresh the read is) is carried on that record
 * by the backend, so nothing here has to infer state from content. In
 * particular "(new file)" is driven by `originalRef.kind === 'absent'`, NOT by
 * an empty original: a genuinely-empty tracked file is not a new file (A3 AC5).
 *
 * LIFECYCLE (B1/B2). The component is mounted for the whole session — the
 * editor panel hides it with `[class.invisible]` rather than unmounting it —
 * and the Monaco diff editor is created exactly ONCE. Switching diff tabs
 * swaps a cached model PAIR and restores that tab's view state; a content
 * update rewrites the existing models via `pushEditOperations`. Nothing here
 * ever reads `window.monaco`: the API handle comes from the loader promise, so
 * "updates still work with the global unavailable" (B2 AC4) is structural
 * rather than a behavioural promise.
 *
 * Model pairs are evicted when their tab closes, which is where this diverges
 * from `CodeEditorComponent` (that one deliberately retains evicted models,
 * because its tab content is cheap to re-open and its undo history is not).
 * The live-key set arrives as an input rather than by injecting `EditorService`,
 * so this stays a presentational component with no dependency on the editor
 * coordinator.
 */
@Component({
  selector: 'ptah-diff-view',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div class="w-full h-full flex flex-col bg-base-100">
      <!-- Diff header bar: identity, chrome and freshness in one row. -->
      @if (showHeader() && diff(); as d) {
        <div
          class="flex items-center gap-2 px-2 py-1 text-xs bg-base-200 border-b border-base-content/10 flex-shrink-0"
          role="status"
          [attr.aria-label]="headerAriaLabel()"
        >
          <span class="truncate font-medium" [attr.title]="pathTitle()">{{
            d.path
          }}</span>

          @if (isRename()) {
            <span class="opacity-50 truncate text-[10px]"
              >renamed from {{ d.originalPath }}</span
            >
          }

          <span
            class="px-1.5 py-0.5 rounded bg-base-content/10 opacity-70 flex-shrink-0"
            >{{ comparisonLabel() }}</span
          >

          @if (chromeLabel(); as chrome) {
            <span
              class="px-1.5 py-0.5 rounded bg-base-content/10 flex-shrink-0"
              data-testid="diff-chrome"
              >{{ chrome }}</span
            >
          }

          @if (statusLabel(); as status) {
            <span
              class="flex items-center gap-1 flex-shrink-0"
              [class.text-error]="d.status === 'error'"
              [class.text-warning]="d.status === 'stale'"
              [class.opacity-60]="d.status === 'refreshing'"
              data-testid="diff-status-chip"
              [attr.title]="d.errorMessage"
            >
              @if (d.status !== 'refreshing') {
                <lucide-angular
                  [img]="AlertTriangleIcon"
                  class="w-3 h-3"
                  aria-hidden="true"
                />
              }
              {{ status }}
            </span>
          }

          <!--
            D2 AC14 — the KEYBOARD path to every hunk action.

            A roving-tabindex toolbar (the WAI-ARIA "toolbar" pattern): one tab
            stop for the whole group, arrow keys between its buttons. This is
            the reason the glyph margin is an accelerator rather than the
            mechanism — a keyboard user never has to reach a gutter, and
            revealHunk scrolls the selected hunk into view so "activatable by
            keyboard" does not mean "activatable while unable to see what is
            selected".

            Unavailable actions carry aria-disabled, NOT disabled: a disabled
            button is removed from the focus order, which would put holes in a
            roving tabindex and make arrow navigation skip silently.
          -->
          @if (hunkActionsAvailable()) {
            <div
              class="flex items-center gap-0.5 flex-shrink-0"
              role="toolbar"
              aria-orientation="horizontal"
              [attr.aria-label]="hunkToolbarLabel()"
              data-testid="hunk-toolbar"
              (keydown)="onHunkToolbarKeydown($event)"
            >
              <button
                #hunkToolbarButton
                type="button"
                class="btn btn-ghost btn-xs px-1"
                data-hunk-action="prev"
                data-testid="hunk-prev"
                aria-label="Previous hunk"
                [attr.tabindex]="hunkTabIndex('prev')"
                (click)="stepHunk(-1)"
              >
                <lucide-angular
                  [img]="ChevronLeftIcon"
                  class="w-3 h-3"
                  aria-hidden="true"
                />
              </button>

              <span
                class="px-1 opacity-70 whitespace-nowrap"
                data-testid="hunk-position"
                >{{ hunkPositionLabel() }}</span
              >

              <button
                #hunkToolbarButton
                type="button"
                class="btn btn-ghost btn-xs px-1"
                data-hunk-action="next"
                data-testid="hunk-next"
                aria-label="Next hunk"
                [attr.tabindex]="hunkTabIndex('next')"
                (click)="stepHunk(1)"
              >
                <lucide-angular
                  [img]="ChevronRightIcon"
                  class="w-3 h-3"
                  aria-hidden="true"
                />
              </button>

              @for (action of hunkOperations(); track action) {
                <button
                  #hunkToolbarButton
                  type="button"
                  class="btn btn-ghost btn-xs px-1.5 gap-1"
                  [class.text-warning]="action === 'revert'"
                  [attr.data-hunk-action]="action"
                  [attr.data-testid]="'hunk-' + action"
                  [attr.tabindex]="hunkTabIndex(action)"
                  [attr.aria-disabled]="!canApply()"
                  [attr.aria-label]="hunkActionLabel(action)"
                  [attr.title]="hunkActionLabel(action)"
                  [class.opacity-40]="!canApply()"
                  (click)="onHunkAction(action)"
                >
                  <lucide-angular
                    [img]="hunkActionIcon(action)"
                    class="w-3 h-3"
                    aria-hidden="true"
                  />
                  {{ hunkActionText(action) }}
                </button>
              }
            </div>
          }

          <!--
            D3: layout toggle. aria-pressed describes the INLINE state, so the
            control reads as "inline diff view: off/on" rather than as an
            unlabelled two-state icon.
          -->
          <button
            type="button"
            class="btn btn-ghost btn-xs ml-auto px-1.5 flex-shrink-0"
            data-testid="diff-layout-toggle"
            [attr.aria-pressed]="!renderSideBySide()"
            aria-label="Inline diff view"
            [attr.title]="
              renderSideBySide()
                ? 'Switch to inline diff view'
                : 'Switch to side-by-side diff view'
            "
            (click)="toggleRenderSideBySide()"
          >
            <lucide-angular
              [img]="renderSideBySide() ? Rows2Icon : Columns2Icon"
              class="w-3 h-3"
              aria-hidden="true"
            />
          </button>

          <button
            type="button"
            class="btn btn-ghost btn-xs px-1.5 flex-shrink-0"
            data-testid="diff-retry"
            title="Re-read this comparison from git"
            aria-label="Retry reading this diff from git"
            [disabled]="d.status === 'refreshing'"
            (click)="retryRequested.emit(tabKey())"
          >
            <lucide-angular [img]="RefreshCwIcon" class="w-3 h-3" />
          </button>
        </div>
      }

      <!--
        D2 AC7 — a refused or failed apply says WHAT failed and WHY, and stays
        until dismissed or superseded. The copy is the backend's own sanitized
        sentence: it never carries stderr or an absolute path (NFR-8), and the
        frontend does not paraphrase it, because "what failed" is knowledge only
        the backend has.
      -->
      @if (applyError(); as message) {
        <div
          class="flex items-start gap-2 px-2 py-1 text-xs bg-error/10 text-error border-b border-error/20 flex-shrink-0"
          role="alert"
          data-testid="hunk-apply-error"
        >
          <lucide-angular
            [img]="AlertTriangleIcon"
            class="w-3 h-3 mt-0.5 flex-shrink-0"
            aria-hidden="true"
          />
          <span class="flex-1">{{ message }}</span>
          <button
            type="button"
            class="btn btn-ghost btn-xs px-1 flex-shrink-0"
            data-testid="hunk-apply-error-dismiss"
            aria-label="Dismiss hunk error"
            (click)="applyError.set(null)"
          >
            <lucide-angular [img]="XIcon" class="w-3 h-3" aria-hidden="true" />
          </button>
        </div>
      }

      <div class="flex-1 min-h-0 relative">
        <div #editorContainer class="w-full h-full"></div>

        @if (loadState() === 'loading') {
          <div
            class="absolute inset-0 flex items-center justify-center text-sm text-base-content-muted pointer-events-none"
          >
            <span class="loading loading-spinner loading-sm mr-2"></span>
            Loading diff editor…
          </div>
        } @else if (loadState() === 'error') {
          <div
            class="absolute inset-0 flex flex-col items-center justify-center p-4 text-sm text-error gap-2"
          >
            <span class="font-medium">Failed to load diff editor</span>
            <span class="text-xs text-base-content-muted max-w-md text-center">
              {{ loadError() }}
            </span>
          </div>
        }

        <!--
          Persistent overlays (NOT toasts) — A1 AC7 requires the indicator to
          stay until the condition clears. A failed git read is never rendered
          as content, so the overlay is opaque.
        -->
        @if (gitError(); as message) {
          <div
            class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 bg-base-100"
            data-testid="diff-error-overlay"
            role="alert"
          >
            <lucide-angular
              [img]="AlertTriangleIcon"
              class="w-5 h-5 text-error"
              aria-hidden="true"
            />
            <span class="text-sm text-error font-medium text-center max-w-md">{{
              message
            }}</span>
            @if (gitErrorDetail(); as detail) {
              <span
                class="text-xs text-base-content-muted max-w-md text-center break-all"
                >{{ detail }}</span
              >
            }
            <button
              type="button"
              class="btn btn-xs btn-outline mt-1"
              data-testid="diff-error-retry"
              (click)="retryRequested.emit(tabKey())"
            >
              Retry
            </button>
          </div>
        } @else if (isBinary()) {
          <div
            class="absolute inset-0 flex items-center justify-center p-4 bg-base-100 text-sm text-base-content-muted"
            data-testid="diff-binary-overlay"
          >
            Binary file — diff not shown
          </div>
        }
      </div>

      <!--
        D2 AC5 — revert is NEVER a single unconfirmed click.

        Stage and unstage are each other's inverse and cost nothing to undo.
        Revert discards working-tree lines, which is the one thing in this
        component that may exist nowhere else — not in a commit, not in the
        index, not on a remote. There is no undo for it, so it gets a stop.

        Modelled on the split-pane save-conflict dialog: role alertdialog,
        aria-modal, labelled AND described, focus moved to the non-destructive
        choice on open, focus restored on close, Escape maps to Cancel, and Tab
        toggles between exactly two focusable elements rather than walking out
        into the editor behind a visually blocking modal. No clickable backdrop:
        this dialog exists because content is about to be destroyed, so an
        accidental click-out must not resolve it.

        A native dialog element opened with showModal(), NOT a positioned div
        (TASK_2026_227). z-index is only ever resolved among the siblings of the
        nearest ancestor that establishes a stacking context, and this component
        sits inside two of them — the editor panel's own isolation:isolate
        wrapper (editor-panel.component.ts, added so Monaco could not swallow
        the terminal resize handle) and the gridstack tile that hosts the panel
        in the Electron layout. No number written here can climb out of either,
        so the canvas panel painted over the dialog and its empty-state text
        took the clicks on both buttons: a destructive-action confirmation that
        a mouse user could not answer. showModal() puts the element in the
        browser's TOP LAYER, which is painted after the whole document and is
        therefore outside every stacking context by construction rather than by
        out-bidding one. daisyUI expects exactly this shape: the modal[open]
        rule is what reveals it, so modal-open is gone, and the scrim moves from
        the wrapper's own background to the modal::backdrop pseudo-element. The
        modal-backdrop child stays inert and aria-hidden — a form with
        method="dialog" there is daisyUI's click-to-close idiom, and that is
        precisely what must not exist here.

        The pending selection carries its OWN snapshot token. The dialog is
        precisely the window in which a revalidation can land, and when one does
        the coordinator refuses the request without an RPC rather than reverting
        a renumbered hunk.
      -->
      @if (pendingRevert()) {
        <dialog
          #revertDialog
          class="modal"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="ptah-hunk-revert-title"
          aria-describedby="ptah-hunk-revert-desc"
          data-testid="hunk-revert-dialog"
          (cancel)="onRevertDialogCancel($event)"
          (keydown)="onRevertDialogKeydown($event)"
        >
          <div class="modal-box max-w-sm">
            <h3 id="ptah-hunk-revert-title" class="font-bold text-base">
              Discard this hunk?
            </h3>
            <p
              id="ptah-hunk-revert-desc"
              class="py-3 text-sm text-base-content-muted"
            >
              {{ revertDialogDescription() }}
            </p>
            <div class="modal-action">
              <button
                #revertCancel
                type="button"
                class="btn btn-sm"
                data-testid="hunk-revert-cancel"
                (click)="cancelRevert()"
              >
                Cancel
              </button>
              <button
                #revertConfirm
                type="button"
                class="btn btn-sm btn-warning"
                data-testid="hunk-revert-confirm"
                (click)="confirmRevert()"
              >
                Discard hunk
              </button>
            </div>
          </div>
          <div class="modal-backdrop" aria-hidden="true"></div>
        </dialog>
      }
    </div>

    <!--
      D2 — the in-editor hunk action cluster (TASK_2026_221).

      This template is NEVER rendered here. It is instantiated as an embedded
      view and its root node is handed to Monaco as a CONTENT widget anchored at
      the selected hunk's modifiedStart, so the buttons sit beside the lines
      they act on instead of 500px away in the header. Content widget, not
      overlay widget: an overlay widget is positioned against the editor's
      viewport corners, and this has to track a line through scrolling and
      re-layout.

      Rendering it through Angular rather than as constructed DOM is what keeps
      it a normal part of this component: the same signals drive it, the same
      OnPush change detection updates it, the same handlers back it, and it
      carries the component's style scoping attribute even though it lives in
      DOM Monaco owns. Hand-built innerHTML would have needed its own event
      wiring and its own copy of every guard in onHunkAction.

      MOUSE affordance only, deliberately. Every button is tabindex="-1": the
      roving-tabindex toolbar in the header is the keyboard path (AC14), and a
      second tab stop that appears and disappears inside the editor as the
      selection moves would make the tab order jump under the user. The buttons
      keep real accessible names, so the cluster is still readable with a screen
      reader's virtual cursor — it is simply not a second thing to tab through.
    -->
    <ng-template #hunkActionWidget>
      <div
        class="flex items-center gap-1 px-1 py-0.5 rounded-md shadow-lg bg-base-200 border border-base-content/20"
        role="group"
        data-testid="hunk-widget"
        [attr.aria-label]="hunkWidgetLabel()"
        (mousedown)="$event.stopPropagation()"
      >
        @for (action of hunkOperations(); track action) {
          <button
            type="button"
            class="btn btn-ghost btn-xs px-1.5 gap-1"
            tabindex="-1"
            [class.text-warning]="action === 'revert'"
            [attr.data-testid]="'hunk-widget-' + action"
            [attr.aria-disabled]="!canApply()"
            [attr.aria-label]="hunkActionLabel(action)"
            [attr.title]="hunkActionLabel(action)"
            [class.opacity-40]="!canApply()"
            (click)="onHunkAction(action)"
          >
            <lucide-angular
              [img]="hunkActionIcon(action)"
              class="w-3 h-3"
              aria-hidden="true"
            />
            {{ hunkActionText(action) }}
          </button>
        }
      </div>
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      width: 100%;
    }

    /*
     * D2 AC1 / D3 AC6 — the per-hunk glyph marker.
     *
     * ng-deep is required, not stylistic: Monaco builds the glyph margin
     * imperatively, so those elements never receive this component's scoping
     * attribute and an encapsulated rule would not reach them. It is scoped
     * under :host so the escape is bounded to this component's subtree.
     *
     * Purely a decoration on the MODIFIED side, which is why it needs no
     * counterpart in the inline layout: Monaco renders one modified-side glyph
     * margin in both layouts, so the markers appear in each without a second
     * code path.
     *
     * The ink is currentColor — Monaco's own foreground for whichever theme is
     * loaded — and NOT daisyUI's primary. This used to name --fallback-p with
     * currentColor as its fallback, which looked like it asked for the primary
     * and never did: daisyUI defines --fallback-p only inside an
     * "@supports not (color: oklch(...))" block, so on every browser either
     * host actually runs it was undefined and the fallback took over. Naming
     * currentColor directly is what TASK_2026_222 measured in a real window,
     * and it is also the right colour: the glyph margin belongs to Monaco's
     * palette, so tracking the editor foreground is what keeps a marker legible
     * in vs, vs-dark and hc-black alike.
     */
    :host ::ng-deep .ptah-hunk-glyph {
      cursor: pointer;
      background-color: color-mix(in srgb, currentColor 55%, transparent);
      width: 3px !important;
      margin-left: 4px;
    }

    :host ::ng-deep .ptah-hunk-glyph-selected {
      background-color: currentColor;
      width: 5px !important;
      margin-left: 3px;
    }

    :host ::ng-deep .ptah-hunk-line-selected {
      background-color: color-mix(in srgb, currentColor 12%, transparent);
    }

    /*
     * The content widget's own wrapper (TASK_2026_221). Monaco absolutely
     * positions this node; everything inside it is Angular's, so only the
     * wrapper needs a rule — and it needs ng-deep because Monaco creates the
     * wrapper itself when the widget is added.
     *
     * z-index sits above the view lines so the cluster is not painted under
     * the diff's own decorations, and white-space: nowrap stops the buttons
     * wrapping when the modified pane is narrow.
     */
    :host ::ng-deep .ptah-hunk-widget {
      z-index: 10;
      white-space: nowrap;
      font-size: 11px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiffViewComponent implements OnDestroy {
  private readonly ngZone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly loader = inject(MonacoLoaderService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly viewContainer = inject(ViewContainerRef);

  /**
   * Max number of cached model PAIRS (two models each) retained before LRU
   * eviction. Eviction-on-close already bounds the cache to the number of open
   * diff tabs, so this cap is a backstop; 30 matches B1 AC5's workload.
   */
  private static readonly MAX_DIFF_PAIRS = 30;
  private static instanceCounter = 0;

  /** The active diff tab, or null when no diff is being shown. */
  readonly diffTab = input<EditorTab | null>(null);

  /**
   * Keys of every diff tab currently open. A pair whose key leaves this set has
   * had its tab closed (or its whole workspace swapped out) and is disposed —
   * B1 AC5/AC6. Supplied by the panel so this component needs no reference to
   * `EditorService`.
   */
  readonly openDiffKeys = input<readonly string[]>([]);

  /**
   * Render the built-in git header bar (path, comparison chip, layout toggle,
   * retry). Non-git consumers — e.g. the Skills library's enhancement preview,
   * which reuses the Monaco diff surface for two in-memory bodies — supply
   * their own chrome and turn this off, so the panel never claims a bogus
   * `staged` / `working tree` provenance.
   *
   * @default true
   */
  readonly showHeader = input<boolean>(true);

  /**
   * How to stage / unstage / revert hunks (D2). Supplied as a FUNCTION rather
   * than injected, so this component keeps no dependency on the editor
   * coordinator and stays testable without it.
   *
   * `null` — the default — means the surface has no git behind it, and every
   * hunk affordance is then ABSENT rather than present and inert. That is what
   * keeps the Skills library's enhancement preview, which reuses this Monaco
   * surface for two in-memory bodies, from offering to stage them.
   */
  readonly applyHunks = input<HunkApplyFn | null>(null);

  /** Emits the diff tab key when the user asks for a re-read. */
  readonly retryRequested = output<string>();

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly RefreshCwIcon = RefreshCw;
  protected readonly Columns2Icon = Columns2;
  protected readonly Rows2Icon = Rows2;
  protected readonly ChevronLeftIcon = ChevronLeft;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly XIcon = X;

  private readonly editorContainer =
    viewChild.required<ElementRef<HTMLElement>>('editorContainer');

  private readonly hunkToolbarButtons =
    viewChildren<ElementRef<HTMLButtonElement>>('hunkToolbarButton');
  private readonly hunkActionWidget =
    viewChild<TemplateRef<unknown>>('hunkActionWidget');
  private readonly revertDialog =
    viewChild<ElementRef<HTMLDialogElement>>('revertDialog');
  private readonly revertCancel =
    viewChild<ElementRef<HTMLButtonElement>>('revertCancel');
  private readonly revertConfirm =
    viewChild<ElementRef<HTMLButtonElement>>('revertConfirm');

  private monacoApi: MonacoApi | null = null;
  private editor: monaco.editor.IStandaloneDiffEditor | null = null;
  /** Model pairs keyed by diff tab key. */
  private readonly pairs = new Map<string, DiffModelPair>();
  /** Per-tab diff view state (both sides' scroll + cursor), keyed by tab key. */
  private readonly viewStates = new Map<
    string,
    monaco.editor.IDiffEditorViewState
  >();
  /** Key of the pair currently attached to the editor, or null when detached. */
  private currentKey: string | null = null;
  /** Glyph-margin + line markers for the current tab's hunks (D2 AC1). */
  private hunkDecorations: monaco.editor.IEditorDecorationsCollection | null =
    null;
  /** Glyph-margin mouse binding, disposed with the component. */
  private glyphClickBinding: monaco.IDisposable | null = null;
  /** Angular view backing the in-editor action cluster (TASK_2026_221). */
  private hunkWidgetView: EmbeddedViewRef<unknown> | null = null;
  /** The node handed to Monaco; the embedded view's roots live inside it. */
  private hunkWidgetHostNode: HTMLElement | null = null;
  /** Monaco content widget hosting that view, or null while nothing is selected. */
  private hunkWidget: monaco.editor.IContentWidget | null = null;
  /** The line the widget is currently anchored at; drives layout vs re-add. */
  private hunkWidgetLine = 0;
  private resizeObserver: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private destroyed = false;

  /**
   * Per-instance id namespacing model URIs. Monaco's model registry is keyed
   * globally by URI, so two diff surfaces showing the same tab must not collide.
   */
  private readonly instanceId = `dv-${(DiffViewComponent.instanceCounter++).toString(
    36,
  )}-${Math.random().toString(36).slice(2, 8)}`;

  protected readonly loadState = signal<LoadState>('loading');
  protected readonly loadError = signal<string>('');

  /** D3: side-by-side (true) vs inline (false). Persisted per user. */
  protected readonly renderSideBySide = signal(true);

  /** True once the Monaco diff editor exists; gates decoration rendering. */
  private readonly editorReady = signal(false);

  /** The user's current hunk selection, bound to the snapshot it was made on. */
  private readonly selection = signal<HunkSelection | null>(null);

  /** A revert awaiting confirmation (D2 AC5). Non-null exactly while open. */
  protected readonly pendingRevert = signal<HunkSelection | null>(null);

  /** True while an apply RPC is in flight; suppresses a second write. */
  protected readonly applyInFlight = signal(false);

  /** Sanitized backend copy for the last refused or failed apply (D2 AC7). */
  protected readonly applyError = signal<string | null>(null);

  /** Which toolbar button owns the group's single tab stop (WAI-ARIA toolbar). */
  private readonly toolbarFocus = signal<HunkToolbarAction>('prev');

  /**
   * Element focused when the revert dialog opened — in practice the toolbar
   * button that raised it. Restored on close so a keyboard user lands back on
   * the control they pressed rather than at the top of the document.
   */
  private revertReturnFocus: HTMLElement | null = null;

  /** The diff descriptor, or null when the input carries a non-diff tab. */
  protected readonly diff = computed(() => this.diffTab()?.diff ?? null);

  protected readonly tabKey = computed(() => this.diffTab()?.filePath ?? '');

  protected readonly comparisonLabel = computed(() => {
    const d = this.diff();
    return d ? diffComparisonLabel(d.comparison) : '';
  });

  protected readonly isRename = computed(() => {
    const d = this.diff();
    return !!d && d.originalPath !== d.path;
  });

  protected readonly pathTitle = computed(() => {
    const d = this.diff();
    if (!d) return '';
    return d.originalPath === d.path ? d.path : `${d.originalPath} → ${d.path}`;
  });

  /**
   * A file that exists on only one side of the comparison.
   *
   * Driven exclusively by the resolved refs. Deriving this from
   * `original === ''` is the defect A3 AC5 names: an empty tracked file would
   * masquerade as a newly-added one.
   */
  protected readonly isNewFile = computed(
    () => this.diff()?.originalRef.kind === 'absent',
  );

  protected readonly isDeleted = computed(
    () => this.diff()?.modifiedRef.kind === 'absent',
  );

  protected readonly isBinary = computed(() => this.diff()?.isBinary === true);

  /** True when both sides resolved and are byte-identical (e.g. after discard). */
  protected readonly hasNoChanges = computed(() => {
    const d = this.diff();
    if (!d || d.isBinary) return false;
    if (d.originalRef.kind === 'absent' || d.modifiedRef.kind === 'absent') {
      return false;
    }
    return d.original === d.modified;
  });

  /**
   * The single chrome chip describing the shape of this diff.
   *
   * Suppressed entirely while the status is `error`: if a side could not be
   * read, the refs describe nothing, and claiming "deleted" or "new file" off
   * placeholder refs would be exactly the kind of fabricated state A3 exists
   * to remove.
   */
  protected readonly chromeLabel = computed(() => {
    if (this.diff()?.status === 'error') return '';
    if (this.isBinary()) return 'binary';
    if (this.isDeleted()) return 'deleted';
    if (this.isNewFile()) return 'new file';
    if (this.hasNoChanges()) return 'no changes';
    return '';
  });

  protected readonly statusLabel = computed(() => {
    switch (this.diff()?.status) {
      case 'refreshing':
        return 'refreshing…';
      case 'stale':
        return 'stale';
      case 'error':
        return 'error';
      default:
        return '';
    }
  });

  /** Message for the persistent error overlay; null when the read succeeded. */
  protected readonly gitError = computed(() => {
    const d = this.diff();
    if (!d || d.status !== 'error') return null;
    return d.errorMessage ?? 'Git could not read this file.';
  });

  protected readonly gitErrorDetail = computed(() =>
    this.diff()?.status === 'error' ? (this.diff()?.errorDetail ?? '') : '',
  );

  protected readonly headerAriaLabel = computed(() => {
    const d = this.diff();
    if (!d) return '';
    const chrome = this.chromeLabel();
    const status = this.statusLabel();
    return [
      `Diff of ${d.path}`,
      `${this.comparisonLabel()} comparison`,
      chrome,
      status,
    ]
      .filter(Boolean)
      .join(', ');
  });

  // -------------------------------------------------------------------------
  // D2 — hunk selection and affordances
  // -------------------------------------------------------------------------

  /** git's own `@@` positions for this diff. Ordinals only, never hunk bodies. */
  protected readonly hunks = computed<readonly GitHunkRef[]>(
    () => this.diff()?.hunks ?? [],
  );

  /**
   * Whether hunk actions exist at all for the diff on screen.
   *
   * Five independent conditions, each of which alone makes acting impossible or
   * unsafe. None is a restatement of another:
   *
   * - no apply function        — this surface has no git behind it at all
   * - binary                   — there are no textual hunks to select (AC10)
   * - status `error`           — a side could not be read, so the hunks and the
   *                              content on screen describe nothing; this is the
   *                              same reasoning that suppresses new/deleted
   *                              chrome on an error rather than inventing it
   * - empty snapshot token     — the backend answered without ever reaching a
   *                              real repository read, so there is no snapshot
   *                              for a write to be checked against
   * - no hunks                 — nothing to act on
   *
   * When this is false the toolbar is ABSENT, not disabled: D2 AC10 asks for
   * actions that are not there, not for actions that are there and fail.
   */
  protected readonly hunkActionsAvailable = computed(() => {
    if (!this.applyHunks()) return false;
    const d = this.diff();
    if (!d) return false;
    if (d.isBinary) return false;
    if (d.status === 'error') return false;
    if (d.snapshotToken === '') return false;
    return d.hunks.length > 0;
  });

  /**
   * The operations this comparison defines, in visual order.
   *
   * A presentation choice, not a guard — the authoritative matrix is enforced
   * on the backend, independently of the schema and before git is touched
   * (D2 AC12). Rendering the other cells would only produce a round trip that
   * comes back `INVALID_OPERATION`.
   */
  protected readonly hunkOperations = computed<GitApplyHunksOperation[]>(() =>
    this.diff()?.comparison === 'staged' ? ['unstage'] : ['stage', 'revert'],
  );

  /**
   * The selected hunk, or `null` when the selection no longer describes the
   * diff on screen.
   *
   * The token comparison is the client-side half of AC6 and the reason the
   * selection is stored rather than derived. It resolves to `null` — never to a
   * different hunk — when the tab was switched, or when a revalidation landed
   * and renumbered `hunks` while the ordinal sat in a signal.
   */
  protected readonly selectedHunk = computed<GitHunkRef | null>(() => {
    const sel = this.selection();
    const d = this.diff();
    if (!sel || !d) return null;
    if (sel.key !== this.tabKey()) return null;
    if (sel.snapshotToken === '' || sel.snapshotToken !== d.snapshotToken) {
      return null;
    }
    return d.hunks.find((h) => h.index === sel.index) ?? null;
  });

  /** 1-based position of the selected hunk in `hunks`, or 0 when none. */
  protected readonly hunkPosition = computed(() => {
    const selected = this.selectedHunk();
    if (!selected) return 0;
    return this.hunks().findIndex((h) => h.index === selected.index) + 1;
  });

  protected readonly hunkPositionLabel = computed(() => {
    const total = this.hunks().length;
    const position = this.hunkPosition();
    return position === 0
      ? `${total} ${total === 1 ? 'hunk' : 'hunks'}`
      : `Hunk ${position} of ${total}`;
  });

  protected readonly hunkToolbarLabel = computed(
    () => `Hunk actions — ${this.hunkPositionLabel()}`,
  );

  /**
   * Accessible name for the in-editor cluster (TASK_2026_221).
   *
   * Distinct wording from the header toolbar's, because the two are genuinely
   * different things in the same document: one is the full navigate-and-act
   * group, the other is an action cluster pinned to one hunk. Two groups
   * sharing a name would make a screen-reader's landmark list ambiguous.
   */
  protected readonly hunkWidgetLabel = computed(
    () => `Actions for ${this.hunkPositionLabel().toLowerCase()}`,
  );

  /**
   * Whether an action button would do anything if pressed.
   *
   * Nothing is selected until the user selects it: the toolbar deliberately
   * does NOT preselect hunk 1. Landing on the toolbar and pressing Enter would
   * otherwise write to the index or the working tree without the user having
   * chosen, or seen, which hunk.
   */
  protected readonly canApply = computed(
    () =>
      this.selectedHunk() !== null &&
      !this.applyInFlight() &&
      this.diff()?.status !== 'refreshing',
  );

  /** Every toolbar button, in DOM order — the roving tabindex's ring. */
  private readonly toolbarActions = computed<HunkToolbarAction[]>(() => [
    'prev',
    'next',
    ...this.hunkOperations(),
  ]);

  protected readonly revertDialogDescription = computed(() => {
    const pending = this.pendingRevert();
    const total = this.hunks().length;
    const position =
      pending === null
        ? 0
        : this.hunks().findIndex((h) => h.index === pending.index) + 1;
    const which = position === 0 ? 'This hunk' : `Hunk ${position} of ${total}`;
    return `${which} will be removed from ${this.diff()?.path ?? 'this file'} in the working tree. These lines are not staged and not committed, so this cannot be undone.`;
  });

  constructor() {
    void this.loadLayoutPreference();

    afterNextRender(() => {
      this.loader
        .load()
        .then((monacoApi) => {
          if (this.destroyed) return;
          this.createEditor(monacoApi);
          // The effects below only fire on SUBSEQUENT changes, so reconcile
          // once against whatever the inputs already hold.
          this.syncDiff(this.diffTab());
          this.evictClosedPairs(this.openDiffKeys());
          this.loadState.set('ready');
          this.editorReady.set(true);
          this.cdr.markForCheck();
        })
        .catch((err: unknown) => {
          if (this.destroyed) return;
          this.loadState.set('error');
          this.loadError.set(
            err instanceof Error ? err.message : String(err ?? 'Unknown error'),
          );
          this.cdr.markForCheck();
        });
    });

    // Declared BEFORE the eviction effect so that, in a flush where a tab is
    // closed, the closing tab is detached from the editor before its models are
    // disposed.
    effect(() => {
      const tab = this.diffTab();
      this.syncDiff(tab);
    });

    effect(() => {
      const keys = this.openDiffKeys();
      this.evictClosedPairs(keys);
    });

    effect(() => {
      const sideBySide = this.renderSideBySide();
      this.applyRenderSideBySide(sideBySide);
    });

    // Declared AFTER the diff effect so the models for the tab being rendered
    // are already attached — decorations belong to the attached model, and a
    // rebuild against the outgoing one would be discarded on the swap.
    effect(() => {
      this.editorReady();
      this.hunks();
      this.selectedHunk();
      this.renderHunkDecorations();
      this.syncHunkWidget();
    });

    // A stale apply error outliving the diff it described would read as a
    // complaint about the diff now on screen.
    //
    // The dialog goes through the SAME close path the buttons use, not a bare
    // `pendingRevert.set(null)`. The tab can change without a click — a file
    // opened over RPC does it — and a `<dialog>` that `@if` unmounts while it
    // is still `open` never runs its close steps: it leaves the top layer by
    // the removal rule instead, so focus is never handed back and lands on
    // `<body>`. Making this the same dismissal keeps "closed before unmounted"
    // an invariant of the component rather than of how it was dismissed.
    effect(() => {
      this.tabKey();
      untracked(() => {
        this.applyError.set(null);
        if (this.pendingRevert()) this.closeRevertDialog();
      });
    });

    // Promote the dialog into the top layer, then move focus to the
    // non-destructive choice. showModal() already focuses the first focusable
    // descendant, which happens to be Cancel; focusing it explicitly is what
    // makes that a guarantee of this component rather than of the button order.
    effect(() => {
      if (!this.pendingRevert()) return;
      const dialog = this.revertDialog()?.nativeElement;
      if (dialog && !dialog.open) dialog.showModal();
      this.revertCancel()?.nativeElement.focus();
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.glyphClickBinding?.dispose();
    this.glyphClickBinding = null;
    this.removeHunkWidget();
    this.hunkWidgetView?.destroy();
    this.hunkWidgetView = null;
    this.hunkWidgetHostNode = null;
    this.hunkDecorations?.clear();
    this.hunkDecorations = null;
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();
    this.currentKey = null;
    for (const key of [...this.pairs.keys()]) this.disposePair(key);
    this.viewStates.clear();
    try {
      this.editor?.dispose();
    } catch {
      // Monaco can throw if the editor was already disposed elsewhere.
      void 0;
    }
    this.editor = null;
    this.monacoApi = null;
  }

  private createEditor(monacoApi: MonacoApi): void {
    const container = this.editorContainer().nativeElement;
    this.monacoApi = monacoApi;

    this.ngZone.runOutsideAngular(() => {
      const editor = monacoApi.editor.createDiffEditor(container, {
        theme: this.detectMonacoTheme(),
        automaticLayout: false,
        // `readOnly` and `renderMarginRevertIcon` are PERMANENT (plan §4.3):
        // Monaco's built-in revert arrow edits the modified BUFFER, which is
        // the wrong mechanism for a git-backed diff. Hunk actions (D2) are
        // built as decorations instead, so no accidental edit is possible.
        readOnly: true,
        renderSideBySide: this.renderSideBySide(),
        scrollBeyondLastLine: false,
        renderIndicators: true,
        renderMarginRevertIcon: false,
        ignoreTrimWhitespace: false,
        // MUST be set explicitly: monaco-editor defaults `glyphMargin` to
        // FALSE (it is vscode that defaults it to true), and with it off the
        // per-hunk markers have nowhere to render — silently, with no error.
        glyphMargin: true,
        minimap: { enabled: false },
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
      });
      this.editor = editor;
      this.bindGlyphMargin(monacoApi, editor);

      this.resizeObserver = new ResizeObserver(() => {
        this.editor?.layout();
      });
      this.resizeObserver.observe(container);
      if (typeof document !== 'undefined') {
        this.themeObserver = new MutationObserver(() => {
          monacoApi.editor.setTheme(this.detectMonacoTheme());
        });
        const themeAttributes = [
          'data-vscode-theme-kind',
          'data-theme',
          'data-theme-mode',
        ];
        // Two targets, one observer: the VS Code host writes its kind onto
        // <body>, ThemeService writes daisyUI's onto <html>.
        this.themeObserver.observe(document.body, {
          attributes: true,
          attributeFilter: themeAttributes,
        });
        this.themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: themeAttributes,
        });
      }
    });
  }

  // -------------------------------------------------------------------------
  // Model lifecycle (B1, B2)
  // -------------------------------------------------------------------------

  /**
   * Reconcile the editor with the given diff tab.
   *
   * Switching tabs attaches a CACHED model pair and restores that tab's own
   * view state; a content update rewrites the attached models in place. The
   * editor itself is never recreated, which is the whole of B1 AC1.
   */
  private syncDiff(tab: EditorTab | null): void {
    const api = this.monacoApi;
    const editor = this.editor;
    if (!api || !editor) return;

    const diff = tab?.diff ?? null;
    if (!tab || !diff) {
      // No diff active: detach, keeping the pair cached for the return trip.
      if (this.currentKey) {
        this.saveViewState(this.currentKey);
        this.currentKey = null;
      }
      editor.setModel(null);
      return;
    }

    const key = tab.filePath;
    const language = this.detectLanguage(diff.path);

    let pair = this.pairs.get(key);
    if (!pair) {
      pair = this.createPair(api, key, diff.original, diff.modified, language);
    } else {
      // B2 AC1/AC2/AC5: rewrite in place. No dispose, no recreate, so Monaco
      // re-tokenizes incrementally instead of flashing unstyled text, and a
      // burst of updates cannot leak models.
      this.applyText(pair.original, diff.original);
      this.applyText(pair.modified, diff.modified);
      this.applyLanguage(api, pair.original, language);
      this.applyLanguage(api, pair.modified, language);
    }

    if (this.currentKey !== key) {
      if (this.currentKey) this.saveViewState(this.currentKey);
      editor.setModel({ original: pair.original, modified: pair.modified });
      this.currentKey = key;
      this.restoreViewState(key);
      this.scheduleLayout();
    }

    // Touch for LRU recency.
    this.pairs.delete(key);
    this.pairs.set(key, pair);
    this.enforcePairCap(key);
  }

  private createPair(
    api: MonacoApi,
    key: string,
    original: string,
    modified: string,
    language: string,
  ): DiffModelPair {
    return {
      original: this.getOrCreateModel(api, key, 'original', original, language),
      modified: this.getOrCreateModel(api, key, 'modified', modified, language),
    };
  }

  private getOrCreateModel(
    api: MonacoApi,
    key: string,
    side: 'original' | 'modified',
    content: string,
    language: string,
  ): monaco.editor.ITextModel {
    const uri = api.Uri.parse(
      `ptah-diff://${this.instanceId}/${encodeURIComponent(key)}/${side}`,
    );
    const existing = api.editor.getModel(uri);
    if (existing) {
      this.applyText(existing, content);
      this.applyLanguage(api, existing, language);
      return existing;
    }
    return api.editor.createModel(content, language, uri);
  }

  /** Rewrite a model's whole text without disposing it (B2 AC1). */
  private applyText(model: monaco.editor.ITextModel, text: string): void {
    if (model.getValue() === text) return;
    model.pushEditOperations(
      [],
      [{ range: model.getFullModelRange(), text }],
      () => null,
    );
  }

  /** Re-tokenize in place when the tab's language changes (B2 AC3). */
  private applyLanguage(
    api: MonacoApi,
    model: monaco.editor.ITextModel,
    language: string,
  ): void {
    if (model.getLanguageId() === language) return;
    api.editor.setModelLanguage(model, language);
  }

  private enforcePairCap(justAddedKey: string): void {
    if (this.pairs.size <= DiffViewComponent.MAX_DIFF_PAIRS) return;
    for (const key of [...this.pairs.keys()]) {
      if (this.pairs.size <= DiffViewComponent.MAX_DIFF_PAIRS) break;
      if (key === justAddedKey || key === this.currentKey) continue;
      this.disposePair(key);
    }
  }

  /**
   * Drop every cached pair whose tab is gone (B1 AC5) — including the wholesale
   * `openTabs` replacement a workspace switch performs (B1 AC6).
   *
   * The attached pair is never evicted here: it is by definition the tab the
   * user is looking at, and detaching is `syncDiff`'s job.
   */
  private evictClosedPairs(openKeys: readonly string[]): void {
    if (!this.monacoApi) return;
    const live = new Set(openKeys);
    for (const key of [...this.pairs.keys()]) {
      if (live.has(key) || key === this.currentKey) continue;
      this.disposePair(key);
    }
  }

  private disposePair(key: string): void {
    const pair = this.pairs.get(key);
    this.pairs.delete(key);
    this.viewStates.delete(key);
    if (!pair) return;
    if (this.currentKey === key) {
      this.currentKey = null;
      this.editor?.setModel(null);
    }
    pair.original.dispose();
    pair.modified.dispose();
  }

  // -------------------------------------------------------------------------
  // View state (B1 AC3, AC4)
  // -------------------------------------------------------------------------

  private saveViewState(key: string): void {
    const state = this.editor?.saveViewState();
    if (state) this.viewStates.set(key, state);
  }

  private restoreViewState(key: string): void {
    const state = this.viewStates.get(key);
    if (state) this.editor?.restoreViewState(state);
  }

  /**
   * Relayout on the next animation frame.
   *
   * MUST be `requestAnimationFrame`, not a microtask: the panel hides this
   * component with `[class.invisible]`, and a microtask can run before Angular
   * has flushed the class removal to the DOM, at which point Monaco measures a
   * zero-sized (still hidden) container and renders nothing.
   */
  private scheduleLayout(): void {
    if (typeof requestAnimationFrame !== 'function') return;
    this.ngZone.runOutsideAngular(() => {
      requestAnimationFrame(() => {
        if (this.destroyed) return;
        this.editor?.layout();
      });
    });
  }

  // -------------------------------------------------------------------------
  // D3 — inline / side-by-side layout
  // -------------------------------------------------------------------------

  protected toggleRenderSideBySide(): void {
    const next = !this.renderSideBySide();
    this.renderSideBySide.set(next);
    void this.persistLayoutPreference(next);
  }

  /** Swap layout on the LIVE editor — no recreation (D3 AC2, consistent with B1). */
  private applyRenderSideBySide(sideBySide: boolean): void {
    const editor = this.editor;
    if (!editor) return;
    const state = editor.saveViewState();
    editor.updateOptions({ renderSideBySide: sideBySide });
    if (state) editor.restoreViewState(state);
    this.scheduleLayout();
  }

  private async loadLayoutPreference(): Promise<void> {
    try {
      const result = await rpcCall<{ value?: boolean }>(
        this.vscodeService,
        'editor:getSetting',
        { key: DIFF_LAYOUT_SETTING_KEY },
      );
      if (this.destroyed) return;
      if (result.success && typeof result.data?.value === 'boolean') {
        this.renderSideBySide.set(result.data.value);
      }
    } catch {
      // A missing or unreadable preference is not an error worth surfacing —
      // side-by-side is the default and the toggle still works.
      void 0;
    }
  }

  private async persistLayoutPreference(sideBySide: boolean): Promise<void> {
    try {
      await rpcCall(this.vscodeService, 'editor:updateSetting', {
        key: DIFF_LAYOUT_SETTING_KEY,
        value: sideBySide,
      });
    } catch {
      void 0;
    }
  }

  // -------------------------------------------------------------------------
  // D2 — hunk stage / unstage / revert
  // -------------------------------------------------------------------------

  /**
   * Make the glyph margin a selection accelerator.
   *
   * A click that lands on a line belonging to no hunk changes NOTHING. Snapping
   * to the nearest hunk would let a slightly-missed click arm an operation on
   * something the user did not point at, and the next press would write it.
   */
  private bindGlyphMargin(
    api: MonacoApi,
    editor: monaco.editor.IStandaloneDiffEditor,
  ): void {
    const modified = editor.getModifiedEditor();
    this.glyphClickBinding = modified.onMouseDown((event) => {
      if (
        event.target.type !== api.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
      ) {
        return;
      }
      const line = event.target.position?.lineNumber;
      if (line === undefined) return;
      const model = modified.getModel();
      if (!model) return;
      const hunk = hunkAtLine(this.hunks(), line, model.getLineCount());
      if (!hunk || !this.hunkActionsAvailable()) return;
      this.ngZone.run(() => this.selectHunk(hunk.index));
    });
  }

  /**
   * Paint one marker per hunk on the modified side.
   *
   * Decorations only — NO view zones and NO model edits. A view zone would
   * shift the line numbers the user reads against git's `@@` positions, and an
   * edit would put text in a buffer that is not the file, on a surface whose
   * `readOnly: true` exists precisely so that cannot happen.
   */
  private renderHunkDecorations(): void {
    const api = this.monacoApi;
    const editor = this.editor;
    if (!api || !editor) return;

    const modified = editor.getModifiedEditor();
    const model = modified.getModel();
    const hunks = this.hunkActionsAvailable() ? this.hunks() : [];
    if (!model || hunks.length === 0) {
      this.hunkDecorations?.clear();
      return;
    }

    const selectedIndex = this.selectedHunk()?.index ?? null;
    const lineCount = model.getLineCount();
    const decorations: monaco.editor.IModelDeltaDecoration[] = hunks.map(
      (hunk, position) => {
        const { startLine, endLine } = hunkLineRange(hunk, lineCount);
        const isSelected = hunk.index === selectedIndex;
        return {
          range: new api.Range(startLine, 1, endLine, 1),
          options: {
            isWholeLine: true,
            glyphMarginClassName: isSelected
              ? 'ptah-hunk-glyph ptah-hunk-glyph-selected'
              : 'ptah-hunk-glyph',
            glyphMarginHoverMessage: {
              value: `Hunk ${position + 1} of ${hunks.length} — click to select`,
            },
            linesDecorationsClassName: isSelected
              ? 'ptah-hunk-line-selected'
              : null,
          },
        };
      },
    );

    this.ngZone.runOutsideAngular(() => {
      if (this.hunkDecorations) {
        this.hunkDecorations.set(decorations);
      } else {
        this.hunkDecorations =
          modified.createDecorationsCollection(decorations);
      }
    });
  }

  /**
   * Keep the in-editor action cluster on the selected hunk (TASK_2026_221).
   *
   * Added and REMOVED rather than left in place with a null position. Monaco's
   * documented behaviour for a content widget whose `getPosition()` returns
   * null is to park it off screen, not to unmount it — which would leave a
   * cluster of buttons in the accessibility tree describing a hunk that is no
   * longer selected. Removing it is the only way to say "there is nothing
   * here" without qualification.
   *
   * The embedded view is created once and reused across every reposition: its
   * content is signal-driven, so Angular updates it in place, and re-creating
   * it per selection would churn a DOM node Monaco holds a reference to.
   */
  private syncHunkWidget(): void {
    const api = this.monacoApi;
    const editor = this.editor;
    const template = this.hunkActionWidget();
    if (!api || !editor || !template) return;

    const selected = this.hunkActionsAvailable() ? this.selectedHunk() : null;
    const modified = editor.getModifiedEditor();
    const model = modified.getModel();
    if (!selected || !model) {
      this.removeHunkWidget();
      return;
    }
    const { startLine } = hunkLineRange(selected, model.getLineCount());

    if (this.hunkWidget) {
      // Same widget, new anchor line. `getPosition` closes over
      // `hunkWidgetLine`, so updating the field and asking Monaco to re-layout
      // is the whole move — removing and re-adding would drop the DOM node
      // Monaco already holds and make the cluster flicker on every step.
      this.hunkWidgetLine = startLine;
      this.ngZone.runOutsideAngular(() =>
        modified.layoutContentWidget(
          this.hunkWidget as monaco.editor.IContentWidget,
        ),
      );
      return;
    }

    const host = this.hunkWidgetHost();
    this.hunkWidgetLine = startLine;
    const preference = api.editor.ContentWidgetPositionPreference;
    const widgetId = `ptah.hunkActions.${this.instanceId}`;
    const widget: monaco.editor.IContentWidget = {
      getId: () => widgetId,
      getDomNode: () => host,
      getPosition: () => ({
        position: { lineNumber: this.hunkWidgetLine, column: 1 },
        // ABOVE first: the widget is anchored at modifiedStart, and rendering
        // it below that line would cover the first line of the very hunk the
        // user is deciding about.
        preference: [preference.ABOVE, preference.BELOW],
      }),
    };
    this.hunkWidget = widget;
    this.ngZone.runOutsideAngular(() => modified.addContentWidget(widget));
  }

  /**
   * The DOM node Monaco is handed, created once per component.
   *
   * The embedded view is instantiated at this component's own anchor and its
   * root nodes are then MOVED into this host. The view stays attached to the
   * change-detection tree — only its nodes relocate — which is exactly why
   * this is an embedded view and not constructed DOM: signals keep driving it
   * and the component's style scoping attribute travels with the nodes into
   * DOM Angular does not otherwise reach.
   */
  private hunkWidgetHost(): HTMLElement {
    const existing = this.hunkWidgetHostNode;
    if (existing) return existing;

    const template = this.hunkActionWidget();
    const host = document.createElement('div');
    host.className = 'ptah-hunk-widget';
    if (template) {
      const view = this.viewContainer.createEmbeddedView(template);
      this.hunkWidgetView = view;
      view.detectChanges();
      for (const node of view.rootNodes as Node[]) host.appendChild(node);
    }
    this.hunkWidgetHostNode = host;
    return host;
  }

  private removeHunkWidget(): void {
    const widget = this.hunkWidget;
    this.hunkWidget = null;
    this.hunkWidgetLine = 0;
    if (!widget) return;
    try {
      this.editor?.getModifiedEditor().removeContentWidget(widget);
    } catch {
      // Monaco throws if the editor was already disposed; the widget is gone
      // either way and this runs on the teardown path.
      void 0;
    }
  }

  /** Scroll a newly selected hunk into view (AC14 — see it before acting). */
  private revealHunk(index: number): void {
    const editor = this.editor;
    if (!editor) return;
    const hunk = this.hunks().find((h) => h.index === index);
    if (!hunk) return;
    const modified = editor.getModifiedEditor();
    const model = modified.getModel();
    if (!model) return;
    const { startLine } = hunkLineRange(hunk, model.getLineCount());
    this.ngZone.runOutsideAngular(() => {
      modified.revealLineInCenterIfOutsideViewport(startLine);
    });
  }

  /**
   * Select a hunk, stamping the snapshot it was selected against onto it.
   *
   * Refuses to record a selection when the diff carries no token: such a
   * response never reached a real repository read, so there is nothing for a
   * later write to be checked against.
   */
  private selectHunk(index: number): void {
    const d = this.diff();
    if (!d || d.snapshotToken === '') return;
    this.selection.set({
      key: this.tabKey(),
      index,
      snapshotToken: d.snapshotToken,
    });
    this.applyError.set(null);
    this.revealHunk(index);
    this.cdr.markForCheck();
  }

  /**
   * Move the selection by `delta` hunks, wrapping at both ends.
   *
   * With nothing selected the first press lands on the first (or last) hunk
   * rather than stepping from an imaginary position zero.
   */
  protected stepHunk(delta: number): void {
    const hunks = this.hunks();
    if (hunks.length === 0) return;
    const current = this.hunkPosition();
    const nextPosition =
      current === 0
        ? delta > 0
          ? 1
          : hunks.length
        : ((current - 1 + delta + hunks.length) % hunks.length) + 1;
    this.selectHunk(hunks[nextPosition - 1].index);
  }

  /**
   * Run a toolbar action.
   *
   * `revert` diverts to the confirmation dialog and writes nothing (AC5).
   * `stage` and `unstage` go straight through: each is the other's inverse, so
   * a mistaken press costs one more press to undo.
   */
  protected onHunkAction(action: GitApplyHunksOperation): void {
    if (!this.canApply()) return;
    const selection = this.selection();
    if (!selection || !this.selectedHunk()) return;

    if (action === 'revert') {
      this.revertReturnFocus =
        typeof document !== 'undefined' &&
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      this.pendingRevert.set(selection);
      return;
    }
    void this.runApply(action, selection);
  }

  /** Discard the hunk the dialog was opened for — never the one selected now. */
  protected confirmRevert(): void {
    const pending = this.pendingRevert();
    this.closeRevertDialog();
    if (!pending) return;
    void this.runApply('revert', pending);
  }

  protected cancelRevert(): void {
    this.closeRevertDialog();
  }

  private closeRevertDialog(): void {
    // Leave the top layer explicitly, before `@if` unmounts the node. Removing
    // an element that is still `open` skips its close steps, and the focus
    // restore below has to be the LAST word on focus — close() returns it to
    // whatever showModal() remembered, which is not necessarily the control
    // that raised this.
    const dialog = this.revertDialog()?.nativeElement;
    if (dialog?.open) dialog.close();
    this.pendingRevert.set(null);
    const target = this.revertReturnFocus;
    this.revertReturnFocus = null;
    if (target?.isConnected) target.focus();
  }

  /**
   * Keep the revert dialog's keyboard contract: Escape cancels, Tab stays in.
   *
   * There are exactly two focusable elements, so Tab and Shift+Tab are the same
   * two-way toggle. Escape is stopped here rather than handled on `document`
   * because focus is inside the dialog whenever it is open, and a key that
   * dismisses a dialog must not also reach anything behind it.
   */
  protected onRevertDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelRevert();
      return;
    }
    if (event.key !== 'Tab') return;
    const cancel = this.revertCancel()?.nativeElement;
    const confirm = this.revertConfirm()?.nativeElement;
    if (!cancel || !confirm) return;
    event.preventDefault();
    (document.activeElement === cancel ? confirm : cancel).focus();
  }

  /**
   * Escape as the browser's own close request, not as a keydown.
   *
   * `showModal()` hands the UA a second route to Escape that does not pass
   * through the handler above: it would close the element while `pendingRevert`
   * stayed set and `revertReturnFocus` stayed unrestored, leaving a component
   * that believes a dialog is open and a user looking at none. Cancelling the
   * default and calling the SAME `cancelRevert()` the button calls keeps one
   * close path however Escape arrives, and keeps Escape meaning Cancel — the
   * non-destructive choice — rather than meaning the UA's bare `close()`.
   */
  protected onRevertDialogCancel(event: Event): void {
    event.preventDefault();
    this.cancelRevert();
  }

  /**
   * Perform one apply and surface its outcome.
   *
   * The selection — token included — is passed through UNCHANGED from wherever
   * it was captured. For a revert that is the moment the dialog opened, not the
   * moment it was confirmed, so a revalidation arriving while the dialog was up
   * is refused by the coordinator instead of silently re-aiming at a renumbered
   * hunk.
   *
   * A thrown error is reported with our own generic sentence rather than its
   * message: an exception here is a frontend defect, and its text is not copy
   * that has been through the backend's sanitizer (NFR-8).
   */
  private async runApply(
    operation: GitApplyHunksOperation,
    selection: HunkSelection,
  ): Promise<void> {
    const apply = this.applyHunks();
    if (!apply) return;

    this.applyInFlight.set(true);
    this.applyError.set(null);
    this.cdr.markForCheck();
    try {
      const result = await apply({
        key: selection.key,
        operation,
        hunkIndices: [selection.index],
        snapshotToken: selection.snapshotToken,
      });
      if (result.success) {
        // The snapshot this selection named has just been consumed. The
        // post-apply refresh will invalidate it anyway by issuing a new token,
        // but that refresh is asynchronous: clearing here closes the window in
        // which a second press could re-submit the same ordinal. The backend's
        // AC6 check is the backstop, not the mechanism.
        this.selection.set(null);
      } else {
        this.applyError.set(result.message ?? APPLY_FAILED_MESSAGE);
      }
    } catch {
      this.applyError.set(APPLY_FAILED_MESSAGE);
    } finally {
      this.applyInFlight.set(false);
      this.cdr.markForCheck();
    }
  }

  // --- toolbar roving tabindex (AC14) --------------------------------------

  protected hunkTabIndex(action: HunkToolbarAction): number {
    return action === this.activeToolbarAction() ? 0 : -1;
  }

  /**
   * Move focus within the toolbar with the arrow keys, wrapping at both ends.
   *
   * Tab is deliberately untouched: it leaves the toolbar, which is the whole
   * point of a roving tabindex — the group is one stop in the page's tab order.
   */
  protected onHunkToolbarKeydown(event: KeyboardEvent): void {
    const delta =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0) return;
    const actions = this.toolbarActions();
    if (actions.length === 0) return;
    event.preventDefault();
    const from = actions.indexOf(this.focusedToolbarAction() ?? actions[0]);
    const next =
      actions[(Math.max(0, from) + delta + actions.length) % actions.length];
    this.toolbarFocus.set(next);
    this.focusToolbarButton(next);
  }

  /** Which button currently owns the group's single tab stop. */
  private activeToolbarAction(): HunkToolbarAction {
    const actions = this.toolbarActions();
    const remembered = this.toolbarFocus();
    return actions.includes(remembered) ? remembered : actions[0];
  }

  /**
   * The toolbar button that actually has DOM focus, if any.
   *
   * Read from the DOM rather than from `toolbarFocus` so that arrowing away
   * from a button the user reached by clicking it starts from where they are.
   */
  private focusedToolbarAction(): HunkToolbarAction | null {
    if (typeof document === 'undefined') return null;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const id = active.dataset['hunkAction'];
    return this.toolbarActions().find((a) => a === id) ?? null;
  }

  private focusToolbarButton(action: HunkToolbarAction): void {
    this.hunkToolbarButtons()
      .find((ref) => ref.nativeElement.dataset['hunkAction'] === action)
      ?.nativeElement.focus();
  }

  protected hunkActionIcon(action: GitApplyHunksOperation): LucideIconData {
    if (action === 'revert') return Undo2;
    return action === 'unstage' ? Minus : Plus;
  }

  protected hunkActionText(action: GitApplyHunksOperation): string {
    if (action === 'stage') return 'Stage';
    return action === 'unstage' ? 'Unstage' : 'Discard';
  }

  /**
   * Accessible name for an action button.
   *
   * Names the hunk it would act on, because "Stage" alone tells a screen-reader
   * user nothing about which of seven hunks is armed — and says so explicitly
   * when nothing is selected yet, since the button is `aria-disabled` rather
   * than removed from the focus order.
   */
  protected hunkActionLabel(action: GitApplyHunksOperation): string {
    const position = this.hunkPosition();
    const verb = this.hunkActionText(action);
    return position === 0
      ? `${verb} hunk — no hunk selected yet`
      : `${verb} hunk ${position} of ${this.hunks().length}`;
  }

  /**
   * Detect the appropriate Monaco theme based on the host environment:
   * 1. `data-vscode-theme-kind` (VS Code webview): `vscode-light` -> `vs`,
   *    `vscode-high-contrast` -> `hc-black`, `vscode-dark` -> `vs-dark`.
   * 2. `data-theme-mode` / `data-theme` (daisyUI): `light` -> `vs`, anything
   *    else -> `vs-dark`.
   * Returns `'vs-dark'` as the default and SSR-safe value when document is not available.
   *
   * BOTH `<html>` and `<body>` are read, and that is load-bearing rather than
   * defensive. `ThemeService` writes `data-theme` and `data-theme-mode` to
   * `document.documentElement`; VS Code writes `data-vscode-theme-kind` to
   * `document.body`. Reading only `<body>` — which is what this did until
   * TASK_2026_222 put a real window in front of a human — left the daisyUI
   * branch unreachable in every host, so Electron pinned the diff editor to
   * `vs-dark` no matter which theme the app was wearing.
   *
   * `data-theme-mode` is preferred over `data-theme` because it is the coarse
   * light/dark marker `ThemeService` maintains for exactly this purpose: of the
   * 34 daisyUI themes only one is literally named `light`, so matching on the
   * theme NAME would send `cupcake`, `winter` and `anubis-light` to a dark
   * editor.
   */
  private detectMonacoTheme(): string {
    if (typeof document === 'undefined') return 'vs-dark';
    const root = document.documentElement;

    const vscodeKind =
      document.body.getAttribute('data-vscode-theme-kind') ??
      root.getAttribute('data-vscode-theme-kind');
    if (vscodeKind === 'vscode-light') return 'vs';
    if (vscodeKind === 'vscode-high-contrast') return 'hc-black';
    if (vscodeKind === 'vscode-dark') return 'vs-dark';

    const mode =
      root.getAttribute('data-theme-mode') ??
      document.body.getAttribute('data-theme-mode');
    if (mode === 'light') return 'vs';
    if (mode === 'dark') return 'vs-dark';

    const dataTheme =
      root.getAttribute('data-theme') ??
      document.body.getAttribute('data-theme');
    if (dataTheme === 'light') return 'vs';

    return 'vs-dark';
  }

  private detectLanguage(filePath: string): string {
    if (!filePath) return 'plaintext';
    const ext = filePath.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      json: 'json',
      html: 'html',
      htm: 'html',
      css: 'css',
      scss: 'scss',
      less: 'less',
      py: 'python',
      rb: 'ruby',
      rs: 'rust',
      go: 'go',
      java: 'java',
      kt: 'kotlin',
      swift: 'swift',
      c: 'c',
      cpp: 'cpp',
      h: 'c',
      hpp: 'cpp',
      cs: 'csharp',
      php: 'php',
      md: 'markdown',
      yaml: 'yaml',
      yml: 'yaml',
      xml: 'xml',
      svg: 'xml',
      sql: 'sql',
      sh: 'shell',
      bash: 'shell',
      zsh: 'shell',
      ps1: 'powershell',
      dockerfile: 'dockerfile',
      toml: 'toml',
      ini: 'ini',
      cfg: 'ini',
      env: 'dotenv',
      graphql: 'graphql',
      gql: 'graphql',
      r: 'r',
      lua: 'lua',
      dart: 'dart',
      vue: 'html',
      svelte: 'html',
    };
    return languageMap[ext ?? ''] ?? 'plaintext';
  }
}
