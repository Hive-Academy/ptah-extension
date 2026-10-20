import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import type { SafeResourceUrl } from '@angular/platform-browser';
import {
  LucideAngularModule,
  Maximize2,
  Minimize2,
  PanelTop,
} from 'lucide-angular';
import {
  ARTIFACT_HEIGHT_MAX,
  ARTIFACT_HEIGHT_MIN,
  ArtifactPageToHostMessageSchema,
  type ArtifactRecord,
} from '@ptah-extension/shared/mcp-apps-contracts';
import { ArtifactThemeBridgeService } from './artifact-theme-bridge.service';

/**
 * The one URL shape this viewer ever loads: the ptah-artifact scheme, one
 * opaque id host matching the protocol handler's own id pattern
 * (`apps/ptah-electron/src/artifacts/artifact-protocol.ts`), and the fixed
 * `/index.html` path. No query, no hash, no other scheme passes.
 */
const VIEWER_URL_PATTERN = /^ptah-artifact:\/\/[a-z0-9][a-z0-9-]{0,127}\/index\.html$/;

/** A frame that has not fired `load` within this window shows the error state. */
const LOAD_TIMEOUT_MS = 10_000;

/** Minimum spacing between applied height changes (fixed decision: ≥ 100 ms). */
const HEIGHT_THROTTLE_MS = 100;

/**
 * Clamp a page height into the fixed [ARTIFACT_HEIGHT_MIN, ARTIFACT_HEIGHT_MAX]
 * window. The schema already rejects values outside the range, so this is
 * defense in depth for the moment the frame reports its own height.
 */
export function clampArtifactHeight(px: number): number {
  return Math.min(
    ARTIFACT_HEIGHT_MAX,
    Math.max(ARTIFACT_HEIGHT_MIN, Math.round(px)),
  );
}

/**
 * ArtifactViewerComponent — the single sandboxed frame that renders one
 * published artifact (TASK_2026_710, batch 7).
 *
 * Fixed security decisions, none of them negotiable here:
 * - The frame is `<iframe sandbox="allow-scripts">` EXACTLY — no
 *   `allow-same-origin`, no forms, no popups — with
 *   `referrerpolicy="no-referrer"` and a `title`.
 * - `src` is the record's `viewerUrl` and nothing else, and only after it
 *   passes `VIEWER_URL_PATTERN` (see the sanitizer comment on
 *   `sanitizedSrc`). Never `[innerHTML]`, never `srcdoc`.
 * - A `window` `message` is accepted only when `event.source` is this
 *   frame's `contentWindow`, the payload passes
 *   `ArtifactPageToHostMessageSchema`, and the nonce matches the current
 *   bridge nonce. `height` is clamped and throttled; `open-link` is emitted
 *   for the host to route through the main-process allowlist — the viewer
 *   never calls `window.open`. Everything else is ignored.
 * - The listener is removed on destroy and on every src change, and the
 *   bridge detaches with it, so a stale frame cannot reach the host.
 *
 * Full screen reuses the SAME frame (the container classes switch, the iframe
 * element is never re-created): a fixed overlay with `role="dialog"` and
 * `aria-modal`, closed by Escape or the header button, restoring focus to
 * the element that opened it.
 */
@Component({
  selector: 'ptah-artifact-viewer',
  standalone: true,
  imports: [LucideAngularModule],
  providers: [ArtifactThemeBridgeService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Escape closes full screen; the guard inside makes it a no-op otherwise.
    '(document:keydown.escape)': 'onDocumentEscape()',
  },
  template: `
    @if (srcInvalid() || loadFailed()) {
      <p
        role="alert"
        class="rounded-box border border-base-content/15 p-3 text-xs text-base-content-muted"
        data-testid="artifact-viewer-error"
      >
        The artifact "{{ artifact().title }}" could not be displayed.
        @if (!srcInvalid()) { <button type="button" class="btn btn-ghost btn-xs" (click)="retry()">Retry</button> }
      </p>
    } @else {
      <div
        #dialog
        [class]="containerClass()"
        [attr.role]="fullscreenActive() ? 'dialog' : null"
        [attr.aria-modal]="fullscreenActive() ? 'true' : null"
        [attr.aria-label]="fullscreenActive()
          ? artifact().title + ' (full screen)'
          : null"
        data-testid="artifact-viewer"
      >
        <div class="flex shrink-0 items-center gap-2 px-1">
          <lucide-angular
            [img]="PanelIcon"
            class="h-4 w-4 shrink-0 text-base-content-muted"
            aria-hidden="true"
          />
          <span
            class="min-w-0 flex-1 truncate text-xs font-semibold text-base-content"
            [title]="artifact().title"
          >
            {{ artifact().title }}
          </span>
          <button
            type="button"
            class="btn btn-ghost btn-xs gap-1"
            (click)="toggleFullscreen()"
            [attr.aria-pressed]="fullscreenActive()"
            data-testid="artifact-viewer-fullscreen-toggle"
          >
            <lucide-angular
              [img]="fullscreenActive() ? ExitFullscreenIcon : FullscreenIcon"
              class="h-3.5 w-3.5"
              aria-hidden="true"
            />
            {{ fullscreenActive() ? 'Exit full screen' : 'Full screen' }}
          </button>
        </div>
        <iframe
          #frame
          class="w-full rounded-box border border-base-content/15 bg-base-100"
          [title]="artifact().title + ' artifact'"
          [src]="sanitizedSrc()"
          sandbox="allow-scripts"
          referrerpolicy="no-referrer"
          (load)="onFrameLoad()"
          [class.min-h-0]="fullscreenActive()"
          [class.flex-1]="fullscreenActive()"
          [style.height.px]="fullscreenActive() ? null : height()"
          data-testid="artifact-viewer-frame"
        ></iframe>
      </div>
    }
  `,
})
export class ArtifactViewerComponent implements OnDestroy {
  /** The immutable record to render. */
  readonly artifact = input.required<ArtifactRecord>();
  /** The host can also drive full screen from outside (the chat card). */
  readonly fullscreen = input(false);
  /** The full-screen state changed; the host may re-pin its own input. */
  readonly fullscreenChange = output<boolean>();
  /**
   * A validated `open-link` request. The host routes the URL through the
   * main-process allowlist; this component never opens it itself.
   */
  readonly openExternal = output<string>();

