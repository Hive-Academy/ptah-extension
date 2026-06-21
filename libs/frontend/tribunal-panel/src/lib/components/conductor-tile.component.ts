import {
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  OnDestroy,
  OnInit,
  computed,
  createEnvironmentInjector,
  inject,
  signal,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { LucideAngularModule, Gavel } from 'lucide-angular';
import { ChatViewComponent, SESSION_CONTEXT } from '@ptah-extension/chat';
import { SessionLivenessRegistry } from '@ptah-extension/chat-state';
import { TribunalStateService } from '../services/tribunal-state.service';

@Component({
  selector: 'ptah-conductor-tile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgComponentOutlet, LucideAngularModule],
  template: `
    <section
      class="flex h-full min-h-0 w-full flex-col bg-base-200/40"
      data-testid="tribunal-conductor-column"
      aria-label="Tribunal conductor"
    >
      <header
        class="flex shrink-0 items-center gap-2 border-b border-base-300 px-4 py-3"
      >
        <lucide-angular
          [img]="GavelIcon"
          class="h-4 w-4 text-primary"
          aria-hidden="true"
        />
        <span class="text-sm font-semibold text-base-content">Conductor</span>
        <span
          class="ml-auto flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-base-content/60"
        >
          <span
            class="h-2 w-2 rounded-full"
            [class.bg-info]="isStreaming()"
            [class.animate-pulse]="isStreaming()"
            [class.bg-base-content]="!isStreaming()"
            [class.opacity-40]="!isStreaming()"
            aria-hidden="true"
          ></span>
          {{ isStreaming() ? 'Running' : 'Idle' }}
        </span>
      </header>

      @if (childInjector(); as injector) {
        <div class="min-h-0 flex-1 overflow-hidden">
          <ng-container
            [ngComponentOutlet]="chatViewComponent"
            [ngComponentOutletInjector]="injector"
          />
        </div>
      } @else {
        <p
          class="px-3 py-3 text-xs text-base-content/50"
          data-testid="tribunal-conductor-empty"
        >
          Waiting for the conductor to convene the panel…
        </p>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
    `,
  ],
})
export class ConductorTileComponent implements OnInit, OnDestroy {
  private readonly tribunalState = inject(TribunalStateService);
  private readonly liveness = inject(SessionLivenessRegistry);
  private readonly parentEnvInjector = inject(EnvironmentInjector);

  protected readonly GavelIcon = Gavel;
  protected readonly chatViewComponent = ChatViewComponent;

  private readonly _childInjector = signal<EnvironmentInjector | null>(null);
  protected readonly childInjector = this._childInjector.asReadonly();

  protected readonly isStreaming = computed(() => {
    const sessionId = this.tribunalState.tribunalSessionId();
    if (!sessionId) return false;
    return this.liveness.statuses().get(sessionId) === 'streaming';
  });

  ngOnInit(): void {
    const tabIdSignal = computed<string | null>(() =>
      this.tribunalState.correlationId(),
    );

    this._childInjector.set(
      createEnvironmentInjector(
        [{ provide: SESSION_CONTEXT, useValue: tabIdSignal }],
        this.parentEnvInjector,
      ),
    );
  }

  ngOnDestroy(): void {
    this.childInjector()?.destroy();
  }
}
