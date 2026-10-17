import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { type SessionMcpNotice } from '@ptah-extension/shared';
import { mcpPillClasses, type McpServerRow } from './mcp-server-status.service';

@Component({
  selector: 'ptah-mcp-server-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [':host { display: block; }'],
  template: `
    @for (row of rows(); track row.key) {
      <div class="flex items-start gap-2 border-b border-base-content/10 py-1.5 last:border-b-0"
        [class.flex-wrap]="compact()">
        <div class="min-w-0 flex-1">
          <div class="truncate font-medium" [title]="row.key">{{ row.label }}</div>
          @if (row.hint) {
            <div class="text-base-content-muted">{{ row.hint }}</div>
          }
        </div>
        <span [class]="pillClasses(row.status)">{{ row.statusLabel }}</span>
        @if (row.needsAction) {
          <button type="button"
            class="rounded border border-warning/40 px-1.5 py-0.5 text-warning transition-colors hover:bg-warning/10"
            (click)="authorize.emit(row)">Authorize</button>
        }
      </div>
    } @empty {
      <div class="py-1.5 text-base-content-muted">This session reports no MCP servers.</div>
    }

    @for (notice of notices(); track notice.code) {
      @switch (notice.code) {
        @case ('claude-ai-connectors-disabled') {
          <div class="mt-2 rounded border border-info/25 bg-info/10 p-2" [title]="notice.message">
            <div class="mb-1 font-medium text-info">claude.ai connectors are not loaded</div>
            <p class="mb-1 text-base-content-muted">
              Your claude.ai connectors (Gmail, Calendar, Drive…) are disabled because Ptah runs this session on
              {{ providerLabel() }}. Switch the provider to Claude login to load them.
            </p>
            <button type="button" class="underline transition-colors hover:text-info"
              (click)="providerSettings.emit()">Settings → Providers</button>
          </div>
        }
        @case ('capability-policy-unverified') {
          <div class="mt-2 rounded border border-warning/25 bg-warning/10 p-2" role="status">
            <div class="mb-1 font-medium text-warning">Capability settings could not be read</div>
            <p class="text-base-content-muted">{{ notice.message }}</p>
          </div>
        }
      }
    }
  `,
})
export class McpServerListComponent {
  readonly pillClasses = mcpPillClasses;
  readonly rows = input.required<readonly McpServerRow[]>();
  readonly compact = input(false);
  readonly notices = input<readonly SessionMcpNotice[]>([]);
  readonly providerLabel = input('another provider');
  readonly authorize = output<McpServerRow>();
  readonly providerSettings = output<void>();
}