  private readonly document = inject(DOCUMENT);
  private readonly sanitizer = inject(DomSanitizer);
  /** The outgoing theme half of this frame's bridge (public for the specs). */
  readonly bridge = inject(ArtifactThemeBridgeService);

  protected readonly PanelIcon = PanelTop;
  protected readonly FullscreenIcon = Maximize2;
  protected readonly ExitFullscreenIcon = Minimize2;

  private readonly frameRef = viewChild<ElementRef<HTMLIFrameElement>>('frame');
  private readonly dialogRef = viewChild<ElementRef<HTMLElement>>('dialog');
  private dialogElement: HTMLElement | null = null;
  private readonly captureEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.onDialogEscape(event);
  };

  /** The frame never reported `load` within the window (or it failed). */
  protected readonly loadFailed = signal(false);
  /** The frame's requested height, clamped; the minimum until it speaks. */
  protected readonly height = signal(ARTIFACT_HEIGHT_MIN);

  /** True when the record's viewerUrl is not the exact protocol shape. */
  protected readonly srcInvalid = computed(
    () => !VIEWER_URL_PATTERN.test(this.artifact().viewerUrl),
  );

  /**
   * The trusted `src` for the validated protocol URL, or `null` when the
   * record's URL does not match (in which case no iframe renders at all).
   *
   * Angular's sanitizer rejects the custom `ptah-artifact:` scheme, so the
   * validated string is passed through `bypassSecurityTrustResourceUrl`.
   * That trust is given ONLY to a string that already passed
   * `VIEWER_URL_PATTERN` — the fixed scheme, one opaque id host and the
   * fixed `/index.html` path with no query or hash — so the bypass can only
   * ever load a host-named artifact page, never an arbitrary URL.
   */
  protected readonly sanitizedSrc = computed<SafeResourceUrl | null>(() => {
    const url = this.artifact().viewerUrl;
    if (!VIEWER_URL_PATTERN.test(url)) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  /** The internal half of the full-screen state (the input is the other). */
  private readonly internalFullscreen = signal(false);
  /** Effective full-screen state from both sources. */
  protected readonly fullscreenActive = computed(
    () => this.fullscreen() || this.internalFullscreen(),
  );

  /** In-panel column vs fixed overlay; the iframe inside is never re-created. */
  protected readonly containerClass = computed(() =>
    this.fullscreenActive()
      ? 'fixed inset-0 z-50 flex flex-col gap-2 bg-base-100 p-4 shadow-xl'
      : 'flex min-h-0 flex-1 flex-col gap-2',
  );

  /** The element that had focus when full screen opened, for restoration. */
  private opener: HTMLElement | null = null;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  private heightTimer: ReturnType<typeof setTimeout> | null = null;
  private messageListener: ((event: MessageEvent) => void) | null = null;
  private lastHeightAt = 0;
  private pendingHeight: number | null = null;

  constructor() {
    // A different viewerUrl is a new frame session: drop the old listener and
    // nonce (a stale frame keeps no channel), reset panel state, and re-arm
    // the load timeout. Runs for the first record as well.
    effect(() => {
      const url = this.artifact().viewerUrl;
      untracked(() => this.resetFrame(url));
    });
    // An external `fullscreen=false` clears an internal toggle so the two
    // halves never disagree; an internal toggle survives until closed.
    effect(() => {
      if (!this.fullscreen()) {
        untracked(() => this.internalFullscreen.set(false));
      }
    });
    // Full screen: capture the opener on entry, restore focus on exit.
    effect(() => {
      const on = this.fullscreenActive();
      untracked(() => {
        if (on) {
          const active = this.document.activeElement;
          this.opener = active instanceof HTMLElement ? active : null;
        } else if (this.opener !== null) {
          this.opener.focus();
          this.opener = null;
        }
      });
    });
    effect(() => {
      const dialog = this.fullscreenActive() ? this.dialogRef()?.nativeElement ?? null : null;
      if (this.dialogElement === dialog) return;
      this.detachDialogEscape();
      if (dialog !== null) {
        dialog.addEventListener('keydown', this.captureEscape, true);
        this.dialogElement = dialog;
      }
    });
  }

  ngOnDestroy(): void {
    this.detachDialogEscape();
    this.clearLoadTimer();
    this.clearHeightTimer();
    this.removeMessageListener();
    this.bridge.detach();
    this.opener = null;
  }

  protected toggleFullscreen(): void {
    this.setFullscreen(!this.fullscreenActive());
  }

  protected onDocumentEscape(): void {
    if (this.fullscreenActive()) this.setFullscreen(false);
  }
  protected onDialogEscape(event: Event): void {
    if (!this.fullscreenActive()) return;
    event.preventDefault();
    event.stopPropagation();
    this.setFullscreen(false);
  }
  private detachDialogEscape(): void {
    this.dialogElement?.removeEventListener('keydown', this.captureEscape, true);
    this.dialogElement = null;
  }
  protected retry(): void { this.resetFrame(this.artifact().viewerUrl); }

  private setFullscreen(value: boolean): void {
    this.internalFullscreen.set(value);
    this.fullscreenChange.emit(value);
  }

  /** The frame finished loading: bind the bridge and open the channel. */
  protected onFrameLoad(): void {
    this.clearLoadTimer();
    const contentWindow = this.frameRef()?.nativeElement.contentWindow;
    if (contentWindow === null || contentWindow === undefined) { this.loadFailed.set(true); return; }
    this.bridge.attach(contentWindow);
    this.addMessageListener();
  }

  private resetFrame(url: string): void {
    this.clearLoadTimer();
    this.removeMessageListener();
    this.bridge.detach();
    this.loadFailed.set(false);
    this.height.set(ARTIFACT_HEIGHT_MIN);
    this.pendingHeight = null;
    this.clearHeightTimer();
    if (VIEWER_URL_PATTERN.test(url)) this.armLoadTimeout();
  }

  private armLoadTimeout(): void {
    this.clearLoadTimer();
    this.loadTimer = setTimeout(() => {
      this.loadTimer = null;
      this.removeMessageListener();
      this.bridge.detach();
      this.loadFailed.set(true);
    }, LOAD_TIMEOUT_MS);
  }

  private clearLoadTimer(): void {
    if (this.loadTimer === null) return;
    clearTimeout(this.loadTimer);
    this.loadTimer = null;
  }

  private clearHeightTimer(): void {
    if (this.heightTimer === null) return;
    clearTimeout(this.heightTimer);
    this.heightTimer = null;
  }

  private addMessageListener(): void {
    const win = this.document.defaultView;
    if (win === null || this.messageListener !== null) return;
    const listener = (event: MessageEvent): void => {
      this.onFrameMessage(event);
    };
    this.messageListener = listener;
    win.addEventListener('message', listener);
  }

  private removeMessageListener(): void {
    const win = this.document.defaultView;
    const listener = this.messageListener;
    if (win === null || listener === null) return;
    win.removeEventListener('message', listener);
    this.messageListener = null;
  }

  /**
   * The incoming half of the bridge. Three gates, all of them required:
   * the message must come from this frame's content window, pass the strict
   * schema, and echo the current nonce. A stale frame (src changed, nonce
   * cleared) fails the third gate even though its window object may match.
   */
  private onFrameMessage(event: MessageEvent): void {
    const frameWindow = this.frameRef()?.nativeElement.contentWindow;
    if (frameWindow === null || frameWindow === undefined) return;
    if (event.source !== frameWindow) return;
    const parsed = ArtifactPageToHostMessageSchema.safeParse(event.data);
    if (!parsed.success) return;
    if (parsed.data.nonce !== this.bridge.nonce()) return;
    if (parsed.data.type === 'height') {
      this.applyHeight(parsed.data.px);
      return;
    }
    // `open-link`: the schema already restricts the URL to HTTP(S); the host
    // allowlist re-checks it. This component never opens it directly.
    this.openExternal.emit(parsed.data.url);
  }

  /** Clamp into the fixed window, then throttle to one change per 100 ms. */
  private applyHeight(px: number): void {
    const clamped = clampArtifactHeight(px);
    const now = Date.now();
    const sinceLast = now - this.lastHeightAt;
    if (sinceLast < HEIGHT_THROTTLE_MS) {
      // Trailing edge: the newest value wins when the window reopens.
      this.pendingHeight = clamped;
      this.clearHeightTimer();
      this.heightTimer = setTimeout(() => {
        this.heightTimer = null;
        const pending = this.pendingHeight;
        this.pendingHeight = null;
        if (pending === null) return;
        this.lastHeightAt = Date.now();
        this.height.set(pending);
      }, HEIGHT_THROTTLE_MS - sinceLast);
      return;
    }
    this.lastHeightAt = now;
    this.height.set(clamped);
  }
}
