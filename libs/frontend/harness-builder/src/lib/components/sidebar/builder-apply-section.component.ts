import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LoggingService } from '@ptah-extension/core';
import { HarnessHealthStore } from '@ptah-extension/marketplace/services';
import type { HarnessApplyResponse, HarnessConfig } from '@ptah-extension/shared';
import { HarnessProposalHydrationService } from '../../services/harness-proposal-hydration.service';
import { HarnessRpcService } from '../../services/harness-rpc.service';
import { fullConfig } from './builder-sidebar-helpers';

@Component({
  selector: 'ptah-builder-apply-section',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (initialized() && (hasPreview() || result() || applyError())) {
      <section
        aria-labelledby="builder-apply-title"
        class="p-4 border-b border-surface-border"
      >
        <h3
          id="builder-apply-title"
          tabindex="-1"
          class="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-base-content-muted"
        >
          Apply
        </h3>
        @if (applyError()) {
          <div
            role="alert"
            class="mt-2 rounded-lg border border-state-err/55 bg-error/10 px-3 py-2.5 text-[13px]"
          >
            <p class="font-semibold">Apply failed</p>
            <p>Nothing was written. Your preview is still here.</p>
            <button
              type="button"
              class="btn btn-outline btn-xs mt-2 border-base-content/50"
              (click)="dismissError()"
            >
              Dismiss
            </button>
          </div>
        }
        @if (result(); as applied) {
          <div
            role="status"
            class="mt-2 rounded-lg border border-state-done/45 bg-success/10 px-3 py-2.5 text-[13px]"
          >
            <h4 #resultHeading tabindex="-1" class="font-semibold">
              Applied to {{ workspaceName() }}
            </h4>
            <p>{{ applied.appliedPaths.length }} files written.</p>
          </div>
          <ul
            aria-label="Files written"
            class="mt-2 rounded-lg border border-surface-border bg-surface-2"
          >
            @for (path of visiblePaths(); track path) {
              <li
                class="px-2.5 py-1.5 font-mono text-[11px] break-all border-b border-surface-border last:border-0"
              >
                {{ displayPath(path) }}
              </li>
            }
          </ul>
          @if (!showAllPaths() && applied.appliedPaths.length > 5) {
            <button
              type="button"
              class="btn btn-ghost btn-xs min-h-6 mt-1"
              (click)="showAllPaths.set(true)"
            >
              Show all {{ applied.appliedPaths.length }}
            </button>
          }
          <button
            type="button"
            class="btn btn-ghost btn-xs min-h-6"
            aria-label="Copy the list of written files"
            (click)="copyPaths()"
          >
            Copy list
          </button>
          @if (applied.warnings.length) {
            <div
              role="status"
              class="mt-2 rounded-lg border border-state-need/45 bg-warning/12 px-3 py-2.5 text-[13px]"
            >
              <h4 class="font-semibold">
                {{ applied.warnings.length }} warnings
              </h4>
              <ul class="list-disc pl-4">
                @for (warning of applied.warnings; track warning) {
                  <li>{{ warning }}</li>
                }
              </ul>
            </div>
          }
          @if (health.loading()) {
            <p role="status" class="mt-2 text-xs">Checking harness health...</p>
          } @else if (health.summary().level !== 'unknown') {
            <p role="status" class="mt-2 text-xs">
              Health: {{ health.summary().label }}
              @if (health.summary().level !== 'ok') {
                <button
                  type="button"
                  class="btn btn-ghost btn-xs min-h-6"
                  (click)="openDashboard.emit()"
                >
                  Open in Dashboard
                </button>
              }
            </p>
          }
          <button
            type="button"
            class="btn btn-ghost btn-xs min-h-6 mt-2"
            (click)="dismissResult()"
          >
            Dismiss result
          </button>
          @if (previewChanged()) {
            <div
              role="status"
              class="mt-2 rounded-lg border border-surface-border bg-surface-2 px-3 py-2.5 text-[13px]"
            >
              Preview changed since the last apply. Apply again to update the
              workspace.
            </div>
            <button
              type="button"
              class="btn btn-primary btn-sm w-full mt-2"
              [disabled]="agentBusy() || applying()"
              (click)="apply()"
            >
              {{ applying() ? 'Applying...' : 'Apply to Workspace' }}
            </button>
          }
        } @else {
          @if (hydration.isConfigComplete() && !agentBusy() && !applyError()) {
            <div
              class="mt-2 rounded-lg border border-state-done/45 bg-success/10 px-3 py-2.5 text-[13px]"
            >
              <p class="font-semibold">Configuration looks ready</p>
              <p>Review the preview, then apply it to the workspace.</p>
            </div>
          } @else if (agentBusy()) {
            <div
              class="mt-2 rounded-lg border border-surface-border bg-surface-2 px-3 py-2.5 text-[13px]"
            >
              <p class="font-semibold">Waiting for the agent</p>
              <p id="apply-wait-reason">
                Apply is available when the agent finishes its turn.
              </p>
            </div>
          } @else if (!applyError()) {
            <p class="mt-2 text-xs">
              The preview is partial. You can apply what is here now, or keep
              chatting to finish it.
            </p>
          }
          <button
            #applyButton
            type="button"
            class="mt-2"
            [class]="applyButtonClass()"
            [attr.aria-disabled]="agentBusy() || applying() ? true : null"
            [attr.aria-describedby]="agentBusy() ? 'apply-wait-reason' : null"
            [attr.aria-busy]="applying() ? true : null"
            (click)="apply()"
          >
            {{
              applying()
                ? 'Applying...'
                : applyError()
                  ? 'Try again'
                  : 'Apply to Workspace'
            }}
          </button>
          <p class="mt-1 text-[11px] text-base-content-muted">
            Writes into <b>{{ workspaceName() }}</b>
          </p>
        }
      </section>
    }
  `,
})
export class BuilderApplySectionComponent {
  readonly workspaceRoot = input('');
  readonly initialized = input(false);
  readonly agentBusy = input(false);
  readonly document = input<string | null>(null);
  readonly config = input<Partial<HarnessConfig> | null>(null);
  readonly applied = output<HarnessApplyResponse>();
  readonly openDashboard = output<void>();
  protected readonly hydration = inject(HarnessProposalHydrationService);
  protected readonly health = inject(HarnessHealthStore);
  private readonly rpc = inject(HarnessRpcService);
  private readonly logger = inject(LoggingService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly resultHeading =
    viewChild<ElementRef<HTMLElement>>('resultHeading');
  private readonly applyButton =
    viewChild<ElementRef<HTMLButtonElement>>('applyButton');
  protected readonly result = signal<HarnessApplyResponse | null>(null);
  private readonly appliedPreview = signal<string | null>(null);
  protected readonly applyError = signal(false);
  protected readonly applying = signal(false);
  protected readonly showAllPaths = signal(false);
  protected readonly preview = computed(() => this.config() ?? this.hydration.config());
  protected readonly hasPreview = computed(
    () => Object.keys(this.preview()).length > 0 || !!this.document(),
  );
  protected readonly visiblePaths = computed(
    () =>
      this.result()?.appliedPaths.slice(
        0,
        this.showAllPaths() ? undefined : 5,
      ) ?? [],
  );
  protected readonly previewChanged = computed(
    () =>
      this.result() !== null &&
      this.appliedPreview() !== JSON.stringify(this.preview()),
  );
  protected readonly applyButtonClass = computed(() =>
    (this.hydration.isConfigComplete() && !this.agentBusy()) ||
    this.applyError()
      ? 'btn btn-primary btn-sm w-full'
      : 'btn btn-outline btn-sm w-full border-base-content/50',
  );
  protected workspaceName(): string {
    return (
      this.workspaceRoot().split(/[\\/]/).filter(Boolean).at(-1) ?? 'workspace'
    );
  }
  protected displayPath(path: string): string {
    const root = this.workspaceRoot();
    return root && path.startsWith(root + '/')
      ? path.slice(root.length + 1)
      : root && path.startsWith(root + '\\')
        ? path.slice(root.length + 1)
        : path;
  }
  protected dismissError(): void {
    this.applyError.set(false);
    queueMicrotask(() => this.applyButton()?.nativeElement.focus());
  }
  protected dismissResult(): void {
    this.result.set(null);
    this.appliedPreview.set(null);
    this.showAllPaths.set(false);
    queueMicrotask(() => this.applyButton()?.nativeElement.focus());
  }
  protected async copyPaths(): Promise<void> {
    const paths = this.result()?.appliedPaths;
    if (!paths) return;
    try {
      await navigator.clipboard.writeText(
        paths.map((path) => this.displayPath(path)).join('\n'),
      );
    } catch (error) {
      this.logger.error(
        'HarnessBuilderSidebarComponent',
        'Could not copy applied paths',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
  protected async apply(): Promise<void> {
    if (
      !this.initialized() ||
      !this.hasPreview() ||
      this.agentBusy() ||
      this.applying() ||
      !this.workspaceRoot()
    )
      return;
    this.applying.set(true);
    this.applyError.set(false);
    this.result.set(null);
    this.appliedPreview.set(null);
    try {
      const result = await this.rpc.apply({
        config: fullConfig(this.preview(), this.workspaceRoot()),
        outputFormat: 'claude-md',
        workspaceRoot: this.workspaceRoot(),
      });
      if (this.destroyRef.destroyed) return;
      this.result.set(result);
      this.applied.emit(result);
      this.showAllPaths.set(false);
      this.appliedPreview.set(JSON.stringify(this.preview()));
      queueMicrotask(() => this.resultHeading()?.nativeElement.focus());
      void this.health.refresh();
    } catch (error) {
      if (this.destroyRef.destroyed) return;
      this.logger.error(
        'HarnessBuilderSidebarComponent',
        'Could not apply configuration',
        error instanceof Error ? error : new Error(String(error)),
      );
      this.applyError.set(true);
      queueMicrotask(() => this.applyButton()?.nativeElement.focus());
    } finally {
      if (!this.destroyRef.destroyed) this.applying.set(false);
    }
  }
}
