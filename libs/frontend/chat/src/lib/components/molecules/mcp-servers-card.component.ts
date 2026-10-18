import {
  ChangeDetectionStrategy, Component, computed, effect, inject, signal,
} from '@angular/core';
import { SessionMcpStatusRegistry, TabManagerService } from '@ptah-extension/chat-state';
import { ChatStore } from '../../services/chat.store';
import { McpServerListComponent } from './mcp-server-list.component';
import { McpServerStatusService, type McpServerRow } from './mcp-server-status.service';

@Component({
  selector: 'ptah-mcp-servers-card',
  standalone: true,
  imports: [McpServerListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [':host { display: contents; }'],
  template: `
    @if (rows().length > 0 || notices().length > 0) {
      <section class="rounded-md border border-surface-border bg-surface-2 text-xs">
        <button type="button" class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-base-content/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          [attr.aria-expanded]="isOpen()" aria-controls="sidebar-mcp-servers-list"
          (click)="toggle()">
          <span class="min-w-0 flex-1 font-medium">MCP servers</span>
          <span class="tabular-nums text-base-content-muted">{{ connectedCount() }}/{{ rows().length }}</span>
          <span aria-hidden="true" class="text-base-content-muted transition-transform" [class.rotate-180]="isOpen()">⌄</span>
        </button>
        <div id="sidebar-mcp-servers-list" [hidden]="!isOpen()" class="max-h-64 overflow-y-auto border-t border-surface-border px-2 py-1">
          @if (isOpen()) {
            <ptah-mcp-server-list [rows]="rows()" [notices]="notices()" [compact]="true"
              [providerLabel]="providerLabel()" (authorize)="authorize($event)"
              (providerSettings)="openProviderSettings()" />
          }
        </div>
      </section>
    }
  `,
})
export class McpServersCardComponent {
  private readonly tabs = inject(TabManagerService);
  private readonly chatStore = inject(ChatStore);
  private readonly statusService = inject(McpServerStatusService);
  private readonly registry = inject(SessionMcpStatusRegistry);
  readonly isOpen = signal(false);
  readonly tabId = computed(() => this.tabs.activeTabId());
  readonly sessionId = computed(() => this.chatStore.currentSessionId());
  private readonly status = computed(() =>
    this.registry.statusFor(this.sessionId(), this.tabId())());
  readonly notices = computed(() => this.statusService.notices(this.status()?.notices));
  readonly rows = computed(() => this.statusService.rows(this.status()?.servers));
  readonly connectedCount = computed(() =>
    this.rows().filter((row) => row.status === 'connected').length);
  readonly providerLabel = computed(() =>
    this.statusService.providerName() ?? 'another provider');

  constructor() {
    effect(() => {
      const sessionId = this.sessionId();
      if (sessionId && !this.status()) void this.statusService.recover(sessionId);
    });
  }

  toggle(): void {
    const next = !this.isOpen();
    this.isOpen.set(next);
    if (next) {
      void this.statusService.loadOAuthRecords();
      void this.statusService.loadProviderName(this.notices());
    }
  }

  async authorize(row: McpServerRow): Promise<void> {
    await this.statusService.authorize(row);
  }

  openProviderSettings(): void {
    this.statusService.openProviderSettings();
  }
}
