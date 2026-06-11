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
    <div
      class="max-w-3xl space-y-6"
      [attr.aria-label]="config().label + ' adapter'"
      [attr.data-testid]="'gateway-platform-card-' + config().id"
    >
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-sm font-semibold">{{ config().label }}</h2>
        <span
          class="inline-flex items-center gap-1.5 text-xs text-base-content/70"
        >
          <span
            class="inline-block size-1.5 rounded-full"
            [class.bg-success]="status() === 'running'"
            [class.bg-warning]="status() === 'starting'"
            [class.bg-error]="status() === 'error'"
            [class.bg-base-content/30]="status() === 'stopped'"
            aria-hidden="true"
          ></span>
          <span [attr.data-testid]="'gateway-platform-status-' + config().id">{{
            status()
          }}</span>
        </span>
      </div>

      @if (errorMessage(); as msg) {
        <div role="alert" class="alert alert-error py-2 text-xs">
          <span>{{ msg }}</span>
        </div>
      }

      <section class="space-y-2">
        <h2 class="text-sm font-semibold">Connection</h2>
        <p class="text-xs text-base-content/60">
          Save a bot token to start the {{ config().label }} adapter.
        </p>
        <div class="rounded-xl border border-base-300 bg-base-200/40 p-4">
          <ptah-platform-token-form
            [platform]="config().id"
            [label]="config().label"
            [tokenPlaceholder]="config().tokenPlaceholder"
            [hasAppToken]="config().hasAppToken"
          />

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

      <section class="space-y-2">
        <h2 class="text-sm font-semibold">Access</h2>
        <p class="text-xs text-base-content/60">
          Control who can reach this adapter and approve pairing requests.
        </p>
        <div
          class="space-y-4 rounded-xl border border-base-300 bg-base-200/40 p-4"
        >
          <ptah-allow-list-editor
            [platform]="config().id"
            [label]="config().label"
          />
          <ptah-platform-bindings-panel [platform]="config().id" />
        </div>
      </section>

      @if (config().id === 'discord') {
        <section class="space-y-2">
          <h2 class="text-sm font-semibold">Integration</h2>
          <p class="text-xs text-base-content/60">
            Generate an invite, register the
            <span class="font-mono">/ptah</span> command, and pick allowed
            servers.
          </p>
          <div class="rounded-xl border border-base-300 bg-base-200/40 p-4">
            <ptah-discord-integration-kit />
          </div>
        </section>
      }
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
