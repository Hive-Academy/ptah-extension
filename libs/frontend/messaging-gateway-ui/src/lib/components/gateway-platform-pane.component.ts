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
      class="w-full"
      [attr.aria-label]="config().label + ' adapter'"
      [attr.data-testid]="'gateway-platform-card-' + config().id"
    >
      @if (errorMessage(); as msg) {
        <div role="alert" class="alert alert-error mb-5 py-2 text-xs">
          <span>{{ msg }}</span>
        </div>
      }

      <div class="divide-y divide-base-content/5">
        <section
          class="grid gap-x-8 gap-y-3 py-6 first:pt-0 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]"
        >
          <div class="space-y-1">
            <h3 class="text-sm font-semibold">Connection</h3>
            <p class="text-xs text-base-content/55">
              Save a bot token to start the {{ config().label }} adapter.
            </p>
          </div>
          <div
            class="max-w-2xl space-y-4 rounded-lg border border-base-content/10 bg-base-100/40 p-4"
          >
            <ptah-platform-token-form
              [platform]="config().id"
              [label]="config().label"
              [tokenPlaceholder]="config().tokenPlaceholder"
              [hasAppToken]="config().hasAppToken"
            />

            <div
              class="flex items-center gap-2 border-t border-base-content/5 pt-3"
            >
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

        <section
          class="grid gap-x-8 gap-y-3 py-6 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]"
        >
          <div class="space-y-1">
            <h3 class="text-sm font-semibold">Access</h3>
            <p class="text-xs text-base-content/55">
              Control who can reach this adapter and approve pairing requests.
            </p>
          </div>
          <div
            class="max-w-2xl space-y-4 rounded-lg border border-base-content/10 bg-base-100/40 p-4"
          >
            <ptah-allow-list-editor
              [platform]="config().id"
              [label]="config().label"
            />
            <div class="border-t border-base-content/5 pt-4">
              <ptah-platform-bindings-panel [platform]="config().id" />
            </div>
          </div>
        </section>

        @if (config().id === 'discord') {
          <section
            class="grid gap-x-8 gap-y-3 py-6 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]"
          >
            <div class="space-y-1">
              <h3 class="text-sm font-semibold">Integration</h3>
              <p class="text-xs text-base-content/55">
                Generate an invite, register the
                <span class="font-mono">/ptah</span> command, and pick allowed
                servers.
              </p>
            </div>
            <div
              class="max-w-2xl rounded-lg border border-base-content/10 bg-base-100/40 p-4"
            >
              <ptah-discord-integration-kit />
            </div>
          </section>
        }
      </div>
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
