import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import type {
  AgentPackInfoDto,
  GenerationTargetChoice,
  GenerationTargetInfo,
} from '@ptah-extension/shared';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';
import {
  KEPT_PACK_NOTE,
  PackInstallPromptComponent,
  openedFolderNotice,
  packResultCounts,
  type PackFileStatus,
  type PackInstallFinished,
  type PackInstallRequest,
  type PackInstallStart,
} from './pack-install-prompt.component';
import { targetFolder } from './preview-decisions/preview-decisions.state';

/** Per-file state in the panel: in flight, or the last install outcome. */
type PanelFileStatus = 'installing' | PackFileStatus;

/**
 * Community packs in the generation sidebar (TASK_2026_701_9e4b F4).
 *
 * Change, Install All, per-file Install and Retry all open the shared
 * {@link PackInstallPromptComponent}, scoped to the pack or to one file; the
 * prompt carries the target choice and the keep/replace decisions.
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
                installToPath()
              }}</code>
              <span class="text-base-content-muted">{{
                installToSuffix()
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
            @if (results()[pack.source]; as finished) {
              <div role="status" class="mt-1 text-xs" data-testid="pack-result">
                @if (finished.primaryFailure) {
                  <p class="text-error">
                    Could not install the pack. {{ finished.error }}
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
      (dismissed)="request.set(null)"
      (installStarted)="started($event)"
      (installFinished)="finished($event)"
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
  private readonly statuses = signal<Readonly<Record<string, PanelFileStatus>>>(
    {},
  );
  private readonly failures = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly results = signal<
    Readonly<Record<string, PackInstallFinished>>
  >({});
  /** Root of the last confirmed install; the next prompt starts there. */
  private readonly target = signal<GenerationTargetChoice | null>(null);
  private readonly targetInfo = signal<GenerationTargetInfo | null>(null);

  /** A prompt is open or an install is running. */
  protected readonly busy = computed(
    () =>
      this.request() !== null ||
      Object.values(this.statuses()).includes('installing'),
  );
  protected readonly installToPath = computed(() => {
    const info = this.targetInfo();
    const choice = this.target();
    if (!info || !choice) return '.claude/agents';
    return targetFolder(
      info,
      info.openedIsHarnessRoot ? 'harness-root' : choice,
    );
  });
  protected readonly installToSuffix = computed(() =>
    this.target() === 'opened-folder' &&
    this.targetInfo()?.openedIsHarnessRoot !== true
      ? '(opened folder only)'
      : '(project root)',
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

  protected fileStatus(source: string, file: string): PanelFileStatus | null {
    return this.statuses()[key(source, file)] ?? null;
  }

  protected failureReason(source: string, file: string): string {
    return this.failures().get(key(source, file)) ?? '';
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
      target: this.target(),
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
      target: this.target(),
    });
  }

  protected started(start: PackInstallStart): void {
    this.request.set(null);
    this.statuses.update((current) => {
      const next = { ...current };
      for (const file of start.files)
        next[key(start.source, file)] = 'installing';
      return next;
    });
  }

  protected finished(result: PackInstallFinished): void {
    this.target.set(result.target.chosen);
    this.targetInfo.set(result.target);
    this.results.update((current) => ({
      ...current,
      [result.source]: result,
    }));
    const failures = new Map(this.failures());
    this.statuses.update((current) => {
      const next = { ...current };
      for (const file of result.files) {
        const fileKey = key(result.source, file);
        const status = result.statuses[file] ?? 'failed';
        next[fileKey] = status;
        if (status === 'failed') failures.set(fileKey, result.error ?? '');
        else failures.delete(fileKey);
      }
      return next;
    });
    this.failures.set(failures);
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

function key(source: string, file: string): string {
  return `${source}::${file}`;
}
