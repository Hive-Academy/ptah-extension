import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';

@Component({
  selector: 'ptah-community-packs-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="community-packs-title" class="space-y-2">
      <h3 id="community-packs-title" class="font-semibold">Community packs</h3>
      <p class="text-sm text-base-content/70">
        Install extra agents shared by the community. They are added to your
        workspace right away.
      </p>
      @if (!opened()) {
        <button type="button" class="btn btn-outline btn-sm" (click)="browse()">
          Browse community packs
        </button>
      }
      @if (loading()) {
        <p role="status">Loading community packs...</p>
      }
      @if (error()) {
        <p role="alert" class="alert alert-error">
          Failed to load community packs. Check your internet connection.
        </p>
        <button type="button" class="btn btn-outline btn-sm" (click)="browse()">
          Retry
        </button>
      }
      @if (
        opened() && !loading() && !error() && !state.communityPacks().length
      ) {
        <p>No community agent packs are available at the moment.</p>
      }
      @for (pack of state.communityPacks(); track pack.source) {
        <div class="rounded-lg border border-base-300 p-2">
          <button
            type="button"
            class="w-full text-left font-medium"
            [attr.aria-expanded]="expanded() === pack.source"
            (click)="
              expanded.set(expanded() === pack.source ? null : pack.source)
            "
          >
            {{ pack.name }} · {{ pack.agents.length }} agents
          </button>
          @if (expanded() === pack.source) {
            <p class="text-xs text-base-content/70">{{ pack.description }}</p>
            <button
              type="button"
              class="btn btn-outline btn-xs"
              [disabled]="installing() !== null"
              (click)="installAll(pack.source, pack.agents)"
            >
              Install All
            </button>
            @for (agent of pack.agents; track agent.file) {
              <div class="flex items-center justify-between gap-2 py-1 text-sm">
                <span>{{ agent.name }}</span
                ><button
                  type="button"
                  class="btn btn-outline btn-xs"
                  [disabled]="
                    installing() !== null ||
                    installed().has(pack.source + ':' + agent.file)
                  "
                  (click)="install(pack.source, agent.file)"
                >
                  {{
                    installed().has(pack.source + ':' + agent.file)
                      ? 'Installed'
                      : installing() === pack.source + ':' + agent.file
                        ? 'Installing'
                        : 'Install'
                  }}
                </button>
              </div>
            }
          }
        </div>
      }
      @if (installError()) {
        <p role="alert" class="text-error">Install failed. Retry this agent.</p>
      }
    </section>
  `,
})
export class CommunityPacksPanelComponent {
  protected readonly state = inject(SetupWizardStateService);
  private readonly rpc = inject(WizardRpcService);
  protected readonly opened = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal(false);
  protected readonly expanded = signal<string | null>(null);
  protected readonly installing = signal<string | null>(null);
  protected readonly installed = signal(new Set<string>());
  protected readonly installError = signal(false);

  protected async browse(): Promise<void> {
    this.opened.set(true);
    this.loading.set(true);
    this.error.set(false);
    try {
      this.state.setCommunityPacks(await this.rpc.listAgentPacks());
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  protected async install(source: string, file: string): Promise<void> {
    if (this.installing()) return;
    this.installing.set(source + ':' + file);
    this.installError.set(false);
    try {
      const result = await this.rpc.installPackAgents(source, [file]);
      if (!result.success) throw new Error('Install failed');
      this.installed.update(
        (value) => new Set([...value, source + ':' + file]),
      );
    } catch {
      this.installError.set(true);
    } finally {
      this.installing.set(null);
    }
  }

  protected async installAll(
    source: string,
    agents: readonly { file: string }[],
  ): Promise<void> {
    if (this.installing()) return;
    this.installing.set(source);
    this.installError.set(false);
    try {
      const result = await this.rpc.installPackAgents(
        source,
        agents.map((agent) => agent.file),
      );
      if (!result.success) throw new Error('Install failed');
      this.installed.update(
        (value) =>
          new Set([
            ...value,
            ...agents.map((agent) => source + ':' + agent.file),
          ]),
      );
    } catch {
      this.installError.set(true);
    } finally {
      this.installing.set(null);
    }
  }
}
