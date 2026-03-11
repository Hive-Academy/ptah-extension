/**
 * Agent Card Permission Component
 *
 * Displays a pending permission request from Copilot SDK agents.
 * Shows tool name, args, and Allow/Deny buttons.
 */

import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import type { AgentPermissionRequest } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-agent-card-permission',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="border-t border-warning/20 bg-warning/5 px-3 py-2 flex-shrink-0"
    >
      <div class="flex items-center gap-2 mb-1.5">
        <span class="badge badge-sm badge-warning">Permission</span>
        <span class="text-[10px] text-base-content/60">
          {{ permission().description }}
        </span>
      </div>
      <div class="flex items-center gap-1.5 mb-1">
        <code
          class="text-[10px] font-mono text-accent bg-base-200/60 px-1.5 py-0.5 rounded"
        >
          {{ permission().toolName }}
        </code>
        @if (permission().toolArgs) {
        <span
          class="text-[10px] text-base-content/40 font-mono truncate max-w-[200px]"
        >
          {{ permission().toolArgs }}
        </span>
        }
      </div>
      <div class="flex gap-2 mt-2">
        <button
          type="button"
          class="btn btn-xs btn-success"
          (click)="allow.emit()"
          aria-label="Allow tool permission"
        >
          Allow
        </button>
        <button
          type="button"
          class="btn btn-xs btn-error btn-outline"
          (click)="deny.emit()"
          aria-label="Deny tool permission"
        >
          Deny
        </button>
      </div>
    </div>
  `,
})
export class AgentCardPermissionComponent {
  readonly permission = input.required<AgentPermissionRequest>();

  readonly allow = output<void>();
  readonly deny = output<void>();
}
