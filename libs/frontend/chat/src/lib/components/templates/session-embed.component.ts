import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  OnDestroy,
  computed,
  createEnvironmentInjector,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { SURFACE_ACTIVE } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { RailTranscriptRetentionCoordinator } from '../../services/rail-transcript-retention-coordinator.service';
import {
  SESSION_EMBED_CHROME,
  type SessionEmbedChrome,
} from '../../tokens/session-embed-chrome.token';
import {
  RAIL_TRANSCRIPT_RETENTION,
  SESSION_CARD_ACTIONS,
  SESSION_CONTEXT,
  SESSION_FOCUSED,
  SESSION_START_GUARD,
  SESSION_STOP_HANDLER,
  SESSION_VISIBLE,
  type SessionCardActions,
  type SessionStartGuard,
  type SessionStopHandler,
} from '../../tokens/session-context.token';
import {
  ChatViewComponent,
  RAIL_MIN_CONTENT_WIDTH,
} from './chat-view.component';

/** A normal chat session hosted by a rail pane or workflow surface. */
@Component({
  selector: 'ptah-session-embed',
  standalone: true,
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full min-h-0' },
  template: `
    <ng-content select="[sessionHeader]" />
    <ng-container
      *ngComponentOutlet="chatView; environmentInjector: childInjector"
    />
    <ng-content select="[sessionAddon]" />
  `,
})
export class SessionEmbedComponent implements OnDestroy {
  private readonly parentInjector = inject(EnvironmentInjector);
  private readonly tabManager = inject(TabManagerService);
  private readonly coordinator = inject(RailTranscriptRetentionCoordinator, {
    optional: true,
  });
  private readonly parentActive = inject(SURFACE_ACTIVE, { optional: true });

  readonly tabId = input.required<string>();
  readonly chrome = input<SessionEmbedChrome>('full');
  readonly visible = input(true);
  /** Hide transcript work while a lane covers it without hiding its session surface. */
  readonly contentVisible = input(true);
  readonly focused = input(true);
  readonly minContentWidth = input<number | null>(null);
  readonly startGuard = input<SessionStartGuard | null>(null);
  readonly stopHandler = input<SessionStopHandler | null>(null);
  readonly cardActions = input<SessionCardActions | null>(null);
  readonly retainRailTranscript = input(false);

  readonly chatView = ChatViewComponent;
  private readonly context = computed<string | null>(() => this.tabId());
  private readonly active = computed(
    () => (this.parentActive?.() ?? true) && this.visible(),
  );
  private readonly sessionVisible = computed(
    () => this.active() && this.contentVisible(),
  );
  private readonly sessionFocused = computed(
    () => this.sessionVisible() && this.focused(),
  );
  readonly childInjector = createEnvironmentInjector(
    [
      { provide: SESSION_CONTEXT, useValue: this.context },
      { provide: SESSION_EMBED_CHROME, useFactory: () => this.chrome() },
      { provide: SESSION_VISIBLE, useValue: this.sessionVisible },
      { provide: SESSION_FOCUSED, useValue: this.sessionFocused },
      { provide: RAIL_MIN_CONTENT_WIDTH, useValue: this.minContentWidth },
      {
        provide: SESSION_START_GUARD,
        useValue: () => this.startGuard()?.() ?? null,
      },
      {
        provide: SESSION_STOP_HANDLER,
        useValue: (tabId: string) =>
          this.stopHandler()?.(tabId) ?? 'not-handled',
      },
      { provide: SURFACE_ACTIVE, useValue: this.sessionVisible },
      {
        provide: RAIL_TRANSCRIPT_RETENTION,
        // Boolean token: ChatView reads this once when its injector creates it.
        useFactory: () => this.retainRailTranscript(),
      },
      ...(this.coordinator
        ? [
            {
              provide: RailTranscriptRetentionCoordinator,
              useValue: this.coordinator,
            },
          ]
        : []),
      {
        provide: SESSION_CARD_ACTIONS,
        // Preserve null at creation: compact cards use it to hide actions.
        useFactory: () =>
          this.cardActions()
            ? ({
                openLane: (laneKey: string) =>
                  this.cardActions()?.openLane(laneKey),
                openSession: () => this.cardActions()?.openSession(),
              } satisfies SessionCardActions)
            : null,
      },
    ],
    this.parentInjector,
  );

  private readonly registration = effect((onCleanup) => {
    const id = this.tabId();
    if (!id || !this.active()) return;
    untracked(() => this.tabManager.registerVisibleTab(id));
    onCleanup(() => untracked(() => this.tabManager.unregisterVisibleTab(id)));
  });

  ngOnDestroy(): void {
    this.childInjector.destroy();
  }
}
