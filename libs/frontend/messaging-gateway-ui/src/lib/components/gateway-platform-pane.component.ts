import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import type { GatewayPlatformId } from '@ptah-extension/shared';

import {
  GatewayStateService,
  type PlatformAdapterState,
} from '../services/gateway-state.service';
import { PlatformTokenFormComponent } from './platform-token-form.component';
import { AllowListEditorComponent } from './allow-list-editor.component';
import { DiscordIntegrationKitComponent } from './discord-integration-kit.component';
import { PlatformBindingsPanelComponent } from './platform-bindings-panel.component';

export interface PlatformCardConfig {
  readonly id: GatewayPlatformId;
  readonly label: string;
  readonly tokenPlaceholder: string;
  readonly hasAppToken: boolean;
}

@Component({
  selector: 'ptah-gateway-platform-pane',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PlatformTokenFormComponent,
    AllowListEditorComponent,
    DiscordIntegrationKitComponent,
    PlatformBindingsPanelComponent,
  ],
  template: `
    <div class="flex flex-col gap-4">
      <section
        class="card bg-base-200 shadow-sm"
        [attr.aria-label]="config().label + ' adapter'"
        [attr.data-testid]="'gateway-platform-card-' + config().id"
      >
        <div class="card-body p-4">
          <div class="flex items-center justify-between">
            <h3 class="card-title text-sm">{{ config().label }}</h3>
            <span
              class="badge badge-sm"
              [attr.data-testid]="'gateway-platform-status-' + config().id"
              [class.badge-success]="status() === 'running'"
              [class.badge-warning]="status() === 'starting'"
              [class.badge-error]="status() === 'error'"
              [class.badge-ghost]="status() === 'stopped'"
            >
              {{ status() }}
            </span>
          </div>

          @if (errorMessage(); as msg) {
            <div role="alert" class="alert alert-error mt-2 py-2 text-xs">
              <span>{{ msg }}</span>
            </div>
          }

          <ptah-platform-token-form
            [platform]="config().id"
            [label]="config().label"
            [tokenPlaceholder]="config().tokenPlaceholder"
            [hasAppToken]="config().hasAppToken"
          />

          <ptah-allow-list-editor
            [platform]="config().id"
            [label]="config().label"
          />

          @if (config().id === 'discord') {
            <ptah-discord-integration-kit />
          }

          <div class="mt-3 flex items-center gap-2">
            <button
              type="button"
              class="btn btn-outline btn-sm"
              [disabled]="!canSendTest()"
              (click)="onSendTest()"
            >
              Send test
            </button>
            @if (testResult(); as r) {
              <span
                class="text-xs"
                [class.text-success]="r.ok"
                [class.text-error]="!r.ok"
              >
                {{ r.message }}
              </span>
            }
          </div>
        </div>
      </section>

      <ptah-platform-bindings-panel [platform]="config().id" />
    </div>
  `,
})
export class GatewayPlatformPaneComponent {
  private readonly state = inject(GatewayStateService);

  public readonly config = input.required<PlatformCardConfig>();

  protected status(): PlatformAdapterState {
    return this.state.platforms()[this.config().id]?.state ?? 'stopped';
  }

  protected errorMessage(): string | null {
    const platform = this.config().id;
    return (
      this.state.lastError()[platform] ??
      this.state.platforms()[platform].lastError ??
      null
    );
  }

  protected canSendTest(): boolean {
    return (
      this.status() === 'running' &&
      this.state.hasApprovedBindingFor(this.config().id)
    );
  }

  protected testResult(): { ok: boolean; message: string } | null {
    const r = this.state.testResult();
    if (!r || r.platform !== this.config().id) return null;
    return { ok: r.ok, message: r.message };
  }

  protected async onSendTest(): Promise<void> {
    await this.state.sendTest(this.config().id);
  }
}
