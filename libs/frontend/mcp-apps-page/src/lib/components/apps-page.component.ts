import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { LucideAngularModule, X } from 'lucide-angular';
import { ElectronLayoutService } from '@ptah-extension/core';
import { ElectronResizeHandleComponent } from '@ptah-extension/chat-ui';
import { AppsSessionService } from '../services/apps-session.service';
import { AppsFocusMemoryDirective } from './apps-focus-memory.directive';
import { AppsSurfacePanelComponent } from './apps-surface-panel.component';
import { AppsTranscriptComponent } from './apps-transcript.component';

/**
 * `AppsPageComponent` — the routed Apps page (implementation-plan.md:648-693).
 *
 * Host, composer and layout only. Every piece of conversation and surface
 * state lives in the root `AppsSessionService` (per workspace slice), so
 * leaving the tab and coming back shows the same transcript, surfaces, view
 * states and overlays (Req 2.4). The host carries `AppsFocusMemoryDirective`
 * (`tabindex="-1"`), which restores the last focused control of the slice
 * after a re-create (Req 7.6).
 *
 * The only local conversation value is the composer's draft text: an
 * uncommitted form control value, not conversation state. It is cleared when
 * a turn is sent and put back when that send fails (a failed `start()`, a
 * failed continue, or a send before the session resolved — B12 N4), unless
 * the user has already typed something new. The splitter adds a measured
 * container width and two per-gesture fields, never a width of its own.
 *
 * Layout: a CSS grid of three columns — the conversation column
 * (`--apps-conversation-width`), the `apps-split-handle-slot` splitter, and
 * the surface panel. The page is an `apps-page` inline-size container: at
 * 480px or less (a narrow window or the embedded sidebar) the columns stack
 * vertically and the splitter is removed (prototype proposal a).
 *
 * Splitter (Batch 20): the width lives in `ElectronLayoutService`
 * (`appsSplitWidth`, persisted with the other Electron panel widths). The
 * page reuses `ptah-electron-resize-handle`, whose pointer X is
 * viewport-relative, so it subtracts the page's left edge. It clamps so the
 * surface panel keeps >= 360px, and adds keyboard resize and the ARIA value
 * attributes on a focusable `role="separator"`. A drag or key run persists
 * once, when it ends.
 */
const SPLIT_HANDLE_WIDTH = 6; // `.resize-handle` width in RESIZE_HANDLE_STYLES
const SURFACE_MIN_WIDTH = 360;
const STACKED_MAX_WIDTH = 480; // the `@container apps-page` breakpoint below
const SPLIT_KEY_STEP = 16;
const SPLIT_KEY_STEP_LARGE = 64;
const SPLIT_KEY_DIRECTION: Readonly<Record<string, -1 | 1 | undefined>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
};

