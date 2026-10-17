import {
  ChangeDetectionStrategy, Component, computed, effect, inject, input, signal,
} from '@angular/core';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { SessionMcpStatusRegistry } from '@ptah-extension/chat-state';
import { McpServerListComponent } from './mcp-server-list.component';
import { McpServerStatusService, type McpServerRow } from './mcp-server-status.service';

export type { McpServerRow } from './mcp-server-status.service';

const CHIP_BASE_CLASSES =
  'inline-flex items-center gap-1 h-6 px-1.5 rounded-full text-xs font-normal ' +
  'whitespace-nowrap cursor-pointer transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-base-content/30';
const DOT_BASE_CLASSES = 'w-1.5 h-1.5 rounded-full';

@Component({
  selector: 'ptah-mcp-status-chip',
  standalone: true,
  imports: [NativePopoverComponent, McpServerListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [':host { display: contents; }'],
  template: `
    @if (rows().length > 0 || notices().length > 0) {
      <ptah-native-popover [isOpen]="isOpen()" [placement]="'top-end'"
        [hasBackdrop]="true" [backdropClass]="'transparent'" (closed)="isOpen.set(false)">
        <button trigger type="button" [class]="chipClasses()" [title]="chipTitle()"
          [attr.aria-expanded]="isOpen()" (click)="toggle()">
          <span class="w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center" aria-hidden="true">
            <span [class]="dotClasses()"></span>
          </span>
          <span>MCP</span>
          <span class="tabular-nums">{{ chipLabel() }}</span>
        </button>
        <div content class="w-80 max-w-[90vw] p-3 text-xs">
          <div class="mb-2 font-semibold">MCP servers</div>
          <ptah-mcp-server-list [rows]="rows()" [notices]="notices()"
            [providerLabel]="providerLabel()" (authorize)="authorize($event)"
            (providerSettings)="openProviderSettings()" />
        </div>
      </ptah-native-popover>
    }
  `,
})
export class McpStatusChipComponent {
  private readonly statusService = inject(McpServerStatusService);
  private readonly registry = inject(SessionMcpStatusRegistry);
  readonly sessionId = input<string | null>(null);
  readonly tabId = input<string | null>(null);
  readonly isOpen = signal(false);

  private readonly status = computed(() =>
    this.registry.statusFor(this.sessionId(), this.tabId())());
  readonly notices = computed(() =>
    this.statusService.notices(this.status()?.notices));
  readonly rows = computed(() =>
    this.statusService.rows(this.status()?.servers));
  private readonly attentionCount = computed(() =>
    this.rows().filter((row) => row.needsAction).length);
  private readonly connectedCount = computed(() =>
    this.rows().filter((row) => row.status === 'connected').length);
  readonly chipLabel = computed(() => {
    const connected = this.connectedCount();
    return this.attentionCount() > 0
      ? `${connected}/${this.rows().length}` : `${connected}`;
  });
  private readonly needsAttention = computed(() =>
    this.attentionCount() > 0 || this.notices().length > 0);
  readonly chipClasses = computed(() =>
    `${CHIP_BASE_CLASSES} ${this.needsAttention()
      ? 'text-warning hover:bg-warning/10'
      : 'text-base-content-muted hover:text-base-content hover:bg-base-content/5'}${this.isOpen() ? ' bg-base-300' : ''}`);
  readonly dotClasses = computed(() => {
    if (this.needsAttention()) return `${DOT_BASE_CLASSES} bg-warning`;
    if (this.connectedCount() > 0) return `${DOT_BASE_CLASSES} bg-success`;
    return `${DOT_BASE_CLASSES} bg-base-content/40`;
  });
  readonly chipTitle = computed(() => this.attentionCount() > 0
    ? `${this.attentionCount()} MCP server(s) need attention`
    : `${this.connectedCount()} MCP server(s) connected`);
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
    this.isOpen.set(false);
    await this.statusService.authorize(row);
  }

  openProviderSettings(): void {
    this.isOpen.set(false);
    this.statusService.openProviderSettings();
  }

  pillClasses(status: string): string {
    return this.statusService.pillClasses(status);
  }
}
