import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { SessionAgent } from '@ptah-extension/chat';
import { AgentAvatarComponent } from '@ptah-extension/chat-ui';
import { NativeDropdownComponent } from '@ptah-extension/ui';
import { ChevronRight, LucideAngularModule } from 'lucide-angular';
import { agentDurationText, agentStatusInk, orderDockMenuAgents } from './dock-overflow';

let nextMenuId = 0;

/**
 * `N more ›` overflow menu. Lists hidden agents by status, retaining dock
 * order within a status. The parent only renders it when agents are hidden.
 */
@Component({
  selector: 'ptah-agent-dock-menu',
  standalone: true,
  imports: [AgentAvatarComponent, LucideAngularModule, NativeDropdownComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-native-dropdown
      [isOpen]="open()"
      [panelRole]="null"
      [hasBackdrop]="true"
      [closeOnBackdropClick]="true"
      (opened)="onOpened()"
      (closed)="onClosed()"
    >
      <button
        #trigger
        trigger
        type="button"
        class="relative inline-flex h-7 min-w-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs text-base-content hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
        aria-haspopup="menu"
        [attr.aria-expanded]="open()"
        [attr.aria-label]="triggerLabel()"
        (click)="toggle()"
      >
        @if (!compact()) {
          <span class="flex items-center -space-x-1.5" aria-hidden="true">
            @for (agent of pile(); track agent.key) {
              <ptah-agent-avatar
                [kind]="agent.kind"
                [status]="agent.status"
                [size]="24"
                [cliId]="agent.cliId"
                [agentType]="agent.agentType"
              />
            }
          </span>
        }
        @if (compact()) {
          <span
            class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-base-200 px-1 text-[11px] font-medium tabular-nums"
            >{{ hidden().length }}</span
          >
        } @else {
          <span class="whitespace-nowrap"
            >{{ hidden().length }} more</span
          >
          <lucide-angular
            [img]="chevronIcon"
            class="h-3.5 w-3.5"
            aria-hidden="true"
          />
        }
        @if (pipClass(); as pip) {
          <span
            class="absolute right-1 top-1 size-1.5 rounded-full {{ pip }}"
            aria-hidden="true"
          ></span>
        }
      </button>

      <div
        content
        role="menu"
        aria-label="Agents"
        class="max-h-[340px] w-64 overflow-y-auto motion-reduce:transition-none"
        (keydown)="onMenuKeydown($event)"
      >
        @for (agent of orderedAgents(); track agent.key) {
            <button
              type="button"
              role="menuitemradio"
              class="relative flex min-h-6 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-base-content hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
              [id]="rowId(agent.key)"
              [attr.aria-checked]="agent.key === selectedKey()"
              [tabIndex]="rovingKey() === agent.key ? 0 : -1"
              (click)="choose(agent.key)"
            >
              @if (agent.key === selectedKey()) {
                <span
                  class="absolute inset-y-1 left-0 w-0.5 rounded-full bg-secondary"
                  aria-hidden="true"
                ></span>
              }
              <ptah-agent-avatar
                [kind]="agent.kind"
                [status]="agent.status"
                [size]="24"
                [cliId]="agent.cliId"
                [agentType]="agent.agentType"
              />
              <span class="min-w-0 flex-1 truncate">{{ agent.name }}</span>
              @if (agent.status; as status) {
                <span class="shrink-0 {{ statusInk(status) }}">{{
                  status
                }}</span>
              }
              @if (durationOf(agent); as duration) {
                <span class="shrink-0 tabular-nums text-base-content-muted">{{
                  duration
                }}</span>
              }
            </button>
        }
      </div>
    </ptah-native-dropdown>
  `,
})
export class AgentDockMenuComponent {
  readonly hidden = input.required<readonly SessionAgent[]>();
  readonly selectedKey = input.required<string>();
  readonly compact = input(false);
  readonly now = input.required<number>();
  readonly agentSelect = output<string>();
  readonly openChange = output<boolean>();

  protected readonly open = signal(false);
  protected readonly activeKey = signal<string | null>(null);
  protected readonly chevronIcon = ChevronRight;
  private readonly injector = inject(Injector);
  private readonly menuUid = `agent-dock-menu-${++nextMenuId}`;
  private readonly trigger =
    viewChild<ElementRef<HTMLButtonElement>>('trigger');

  protected readonly pile = computed(() => this.hidden().slice(0, 3));

  protected readonly triggerLabel = computed(() => {
    const parts = [
      `${this.hidden().length} more ${this.hidden().length === 1 ? 'agent' : 'agents'}`,
    ];
    let waiting = 0;
    let failed = 0;
    for (const agent of this.hidden()) {
      if (agent.status === 'waiting') waiting += 1;
      else if (agent.status === 'failed') failed += 1;
    }
    if (waiting > 0) parts.push(`${waiting} waiting, needs you`);
    if (failed > 0) parts.push(`${failed} failed`);
    return parts.join(', ');
  });

  protected readonly pipClass = computed(() => {
    const hidden = this.hidden();
    if (hidden.some((agent) => agent.status === 'waiting'))
      return 'bg-state-need';
    if (hidden.some((agent) => agent.status === 'failed'))
      return 'bg-state-err';
    return null;
  });

  protected readonly orderedAgents = computed(() => orderDockMenuAgents(this.hidden()));
  protected readonly rovingKey = computed(() => {
    const active = this.activeKey();
    return this.orderedAgents().some((agent) => agent.key === active)
      ? active
      : this.checkedKey();
  });

  constructor() {
    effect(() => {
      if (!this.open() || this.activeKey() === this.rovingKey()) return;
      const key = this.rovingKey();
      this.activeKey.set(key);
      if (!key) return;
      afterNextRender(() => {
        if (this.open() && document.activeElement === document.body) {
          document.getElementById(this.rowId(key))?.focus();
        }
      }, { injector: this.injector });
    });
  }

  protected statusInk(status: SessionAgent['status']): string {
    return agentStatusInk(status);
  }

  protected durationOf(agent: SessionAgent): string | null {
    return agentDurationText(agent, this.now());
  }

  protected rowId(key: string): string {
    return `${this.menuUid}-${key}`;
  }

  protected toggle(): void {
    if (this.open()) {
      this.setOpen(false);
      return;
    }
    this.activeKey.set(this.checkedKey());
    this.setOpen(true);
  }

  protected onOpened(): void {
    const key = this.rovingKey();
    if (!key) return;
    this.activeKey.set(key);
    document.getElementById(this.rowId(key))?.focus();
  }

  protected onClosed(): void {
    this.setOpen(false);
  }

  protected choose(key: string): void {
    this.agentSelect.emit(key);
    this.setOpen(false);
  }

  protected onMenuKeydown(event: KeyboardEvent): void {
    const keys = this.orderedAgents().map((agent) => agent.key);
    if (keys.length === 0) return;
    if (event.key === 'Tab') {
      event.stopPropagation();
      this.setOpen(false);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.setOpen(false);
      this.trigger()?.nativeElement.focus();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      const key = this.rovingKey();
      if (key) this.choose(key);
      return;
    }
    const index = keys.indexOf(this.rovingKey() ?? '');
    const next =
      event.key === 'ArrowDown'
        ? (index + 1) % keys.length
        : event.key === 'ArrowUp'
          ? (index - 1 + keys.length) % keys.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? keys.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const key = keys[next];
    this.activeKey.set(key);
    document.getElementById(this.rowId(key))?.focus();
  }

  private checkedKey(): string | null {
    const agents = this.orderedAgents();
    if (agents.length === 0) return null;
    const selected = this.selectedKey();
    return agents.some((agent) => agent.key === selected)
      ? selected
      : agents[0].key;
  }

  private setOpen(open: boolean): void {
    if (this.open() === open) return;
    this.open.set(open);
    this.openChange.emit(open);
  }
}