@Component({
  selector: 'ptah-apps-page',
  standalone: true,
  imports: [
    AppsTranscriptComponent,
    AppsSurfacePanelComponent,
    ElectronResizeHandleComponent,
    LucideAngularModule,
  ],
  hostDirectives: [AppsFocusMemoryDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'apps-page',
  },
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-height: 0;
        outline: none;
        container-type: inline-size;
        container-name: apps-page;
      }
      .apps-layout {
        display: grid;
        grid-template-columns:
          var(--apps-conversation-width, 360px)
          auto
          minmax(0, 1fr);
        flex: 1 1 auto;
        min-height: 0;
      }
      .apps-conversation {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
      }
      .apps-split-handle-slot {
        display: flex;
        outline: none;
      }
      @container apps-page (max-width: 480px) {
        .apps-layout {
          grid-template-columns: minmax(0, 1fr);
          grid-auto-rows: auto;
          overflow-y: auto;
        }
        .apps-conversation {
          border-right: none;
          border-bottom: 1px solid var(--fallback-b3, oklch(var(--b3)));
          max-height: 260px;
        }
        .apps-split-handle-slot {
          display: none;
        }
        .apps-surface {
          min-height: 480px;
        }
      }
    `,
  ],
  template: `
    <div
      class="apps-layout bg-base-100 text-base-content"
      [style.--apps-conversation-width]="splitWidth() + 'px'"
    >
      <section
        id="apps-conversation-column"
        class="apps-conversation border-r border-base-300"
        aria-labelledby="apps-page-title"
      >
        <header
          class="flex items-center justify-between gap-2 px-3 py-2 border-b border-base-300 shrink-0"
        >
          <div class="min-w-0">
            <h1 id="apps-page-title" class="text-sm font-semibold">Apps</h1>
            <p class="text-[11px] text-base-content-muted">
              Conversation for this page only. The coding chat is unaffected.
            </p>
          </div>
          @if (hasConversation()) {
            <button
              type="button"
              class="btn btn-ghost btn-xs shrink-0"
              data-apps-focus-key="apps:new-conversation"
              data-testid="apps-new-conversation"
              (click)="newConversation()"
            >
              New conversation
            </button>
          }
        </header>

        <ptah-apps-transcript />

        <div
          class="border-t border-base-300 p-2 flex flex-col gap-1.5 shrink-0"
        >
          @if (session.error(); as error) {
            <div
              role="alert"
              class="flex items-start gap-2 px-2 py-1.5 rounded border-l-2 border-error bg-base-300/30 text-xs text-base-content"
              data-testid="apps-error"
            >
              <span class="flex-1">{{ error }}</span>
              <button
                type="button"
                class="btn btn-ghost btn-xs btn-square shrink-0"
                aria-label="Dismiss error"
                (click)="session.clearError()"
              >
                <lucide-angular
                  [img]="XIcon"
                  class="w-3.5 h-3.5"
                  aria-hidden="true"
                />
              </button>
            </div>
          }
          @if (session.notice(); as notice) {
            <div
              role="status"
              class="flex items-start gap-2 px-2 py-1.5 rounded border-l-2 border-warning bg-base-300/30 text-xs text-base-content"
              data-testid="apps-conversation-notice"
            >
              <span class="flex-1">{{ notice }}</span>
              <button
                type="button"
                class="btn btn-ghost btn-xs btn-square shrink-0"
                aria-label="Dismiss notice"
                (click)="session.clearNotice()"
              >
                <lucide-angular
                  [img]="XIcon"
                  class="w-3.5 h-3.5"
                  aria-hidden="true"
                />
              </button>
            </div>
          }
          <textarea
            class="textarea textarea-bordered w-full text-sm resize-none"
            rows="2"
            placeholder="Ask for a dashboard, a form, or a change…"
            aria-label="Message the Apps conversation"
            data-apps-focus-key="apps:composer"
            data-testid="apps-composer"
            [value]="draft()"
            (input)="onDraftInput($event)"
            (keydown.enter)="onEnter($event)"
          ></textarea>
          <div class="flex items-center justify-between">
            @if (hasConversation()) {
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                data-apps-focus-key="apps:stop"
                [disabled]="!session.isProcessing()"
                [attr.title]="
                  session.isProcessing() ? null : 'No turn is running right now'
                "
                (click)="stop()"
              >
                Stop
              </button>
            } @else {
              <span></span>
            }
            <button
              type="button"
              class="btn btn-primary btn-xs"
              data-apps-focus-key="apps:send"
              data-testid="apps-send"
              [disabled]="!canSend()"
              (click)="send()"
            >
              Send
            </button>
          </div>
        </div>
      </section>

      <!-- Splitter: absent when the columns stack. -->
      @if (!stacked()) {
        <div
          class="apps-split-handle-slot focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60"
          role="separator"
          tabindex="0"
          aria-orientation="vertical"
          aria-label="Resize the conversation column"
          aria-controls="apps-conversation-column"
          aria-keyshortcuts="ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight"
          data-apps-focus-key="apps:splitter"
          data-testid="apps-split-handle-slot"
          [attr.aria-valuenow]="splitWidth()"
          [attr.aria-valuemin]="splitMinWidth"
          [attr.aria-valuemax]="splitMaxWidth()"
          (keydown)="onSplitKeydown($event)"
          (keyup)="onSplitKeyup($event)"
          (blur)="commitKeyResize()"
          (mousedown)="onSplitPointerDown($event)"
        >
          <ptah-electron-resize-handle
            [direction]="'left'"
            (dragMoved)="onSplitDragMoved($event)"
            (dragEnded)="onSplitDragEnded()"
          />
        </div>
      }

      <ptah-apps-surface-panel class="apps-surface" />
    </div>
  `,
})
export class AppsPageComponent {
  protected readonly session = inject(AppsSessionService);
  private readonly layout = inject(ElectronLayoutService);
  private readonly host =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly XIcon = X;

  /**
   * The page's measured inline size (null until first measured). A layout
   * reading, not split state: the split width itself is the service's.
   */
  private readonly containerWidth = signal<number | null>(null);

  /** Mirrors the `@container apps-page (max-width: 480px)` stacking rule. */
  protected readonly stacked = computed(() => {
    const width = this.containerWidth();
    return width !== null && width <= STACKED_MAX_WIDTH;
  });

  protected readonly splitMinWidth = this.layout.appsSplitMinWidth;

  /** Largest conversation width that leaves the surface panel >= 360px. */
  protected readonly splitMaxWidth = computed(() => {
    const width = this.containerWidth();
    const staticMax = this.layout.appsSplitMaxWidth;
    if (width === null) return staticMax;
    const fit = Math.floor(width - SPLIT_HANDLE_WIDTH - SURFACE_MIN_WIDTH);
    return Math.max(this.splitMinWidth, Math.min(staticMax, fit));
  });

  /** The conversation column width actually laid out and announced. */
  protected readonly splitWidth = computed(() =>
    Math.round(Math.min(this.layout.appsSplitWidth(), this.splitMaxWidth())),
  );

  /**
   * The pointer drag in progress: where the handle was grabbed, the width
   * shown at mousedown, and the stored preference at mousedown.
   */
  private drag: {
    grabOffset: number;
    startShown: number;
    startStored: number;
  } | null = null;
  /** Stored preference when the current key run began; null when idle. */
  private keyRunStartStored: number | null = null;

  public constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => {
      this.commitKeyResize();
      this.onSplitDragEnded();
    });
    // No ResizeObserver (non-browser test env): the splitter stays shown and
    // only the static bounds apply; the CSS container query still stacks.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries.at(-1)?.contentRect.width;
      if (width !== undefined && Number.isFinite(width))
        this.containerWidth.set(width);
    });
    observer.observe(this.host);
    destroyRef.onDestroy(() => observer.disconnect());
  }

  /**
   * Records the grab point, so the column does not jump by it and the
   * handle's Escape/blur restore (which re-emits the mousedown X) lands on
   * the starting width, plus the shown and stored widths at the start.
   */
  protected onSplitPointerDown(event: MouseEvent): void {
    const startShown = this.splitWidth();
    const offset =
      event.clientX - this.host.getBoundingClientRect().left - startShown;
    this.drag = {
      grabOffset: Number.isFinite(offset) ? offset : 0,
      startShown,
      startStored: this.layout.appsSplitWidth(),
    };
  }

  /**
   * `pointerX` is viewport-relative; the column starts at the page's left
   * edge. A frame that shows the drag-start width puts the start preference
   * back, so a drag with no visible change (e.g. past the container max
   * while a wider stored width is shown clamped) never overwrites it.
   */
  protected onSplitDragMoved(pointerX: number): void {
    const drag = this.drag;
    if (drag === null) return;
    const left = this.host.getBoundingClientRect().left;
    const target = this.clampSplitWidth(pointerX - left - drag.grabOffset);
    if (target === null) return;
    this.layout.setAppsSplitWidth(
      target === drag.startShown ? drag.startStored : target,
    );
  }

  /**
   * Persists only a changed preference: an Escape/blur cancel or a plain
   * click writes nothing. Also runs on destroy, for a drag cut short.
   */
  protected onSplitDragEnded(): void {
    const drag = this.drag;
    if (drag === null) return;
    this.drag = null;
    if (this.layout.appsSplitWidth() !== drag.startStored)
      this.layout.commitAppsSplitWidth();
  }

  /**
   * Left/Right resize the shown width by 16px (Shift: 64px); persisted on
   * key release. A step that cannot visibly move (at a bound) is skipped,
   * so it never overwrites a wider stored preference shown clamped.
   */
  protected onSplitKeydown(event: KeyboardEvent): void {
    const direction = SPLIT_KEY_DIRECTION[event.key];
    if (direction === undefined) return;
    event.preventDefault();
    const shown = this.splitWidth();
    const step = event.shiftKey ? SPLIT_KEY_STEP_LARGE : SPLIT_KEY_STEP;
    const target = this.clampSplitWidth(shown + direction * step);
    if (target === null || target === shown) return;
    this.keyRunStartStored ??= this.layout.appsSplitWidth();
    this.layout.setAppsSplitWidth(target);
  }

  protected onSplitKeyup(event: KeyboardEvent): void {
    if (SPLIT_KEY_DIRECTION[event.key] !== undefined) this.commitKeyResize();
  }

  /**
   * Also runs on blur and destroy, so focus leaving mid key-repeat still
   * persists. A run that ends on its starting width writes nothing.
   */
  protected commitKeyResize(): void {
    const start = this.keyRunStartStored;
    if (start === null) return;
    this.keyRunStartStored = null;
    if (this.layout.appsSplitWidth() !== start)
      this.layout.commitAppsSplitWidth();
  }

  /** Whole pixels within [min, container max]; null for a non-finite input. */
  private clampSplitWidth(width: number): number | null {
    if (!Number.isFinite(width)) return null;
    return Math.round(
      Math.min(Math.max(width, this.splitMinWidth), this.splitMaxWidth()),
    );
  }

  /** The composer's uncommitted text; see the class doc. */
  protected readonly draft = signal('');

  protected readonly hasConversation = this.session.isActive;

  protected readonly canSend = computed(
    () => this.draft().trim().length > 0 && !this.session.isProcessing(),
  );

  protected onDraftInput(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement) this.draft.set(target.value);
  }

  /** Enter sends; Shift+Enter keeps its newline. */
  protected onEnter(event: Event): void {
    if (event instanceof KeyboardEvent && event.shiftKey) return;
    event.preventDefault();
    void this.send();
  }

  /**
   * Send the draft as a turn (the first one starts the conversation). The
   * session never throws; a failure shows in `session.error()`, and then the
   * draft comes back so the user does not lose what they wrote.
   */
  public async send(): Promise<void> {
    const typed = this.draft();
    const prompt = typed.trim();
    if (prompt.length === 0 || this.session.isProcessing()) return;
    this.draft.set('');
    await this.session.send(prompt);
    if (this.session.error() !== null && this.draft().length === 0)
      this.draft.set(typed);
  }

  protected async stop(): Promise<void> {
    await this.session.abort();
  }

  /**
   * The session stops a running agent first and discards only the
   * conversation shown when the button was pressed; a failed stop keeps it
   * and shows a notice (`AppsSessionService.resetConversation`).
   */
  protected async newConversation(): Promise<void> {
    await this.session.resetConversation();
  }
}
