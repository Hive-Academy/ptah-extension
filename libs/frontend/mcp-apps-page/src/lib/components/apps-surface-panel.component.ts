import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  AlertTriangle,
  LucideAngularModule,
  PanelsTopLeft,
} from 'lucide-angular';
import {
  SurfaceRendererComponent,
  type SurfaceActionInvoke,
  type SurfaceInputCommit,
  type SurfaceInteractionState,
  type SurfaceRenderable,
  type SurfaceSelectionChange,
  type SurfaceViewState,
} from '@ptah-extension/declarative-dashboard';
import { renderDashboardSpecText } from '@ptah-extension/shared/mcp-apps-contracts';
import { renderSurfaceText } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { AppsSessionService } from '../services/apps-session.service';
import { AppsSurfaceOperations } from '../services/apps-surface-operations.service';
import type { AppsSurfaceEntry } from '../state/apps-surface-reducer';

/** First line of every text fallback (Req 3.5, 3.6). */
export const APPS_UNSHOWN_TEXT = 'This app could not be shown.';

/** A host `lastSubmit` record that passed the render-time shape check. */
export interface AppsLastSubmitView {
  readonly status: 'applied' | 'indeterminate';
  readonly submittedAt: number;
}

/** One switcher tab. */
interface AppsSurfaceTab {
  readonly surfaceId: string;
  readonly tabId: string;
  readonly title: string;
  readonly active: boolean;
}

const NO_INTERACTION: SurfaceInteractionState = {
  selection: null,
  selectionUnsynced: false,
  pendingValues: new Map(),
  issues: new Map(),
  actions: new Map(),
  submitDisabled: true,
};

let nextPanelInstance = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The intake only checks that `lastSubmit` is an object (B11 carry-over), so
 * the shape is checked here before anything reaches a template or a pipe:
 * a known status and a non-negative epoch time that is a valid `Date` (a
 * finite number above the Date range, such as `Number.MAX_VALUE`, formats as
 * "NaN:NaN"). Anything else is not shown at all.
 */
export function readLastSubmit(value: unknown): AppsLastSubmitView | null {
  if (!isRecord(value)) return null;
  const status = value['status'];
  const submittedAt = value['submittedAt'];
  if (status !== 'applied' && status !== 'indeterminate') return null;
  if (
    typeof submittedAt !== 'number' ||
    !Number.isFinite(submittedAt) ||
    submittedAt < 0 ||
    Number.isNaN(new Date(submittedAt).getTime())
  )
    return null;
  return { status, submittedAt };
}

/** Switcher label: the surface title text, never markup. */
export function appsSurfaceTitle(entry: AppsSurfaceEntry): string {
  const renderable = entry.renderable;
  if (renderable.status !== 'accepted') return 'App not shown';
  const title: unknown =
    renderable.content.contract === 'dashboard-spec/2'
      ? renderable.content.surface.title?.text
      : renderable.content.spec.title?.text;
  return typeof title === 'string' && title.trim().length > 0
    ? title.trim()
    : 'Untitled app';
}

/**
 * The mono text fallback of one entry. A rejected document shows its reason
 * (Req 3.5); a document the renderer could not draw shows the same text the
 * model can produce: `renderDashboardSpecText` for v1, `renderSurfaceText`
 * for v2 (Req 3.6). Never throws.
 */
export function appsFallbackText(entry: AppsSurfaceEntry): string {
  const renderable = entry.renderable;
  if (renderable.status === 'rejected')
    return `${APPS_UNSHOWN_TEXT}\nReason: ${renderable.reason}`;
  try {
    const content = renderable.content;
    const text =
      content.contract === 'dashboard-spec/1'
        ? renderDashboardSpecText(content.spec)
        : renderSurfaceText({
            surfaceId: entry.surfaceId,
            revision: entry.materializedRevision,
            content,
            selection: renderable.selection,
            lastSubmit: renderable.lastSubmit,
          });
    return `${APPS_UNSHOWN_TEXT}\nReason: this page could not draw it. Its text follows.\n\n${text}`;
  } catch {
    return `${APPS_UNSHOWN_TEXT}\nReason: its text could not be produced either.`;
  }
}

/**
 * `AppsSurfacePanelComponent` — the surface side of the Apps page
 * (implementation-plan.md:663-671): switcher, renderer, text fallbacks and
 * notices.
 *
 * It holds no surface state: surfaces, the active id, the user's switcher
 * pick and every view state live in `AppsSessionService`; interaction state
 * in `AppsSurfaceOperations`. The one local signal records, per surface id,
 * which renderable the renderer reported as failed, so both failure paths (a
 * throwing `SURFACE_VIEW_MODEL_BUILDER` override, and a build that returns
 * `renderFailed`) arrive through the SAME `(renderFailed)` output and end in
 * the same mono fallback with the renderer subtree removed. Switching back to
 * a failed surface shows its fallback without mounting a renderer (no second
 * build); a new renderable of that surface (a push or a read) retries it.
 */
