import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { SessionAgent } from '@ptah-extension/chat';
import {
  AGENT_KIND_LABEL,
  AgentAvatarComponent,
} from '@ptah-extension/chat-ui';
import { LucideAngularModule, MousePointerClick } from 'lucide-angular';
import { agentStatusInk } from './dock-overflow';

/**
 * Informational hover / focus card for one dock agent. No controls and no
 * tab stop. The dock keeps it open while the pointer is over it.
 */
@Component({
  selector: 'ptah-agent-dock-card',
  standalone: true,
  imports: [AgentAvatarComponent, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <div
      role="tooltip"
      [id]="cardId()"
      [class.fixed]="!inline()"
      [class.basis-full]="inline()"
      class="z-50 w-64 max-w-full rounded-xl border border-[var(--surface-border-strong)] bg-surface-1 p-3 pt-2 text-xs text-base-content shadow-md motion-reduce:transition-none"
      [style.visibility]="inline() ? 'visible' : 'hidden'"
      (pointerenter)="hovered.emit(true)"
      (pointerleave)="hovered.emit(false)"
    >
      <div class="flex items-center gap-2">
        <ptah-agent-avatar
          [kind]="agent().kind"
          [status]="agent().status"
          [size]="32"
          [cliId]="agent().cliId"
          [agentType]="agent().agentType"
        />
        <div class="min-w-0">
          <p class="truncate font-medium">{{ agent().name }}</p>
          <p class="text-base-content-muted">{{ kindLabel() }}</p>
        </div>
      </div>
      @if (agent().status; as status) {
        <p class="mt-2 {{ statusClass() }}">
          {{ status }}
          @if (durationText(); as duration) {
            <span class="tabular-nums">{{ duration }}</span>
          }
        </p>
      }
      @if (agent().activity; as activity) {
        <p class="mt-1 truncate text-base-content-muted">{{ activity }}</p>
      }
      <p class="mt-2 inline-flex items-center gap-1 text-base-content-muted">
        <lucide-angular
          [img]="pointerIcon"
          class="h-3.5 w-3.5"
          aria-hidden="true"
        />
        Click to view this thread
      </p>
    </div>
  `,
})
export class AgentDockCardComponent {
  readonly agent = input.required<SessionAgent>();
  readonly inline = input(false);
  readonly durationText = input<string | null>(null);
  readonly cardId = input.required<string>();
  readonly hovered = output<boolean>();

  protected readonly pointerIcon = MousePointerClick;
  protected readonly kindLabel = computed(
    () => AGENT_KIND_LABEL[this.agent().kind],
  );
  protected readonly statusClass = computed(() =>
    agentStatusInk(this.agent().status),
  );
}
