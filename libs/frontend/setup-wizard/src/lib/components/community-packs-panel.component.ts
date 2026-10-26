import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import type { AgentPackInfoDto } from '@ptah-extension/shared';
import {
  PackInstallStore,
  type PackFileState,
} from '../services/pack-install.store';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';
import { PackInstallPromptComponent } from './pack-install-prompt.component';
import {
  KEPT_PACK_NOTE,
  installToLabel,
  openedFolderNotice,
  packResultCounts,
  type PackFileStatus,
  type PackInstallFinished,
  type PackInstallRequest,
} from './pack-install/pack-install-result';

/**
 * Community packs in the generation sidebar (TASK_2026_701_9e4b F4).
 *
 * Change, Install All, per-file Install and Retry all open the shared
 * {@link PackInstallPromptComponent}, scoped to the pack or to one file; the
 * prompt carries the target choice and the keep/replace decisions. Installs
 * and their outcomes live in {@link PackInstallStore} (scope `sidebar`), so a
 * re-created panel shows the same Installing, Kept and Failed state.
 */
@Component({
  selector: 'ptah-community-packs-panel',
  standalone: true,
  imports: [PackInstallPromptComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="community-packs-title" class="space-y-2">
      <h3 id="community-packs-title" class="font-semibold">Community packs</h3>
      <p class="text-sm text-base-content-muted">
        Install extra agents shared by the community. You choose the folder
        before anything is written.
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
            <p class="text-xs text-base-content-muted">
              {{ pack.description }}
            </p>
            <p
              class="my-1 flex flex-wrap items-center gap-1 text-xs"
              data-testid="pack-install-to"
            >
              <span class="text-base-content-muted">Install to:</span>
              <code class="font-mono [overflow-wrap:anywhere]">{{
                installTo().path
              }}</code>
              <span class="text-base-content-muted">{{
                installTo().suffix
              }}</span>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                data-testid="pack-change-target"
                [disabled]="busy() || !pendingFiles(pack).length"
                (click)="installAll(pack)"
              >
                Change
              </button>
            </p>
            <button
              type="button"
              class="btn btn-outline btn-xs"
              data-testid="pack-install-all"
              [disabled]="busy() || !pendingFiles(pack).length"
              (click)="installAll(pack)"
            >
              Install All
            </button>
            @if (packStore.result('sidebar', pack.source); as finished) {
              <div role="status" class="mt-1 text-xs" data-testid="pack-result">
                @if (finished.primaryFailure) {
                  <p class="text-error">
                    Could not install the pack. {{ finished.failure }}
                  </p>
                } @else {
                  <p>
                    {{ counts(finished).installed }} Installed ·
                    {{ counts(finished).kept }} Kept (your file) ·
                    {{ counts(finished).failed }} Failed
                  </p>
                }
                @if (notice(finished); as text) {
                  <p data-testid="pack-opened-folder-notice">{{ text }}</p>
                }
              </div>
            }
            @for (agent of pack.agents; track agent.file) {
              @let status = fileStatus(pack.source, agent.file);
              <div class="py-1 text-sm">
                <div class="flex items-center justify-between gap-2">
                  <span>{{ agent.name }}</span>
                  @switch (status) {
                    @case ('installed') {
                      <span class="badge badge-success badge-sm"
                        >Installed</span
                      >
                    }
                    @case ('installing') {
                      <span role="status" class="text-xs">Installing</span>
                    }
                    @case ('kept') {
                      <span
                        class="badge badge-ghost badge-sm"
                        data-testid="pack-agent-kept"
                        >Kept</span
                      >
                    }
                    @case ('failed') {
                      <button
                        type="button"
                        class="btn btn-outline btn-xs"
                        [disabled]="busy()"
                        (click)="install(pack, agent.file)"
                      >
                        Retry
                      </button>
                    }
                    @default {
                      <button
                        type="button"
                        class="btn btn-outline btn-xs"
                        [disabled]="busy()"
                        (click)="install(pack, agent.file)"
                      >
                        Install
                      </button>
                    }
                  }
                </div>
                @if (status === 'kept') {
                  <p class="text-xs text-base-content-muted">{{ keptNote }}</p>
                }
                @if (status === 'failed') {
                  <p
                    role="alert"
                    class="text-xs text-error"
                    data-testid="pack-agent-failure"
                  >
                    Not installed. {{ failureReason(pack.source, agent.file) }}
                  </p>
                }
              </div>
            }
          }
        </div>
      }
    </section>
    <ptah-pack-install-prompt
      [request]="request()"
      [isElectron]="isElectron"
      scope="sidebar"
      (dismissed)="request.set(null)"
    />
  `,
})
export class CommunityPacksPanelComponent {
  protected readonly state = inject(SetupWizardStateService);
  private readonly rpc = inject(WizardRpcService);
  /** Electron shows Library copy; VS Code has no Library (D3). */
  protected readonly isElectron = inject(VSCodeService).isElectron;
  protected readonly keptNote = KEPT_PACK_NOTE;

  protected readonly opened = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal(false);
  protected readonly expanded = signal<string | null>(null);
  /** The install the prompt is open for, or null. */
  protected readonly request = signal<PackInstallRequest | null>(null);
  /** Pack installs and their outcomes; outlives this panel (B2). */
  protected readonly packStore = inject(PackInstallStore);

  /** A prompt is open or an install is running. */
  protected readonly busy = computed(
    () => this.request() !== null || this.packStore.isInstalling('sidebar'),
  );
  protected readonly installTo = computed(() =>
    installToLabel(this.packStore.targetInfo('sidebar')),
  );

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

  protected fileStatus(source: string, file: string): PackFileState | null {
    return this.packStore.fileState('sidebar', source, file);
  }

  protected failureReason(source: string, file: string): string {
    return this.packStore.failure('sidebar', source, file);
  }

  /** Files Install All and Change cover: every file not installed yet. */
  protected pendingFiles(pack: AgentPackInfoDto): string[] {
    return pack.agents
      .map((agent) => agent.file)
      .filter((file) => this.fileStatus(pack.source, file) !== 'installed');
  }

  /** Per-file Install and Retry: the prompt scoped to one file. */
  protected install(pack: AgentPackInfoDto, file: string): void {
    if (this.busy()) return;
    this.request.set({
      source: pack.source,
      packName: pack.name,
      files: [file],
      scope: 'file',
      target: this.packStore.lastTarget('sidebar'),
    });
  }

  /** Install All and Change: the prompt scoped to the pack. */
  protected installAll(pack: AgentPackInfoDto): void {
    const files = this.pendingFiles(pack);
    if (this.busy() || !files.length) return;
    this.request.set({
      source: pack.source,
      packName: pack.name,
      files,
      scope: 'pack',
      target: this.packStore.lastTarget('sidebar'),
    });
  }

  protected counts(
    finished: PackInstallFinished,
  ): Record<PackFileStatus, number> {
    return packResultCounts(finished.statuses);
  }

  protected notice(finished: PackInstallFinished): string | null {
    return openedFolderNotice(finished.target, this.isElectron);
  }
}
