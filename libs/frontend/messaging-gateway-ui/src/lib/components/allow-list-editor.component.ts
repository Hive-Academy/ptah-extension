import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import type { GatewayPlatformId } from '@ptah-extension/shared';

import { GatewayStateService } from '../services/gateway-state.service';

@Component({
  selector: 'ptah-allow-list-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="flex flex-col gap-1.5">
      <span class="text-xs text-base-content/60">
        Allow-list ({{ label() }})
        <span class="text-base-content/40">
          — one ID per line. Empty = accept any sender it can see.
        </span>
      </span>
      <textarea
        class="textarea textarea-bordered textarea-sm w-full font-mono"
        rows="3"
        [attr.data-testid]="'gateway-allowlist-' + platform()"
        [attr.aria-label]="label() + ' allow-list'"
        [value]="allowListValue()"
        (input)="onAllowListInput($event)"
      ></textarea>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn btn-sm btn-outline"
          [attr.data-testid]="'gateway-allowlist-save-' + platform()"
          (click)="onSave()"
        >
          Save allow-list
        </button>
        @if (feedback(); as fb) {
          <span class="text-xs text-base-content/70">{{ fb }}</span>
        }
      </div>
    </label>
  `,
})
export class AllowListEditorComponent {
  private readonly state = inject(GatewayStateService);

  public readonly platform = input.required<GatewayPlatformId>();
  public readonly label = input.required<string>();

  private readonly draft = signal<string | null>(null);
  protected readonly feedback = signal<string | null>(null);

  protected allowListValue(): string {
    const draft = this.draft();
    if (draft !== null) return draft;
    return this.state.allowLists()[this.platform()].join('\n');
  }

  protected onAllowListInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement | null;
    if (!target) return;
    this.draft.set(target.value);
  }

  protected async onSave(): Promise<void> {
    const entries = this.allowListValue()
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const result = await this.state.saveAllowList(this.platform(), entries);
    this.draft.set(null);
    this.feedback.set(result.ok ? 'Saved.' : `Save failed: ${result.error}`);
  }
}
