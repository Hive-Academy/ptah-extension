import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { LucideAngularModule, Gavel } from 'lucide-angular';
import { ExecutionNodeComponent } from '@ptah-extension/chat';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import { SessionLivenessRegistry } from '@ptah-extension/chat-state';
import { TribunalStateService } from '../services/tribunal-state.service';
import { TribunalSurfaceService } from '../services/tribunal-surface.service';

@Component({
  selector: 'ptah-conductor-strip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule, ExecutionNodeComponent],
  template: `
    <section
      class="flex w-full flex-col gap-2 border-b border-base-300 bg-base-200/40 px-4 py-3"
      data-testid="tribunal-conductor-strip"
      aria-label="Tribunal conductor"
    >
      <header class="flex items-center gap-2">
        <lucide-angular
          [img]="GavelIcon"
          class="h-4 w-4 text-primary"
          aria-hidden="true"
        />
        <span class="text-sm font-semibold text-base-content">Conductor</span>
        <span
          class="ml-auto flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide"
          [class.bg-primary]="isStreaming()"
          [class.text-primary-content]="isStreaming()"
          [class.bg-base-300]="!isStreaming()"
          [class.text-base-content]="!isStreaming()"
        >
          <span
            class="h-1.5 w-1.5 rounded-full bg-current"
            [class.animate-pulse]="isStreaming()"
            aria-hidden="true"
          ></span>
          {{ isStreaming() ? 'Running' : 'Idle' }}
        </span>
      </header>

      <div
        class="max-h-48 overflow-auto"
        role="log"
        aria-label="Conductor stream"
      >
        @if (executionNodes().length > 0) {
          <div class="space-y-1">
            @for (node of executionNodes(); track node.id) {
              <ptah-execution-node
                [node]="node"
                [isStreaming]="isStreaming()"
              />
            }
          </div>
        } @else {
          <p class="px-1 py-2 text-xs text-base-content/50">
            Waiting for the conductor to convene the panel…
          </p>
        }
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class ConductorStripComponent {
  private readonly surface = inject(TribunalSurfaceService);
  private readonly tribunalState = inject(TribunalStateService);
  private readonly treeBuilder = inject(ExecutionTreeBuilderService);
  private readonly liveness = inject(SessionLivenessRegistry);

  protected readonly GavelIcon = Gavel;

  protected readonly executionNodes = computed(() => {
    this.surface.streamingNudge();
    const state = this.surface.streamingState();
    if (state.events.size === 0) return [];
    return this.treeBuilder.buildTree(state, 'tribunal-conductor');
  });

  protected readonly isStreaming = computed(() => {
    const sessionId = this.tribunalState.tribunalSessionId();
    if (!sessionId) return false;
    return this.liveness.statuses().get(sessionId) === 'streaming';
  });
}