@Component({
  selector: 'ptah-apps-surface-panel',
  standalone: true,
  imports: [SurfaceRendererComponent, LucideAngularModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        container-type: inline-size;
        container-name: apps-surface;
      }
      /* Prototype proposal (a): stat and chart grids take one column when the
         panel itself is narrow (a narrow window or the embedded sidebar), not
         only below the viewport sm breakpoint. */
      @container apps-surface (max-width: 480px) {
        :host ::ng-deep .grid {
          grid-template-columns: minmax(0, 1fr);
        }
      }
    `,
  ],
  template: `
    @if (tabs().length > 1) {
      <div
        role="tablist"
        aria-label="Open apps"
        class="flex items-center gap-1 px-3 py-2 border-b border-base-300 overflow-x-auto shrink-0"
        (keydown)="onTabKeydown($event)"
      >
        @for (tab of tabs(); track tab.surfaceId) {
          <button
            type="button"
            role="tab"
            class="tab text-xs px-3 py-1.5 rounded-t-md whitespace-nowrap"
            [class.tab-active]="tab.active"
            [id]="tab.tabId"
            [attr.aria-selected]="tab.active"
            [attr.aria-controls]="panelId"
            [attr.tabindex]="tab.active ? 0 : -1"
            [attr.data-apps-focus-key]="'apps:switcher:' + tab.surfaceId"
            (click)="activate(tab.surfaceId)"
          >
            {{ tab.title }}
          </button>
        }
      </div>
    }

    <div
      class="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3"
      [id]="panelId"
      [attr.role]="tabs().length > 1 ? 'tabpanel' : null"
      [attr.aria-labelledby]="tabs().length > 1 ? activeTabId() : null"
      data-testid="apps-surface-body"
    >
      @for (notice of notices(); track $index) {
        <div
          role="status"
          class="flex items-start gap-2 px-3 py-2 rounded border-l-2 border-warning bg-base-300/30 text-sm text-base-content"
          data-testid="apps-notice"
        >
          <lucide-angular
            [img]="AlertTriangleIcon"
            class="w-4 h-4 text-warning shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <span>{{ notice }}</span>
        </div>
      }

      @if (activeEntry(); as entry) {
        @if (fallback(); as text) {
          <div
            class="flex items-start gap-2 rounded border-l-2 border-warning bg-base-200 p-3"
            data-testid="apps-fallback"
          >
            <lucide-angular
              [img]="AlertTriangleIcon"
              class="w-4 h-4 text-warning shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <pre
              class="m-0 flex-1 min-w-0 font-mono text-xs text-base-content whitespace-pre-wrap break-words"
              >{{ text }}</pre>
          </div>
        } @else if (renderable(); as content) {
          <!-- One renderer per surface: a switch mounts a fresh one. -->
          @for (id of [entry.surfaceId]; track id) {
            <ptah-surface-renderer
              [renderable]="content"
              [viewState]="entry.viewState"
              [interaction]="interaction()"
              (viewStateChange)="storeViewState(id, $event)"
              (inputCommit)="commit(id, $event)"
              (selectionChange)="select(id, $event)"
              (actionInvoke)="invoke(id, $event)"
              (renderFailed)="markRenderFailed(id, content)"
            />
          }
        }
        @if (lastSubmit(); as submit) {
          <p
            class="text-xs text-base-content-muted"
            data-testid="apps-last-submit"
          >
            @if (submit.status === 'applied') {
              Last submitted at {{ submit.submittedAt | date: 'shortTime' }}.
            } @else {
              Last submit at {{ submit.submittedAt | date: 'shortTime' }} may
              have been sent. Do not resend.
            }
          </p>
        }
      } @else if (notices().length === 0) {
        <div
          class="flex-1 flex flex-col items-center justify-center text-center px-6"
          data-testid="apps-empty"
        >
          <lucide-angular
            [img]="PanelsTopLeftIcon"
            class="w-7 h-7 mb-2 text-base-content-muted"
            aria-hidden="true"
          />
          <p class="text-sm font-medium text-base-content">No app yet</p>
          <p class="text-xs text-base-content-muted mt-1 max-w-xs">
            Ask for a dashboard or a form in the conversation to get started.
          </p>
        </div>
      }
    </div>
  `,
})
export class AppsSurfacePanelComponent {
  private readonly session = inject(AppsSessionService);
  private readonly operations = inject(AppsSurfaceOperations);

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly PanelsTopLeftIcon = PanelsTopLeft;

  private readonly instanceId = nextPanelInstance++;
  protected readonly panelId = `ptah-apps-surface-panel-${this.instanceId}`;

  /** Surface id → the renderable the renderer reported as failed. */
  private readonly failedRenderables = signal<
    ReadonlyMap<string, SurfaceRenderable>
  >(new Map());

  private readonly entries = computed(() => [
    ...this.session.surfaces().entries.values(),
  ]);

  protected readonly activeEntry = computed<AppsSurfaceEntry | null>(() => {
    const surfaces = this.session.surfaces();
    const id = surfaces.activeSurfaceId;
    return id === null ? null : (surfaces.entries.get(id) ?? null);
  });

  protected readonly tabs = computed<readonly AppsSurfaceTab[]>(() => {
    const activeId = this.activeEntry()?.surfaceId ?? null;
    return this.entries().map((entry, index) => ({
      surfaceId: entry.surfaceId,
      tabId: `${this.panelId}-tab-${index}`,
      title: appsSurfaceTitle(entry),
      active: entry.surfaceId === activeId,
    }));
  });

  protected readonly activeTabId = computed(
    () => this.tabs().find((tab) => tab.active)?.tabId ?? null,
  );

  /** Accepted content of the active entry, or null. */
  protected readonly renderable = computed<SurfaceRenderable | null>(() => {
    const renderable = this.activeEntry()?.renderable;
    return renderable?.status === 'accepted' ? renderable.content : null;
  });

  /** The mono fallback text, or null while the renderer may draw. */
  protected readonly fallback = computed<string | null>(() => {
    const entry = this.activeEntry();
    if (entry === null) return null;
    const content = this.renderable();
    if (
      content !== null &&
      this.failedRenderables().get(entry.surfaceId) !== content
    )
      return null;
    return appsFallbackText(entry);
  });

  /** Bound through a computed, never a template call (B8 carry-over). */
  protected readonly interaction = computed<SurfaceInteractionState>(() => {
    const entry = this.activeEntry();
    return entry === null
      ? NO_INTERACTION
      : this.operations.interaction(entry.surfaceId);
  });

  protected readonly lastSubmit = computed<AppsLastSubmitView | null>(() => {
    const renderable = this.activeEntry()?.renderable;
    return renderable?.status === 'accepted'
      ? readLastSubmit(renderable.lastSubmit)
      : null;
  });

  /**
   * Every `role="status"` notice of the shown slice. The reducer keeps ONE
   * eviction notice (the latest eviction replaces an earlier one; it clears
   * when that surface comes back), so this shows the latest, not a queue.
   */
  protected readonly notices = computed<readonly string[]>(() => {
    const out: string[] = [];
    const eviction = this.session.surfaces().notice;
    if (eviction !== null) out.push(eviction.text);
    const sync = this.session.syncNotice();
    if (sync !== null) out.push(sync);
    const entry = this.activeEntry();
    const selection =
      entry === null ? null : this.operations.notice(entry.surfaceId);
    if (selection !== null) out.push(selection);
    return out;
  });

  protected activate(surfaceId: string): void {
    this.session.activateSurface(surfaceId);
  }

  /** Stored verbatim and synchronously (B8 fix 1: no echo guard remains). */
  protected storeViewState(
    surfaceId: string,
    viewState: SurfaceViewState,
  ): void {
    this.session.setSurfaceViewState(surfaceId, viewState);
  }

  protected commit(surfaceId: string, commit: SurfaceInputCommit): void {
    this.operations.change(surfaceId, commit);
  }

  protected select(surfaceId: string, selection: SurfaceSelectionChange): void {
    this.operations.select(surfaceId, selection);
  }

  protected invoke(surfaceId: string, invoke: SurfaceActionInvoke): void {
    this.operations.submit(surfaceId, invoke);
  }

  /**
   * Record the failure of `surfaceId`'s current renderable. Records of
   * surfaces no longer held are dropped here, so the map stays bounded by
   * the held surfaces.
   */
  protected markRenderFailed(
    surfaceId: string,
    content: SurfaceRenderable,
  ): void {
    const held = this.session.surfaces().entries;
    this.failedRenderables.update((failed) => {
      const next = new Map<string, SurfaceRenderable>();
      for (const [id, renderable] of failed)
        if (held.has(id)) next.set(id, renderable);
      return next.set(surfaceId, content);
    });
  }

  /** Arrow keys, Home and End move between tabs and activate the target. */
  protected onTabKeydown(event: KeyboardEvent): void {
    const tabs = this.tabs();
    const current = tabs.findIndex((tab) => tab.active);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (current + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        next = (current - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = tabs[next];
    this.activate(target.surfaceId);
    const list = event.currentTarget;
    if (list instanceof HTMLElement)
      list.querySelector<HTMLElement>(`#${target.tabId}`)?.focus();
  }
}
