import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CalendarClock,
  CirclePause,
  CirclePlay,
  Clock,
  LucideAngularModule,
  RefreshCw,
} from 'lucide-angular';
import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import type { CronCreateParams, ScheduledJobDto } from '@ptah-extension/shared';

import { CronExpressionService } from '../services/cron-expression.service';
import {
  CronStateService,
  type CronScopeFilter,
} from '../services/cron-state.service';
import { formatRelative, formatTime } from './cron-format';
import { CronJobCardComponent } from './cron-job-card.component';
import { CronJobDetailDrawerComponent } from './cron-job-detail-drawer.component';

interface CronJobFormState {
  id: string | null;
  name: string;
  cronExpr: string;
  prompt: string;
  workspaceRoot: string;
  timezone: string;
  enabled: boolean;
}

const SUGGESTED_TIMEZONES: readonly string[] = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

function detectUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function emptyForm(timezone: string): CronJobFormState {
  return {
    id: null,
    name: '',
    cronExpr: '',
    prompt: '',
    workspaceRoot: '',
    timezone,
    enabled: true,
  };
}

@Component({
  selector: 'ptah-cron-scheduler-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    CronJobCardComponent,
    CronJobDetailDrawerComponent,
  ],
  template: `
    @if (!isElectron()) {
      <div
        class="flex flex-col items-center gap-2 px-6 py-16 text-center"
        data-testid="cron-empty-state"
      >
        <lucide-angular
          [img]="CalendarClockIcon"
          class="size-8 text-base-content-muted"
          aria-hidden="true"
        />
        <p class="text-sm font-medium">Schedules need the desktop app</p>
        <p class="text-xs text-base-content-muted">
          Cron jobs run headless Ptah sessions in the background, which is only
          available in the Ptah desktop app.
        </p>
        <a
          class="link link-primary text-xs"
          href="https://github.com/HiveAcademy/ptah-extension/releases"
          target="_blank"
          rel="noopener noreferrer"
          >Download Ptah desktop</a
        >
      </div>
    } @else {
      <div class="space-y-6">
        <header class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex items-start gap-3">
            <span
              class="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-base-content/10 bg-base-200/60 text-info"
            >
              <lucide-angular
                [img]="CalendarClockIcon"
                class="w-5 h-5"
                aria-hidden="true"
              />
            </span>
            <div>
              <h1 class="text-xl font-semibold tracking-tight">Schedules</h1>
              <p class="mt-0.5 text-sm text-base-content-muted">
                Cron jobs that run headless Ptah sessions on a schedule.
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <div
              class="join"
              role="tablist"
              aria-label="Schedule workspace scope"
            >
              <button
                type="button"
                role="tab"
                class="join-item btn btn-sm"
                data-testid="cron-scope-workspace"
                [class.btn-primary]="scopeFilter() === 'workspace'"
                [attr.aria-selected]="scopeFilter() === 'workspace'"
                (click)="onScopeChange('workspace')"
              >
                This workspace
              </button>
              <button
                type="button"
                role="tab"
                class="join-item btn btn-sm"
                data-testid="cron-scope-all"
                [class.btn-primary]="scopeFilter() === 'all'"
                [attr.aria-selected]="scopeFilter() === 'all'"
                (click)="onScopeChange('all')"
              >
                All workspaces
              </button>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-square text-base-content-muted transition-colors duration-150 hover:text-base-content"
              aria-label="Refresh jobs"
              title="Refresh jobs"
              [disabled]="loading()"
              (click)="refresh()"
            >
              <lucide-angular
                [img]="RefreshCwIcon"
                class="size-4"
                [class.animate-spin]="loading()"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              class="btn btn-primary btn-sm transition-colors duration-150"
              data-testid="cron-new-job-btn"
              (click)="newJob()"
            >
              New job
            </button>
          </div>
        </header>

        <div
          class="grid grid-cols-2 gap-3 xl:grid-cols-4"
          aria-label="Cron statistics"
        >
          <div
            class="stats bg-base-200/40 border border-base-content/10 shadow-sm"
          >
            <div class="stat p-4">
              <div class="stat-figure text-primary">
                <lucide-angular
                  [img]="CalendarClockIcon"
                  class="w-6 h-6"
                  aria-hidden="true"
                />
              </div>
              <div class="stat-title text-base-content-muted">Jobs</div>
              <div
                class="stat-value text-2xl text-primary"
                data-testid="cron-stat-total"
              >
                {{ stats().total }}
              </div>
            </div>
          </div>

          <div
            class="stats bg-base-200/40 border border-base-content/10 shadow-sm"
          >
            <div class="stat p-4">
              <div class="stat-figure text-success">
                <lucide-angular
                  [img]="CirclePlayIcon"
                  class="w-6 h-6"
                  aria-hidden="true"
                />
              </div>
              <div class="stat-title text-base-content-muted">Enabled</div>
              <div
                class="stat-value text-2xl text-success"
                data-testid="cron-stat-enabled"
              >
                {{ stats().enabled }}
              </div>
            </div>
          </div>

          <div
            class="stats bg-base-200/40 border border-base-content/10 shadow-sm"
          >
            <div class="stat p-4">
              <div class="stat-figure text-base-content-muted">
                <lucide-angular
                  [img]="CirclePauseIcon"
                  class="w-6 h-6"
                  aria-hidden="true"
                />
              </div>
              <div class="stat-title text-base-content-muted">Disabled</div>
              <div
                class="stat-value text-2xl text-base-content-muted"
                data-testid="cron-stat-disabled"
              >
                {{ stats().disabled }}
              </div>
            </div>
          </div>

          <div
            class="stats bg-base-200/40 border border-base-content/10 shadow-sm"
          >
            <div class="stat p-4">
              <div class="stat-figure text-info">
                <lucide-angular
                  [img]="ClockIcon"
                  class="w-6 h-6"
                  aria-hidden="true"
                />
              </div>
              <div class="stat-title text-base-content-muted">Next run</div>
              <div class="stat-value text-sm font-medium text-info">
                {{ formatTime(stats().nextRunAt) }}
              </div>
              @if (stats().nextRunAt !== null) {
                <div class="stat-desc text-base-content-muted">
                  {{ formatRelative(stats().nextRunAt) }}
                </div>
              }
            </div>
          </div>
        </div>

        @if (error()) {
          <div role="alert" class="alert alert-error text-sm">
            <span>{{ error() }}</span>
          </div>
        }

        @if (jobs().length === 0) {
          <div
            class="flex flex-col items-center gap-2 px-6 py-16 text-center"
            data-testid="cron-empty-state"
          >
            <lucide-angular
              [img]="CalendarClockIcon"
              class="size-8 text-base-content-muted"
              aria-hidden="true"
            />
            <p class="text-sm font-medium">No scheduled jobs yet</p>
            <p class="max-w-sm text-xs text-base-content-muted">
              Cron jobs run a prompt on a recurring schedule as a headless Ptah
              session — perfect for nightly builds, digests, or maintenance.
            </p>
            <button
              type="button"
              class="btn btn-primary btn-sm mt-1 transition-colors duration-150"
              (click)="newJob()"
            >
              New job
            </button>
          </div>
        } @else {
          <section
            class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
            aria-label="Scheduled jobs"
          >
            @for (job of jobs(); track job.id) {
              <ptah-cron-job-card
                [job]="job"
                [description]="describeExpr(job.cronExpr)"
                [selected]="selectedJobId() === job.id"
                (opened)="selectJob(job.id)"
                (runNow)="runNow(job.id)"
                (edit)="editJob(job)"
                (toggled)="toggleEnabled(job)"
                (removed)="confirmDelete(job)"
              />
            }
          </section>
        }

        @if (formOpen()) {
          <section
            class="overflow-hidden rounded-xl border border-base-300 bg-base-200/40 p-5"
            aria-label="Job editor"
            data-testid="cron-form"
          >
            <h2 class="text-sm font-semibold">
              {{ form().id ? 'Edit job' : 'New job' }}
            </h2>
            <div class="mt-4 grid max-w-2xl gap-4 sm:grid-cols-2">
              <label class="flex flex-col gap-1">
                <span class="text-xs text-base-content-muted">Name</span>
                <input
                  type="text"
                  class="input input-bordered input-sm"
                  data-testid="cron-form-name"
                  [value]="form().name"
                  (input)="patchForm({ name: inputValue($event) })"
                />
              </label>

              <label class="flex flex-col gap-1">
                <span class="text-xs text-base-content-muted"
                  >Cron expression</span
                >
                <input
                  type="text"
                  class="input input-bordered input-sm font-mono"
                  data-testid="cron-form-expr"
                  placeholder="*/5 * * * *"
                  [value]="form().cronExpr"
                  (input)="patchForm({ cronExpr: inputValue($event) })"
                />
                @if (exprPreview().valid) {
                  <span class="text-xs text-success">
                    {{ exprPreview().description }}
                  </span>
                } @else if (form().cronExpr.length > 0) {
                  <span class="text-xs text-error">
                    {{ exprPreview().error }}
                  </span>
                }
              </label>

              <label class="flex flex-col gap-1 sm:col-span-2">
                <span class="text-xs text-base-content-muted"
                  >Prompt / handler</span
                >
                <textarea
                  class="textarea textarea-bordered textarea-sm font-mono"
                  rows="3"
                  data-testid="cron-form-prompt"
                  [value]="form().prompt"
                  (input)="patchForm({ prompt: inputValue($event) })"
                ></textarea>
                <span class="text-xs text-base-content-muted">
                  Reserved internal handlers (prefixed "handler:") are rejected
                  by the backend.
                </span>
              </label>

              <label class="flex flex-col gap-1">
                <span class="text-xs text-base-content-muted"
                  >Workspace root (optional)</span
                >
                <input
                  type="text"
                  class="input input-bordered input-sm"
                  [value]="form().workspaceRoot"
                  (input)="patchForm({ workspaceRoot: inputValue($event) })"
                />
              </label>

              <label class="flex flex-col gap-1">
                <span class="text-xs text-base-content-muted">Timezone</span>
                <select
                  class="select select-bordered select-sm"
                  [value]="form().timezone"
                  (change)="patchForm({ timezone: selectValue($event) })"
                >
                  @for (tz of timezoneOptions(); track tz) {
                    <option [value]="tz">{{ tz }}</option>
                  }
                </select>
                <span class="text-xs text-base-content-muted">
                  Detected timezone: {{ detectedTimezone }}
                </span>
              </label>

              <label class="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  class="toggle toggle-sm toggle-primary"
                  [checked]="form().enabled"
                  (change)="patchForm({ enabled: checkboxValue($event) })"
                />
                <span class="text-xs text-base-content-muted">Enabled</span>
              </label>
            </div>

            <div class="mt-5 flex gap-2">
              <button
                type="button"
                class="btn btn-primary btn-sm transition-colors duration-150"
                data-testid="cron-form-submit"
                [disabled]="!canSubmit() || loading()"
                (click)="submitForm()"
              >
                {{ form().id ? 'Save changes' : 'Create job' }}
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-sm transition-colors duration-150"
                (click)="closeForm()"
              >
                Cancel
              </button>
            </div>
          </section>
        }

        <ptah-cron-job-detail-drawer
          [job]="selectedJob()"
          [runs]="runs()"
          [description]="selectedDescription()"
          (closed)="closeDetail()"
          (runNow)="runSelected()"
          (edit)="editSelected()"
          (toggled)="toggleSelected()"
          (removed)="deleteSelected()"
        />

        <p class="text-xs text-base-content-muted">
          Cron settings live in
          <span class="font-mono">~/.ptah/settings.json</span> under
          <span class="font-mono">cron.*</span>. Edit that file and restart Ptah
          desktop to change defaults.
        </p>
      </div>
    }
  `,
})
export class CronSchedulerTabComponent implements OnInit {
  private readonly vscodeService = inject(VSCodeService);
  private readonly state = inject(CronStateService);
  private readonly cronExpr = inject(CronExpressionService);
  private readonly appState = inject(AppStateManager);

  protected readonly detectedTimezone = detectUserTimezone();

  protected readonly CalendarClockIcon = CalendarClock;
  protected readonly CirclePlayIcon = CirclePlay;
  protected readonly CirclePauseIcon = CirclePause;
  protected readonly ClockIcon = Clock;
  protected readonly RefreshCwIcon = RefreshCw;

  public readonly isElectron = computed(
    () => this.vscodeService.config()?.isElectron === true,
  );

  public readonly jobs = this.state.jobs;
  public readonly runs = this.state.runs;
  public readonly loading = this.state.loading;
  public readonly error = this.state.error;
  public readonly selectedJobId = this.state.selectedJobId;
  public readonly selectedJob = this.state.selectedJob;
  public readonly stats = this.state.stats;
  public readonly scopeFilter = this.state.scopeFilter;

  public readonly formOpen = signal<boolean>(false);
  public readonly form = signal<CronJobFormState>(
    emptyForm(this.detectedTimezone),
  );

  public readonly exprPreview = computed(() => {
    const expr = this.form().cronExpr;
    const v = this.cronExpr.validate(expr);
    if (!v.valid) {
      return { valid: false, description: '', error: v.error };
    }
    return {
      valid: true,
      description: this.cronExpr.describe(expr),
    };
  });

  public readonly canSubmit = computed(() => {
    const f = this.form();
    return (
      f.name.trim().length > 0 &&
      f.prompt.trim().length > 0 &&
      this.exprPreview().valid
    );
  });

  /**
   * Human rendering of the selected job's cron expression, resolved once here
   * rather than inside the drawer so the drawer stays free of Angular DI.
   */
  public readonly selectedDescription = computed<string>(() => {
    const job = this.selectedJob();
    return job === null ? '' : this.cronExpr.describe(job.cronExpr);
  });

  public readonly timezoneOptions = computed<readonly string[]>(() => {
    const tz = this.detectedTimezone;
    if (SUGGESTED_TIMEZONES.includes(tz)) return SUGGESTED_TIMEZONES;
    return [tz, ...SUGGESTED_TIMEZONES];
  });

  public ngOnInit(): void {
    if (this.isElectron()) {
      void this.state.refresh();
    }
  }

  public refresh(): void {
    void this.state.refresh();
  }

  public onScopeChange(scope: CronScopeFilter): void {
    this.state.setScopeFilter(scope);
  }

  public newJob(): void {
    const form = emptyForm(this.detectedTimezone);
    // Stamp new jobs with the active workspace so they surface under the
    // default 'workspace' scope. The field stays editable for advanced users.
    const activeRoot = this.appState.workspaceInfo()?.path;
    if (activeRoot) form.workspaceRoot = activeRoot;
    this.form.set(form);
    this.formOpen.set(true);
  }

  public editJob(job: ScheduledJobDto): void {
    // Close the detail drawer first — it is a modal overlay, and leaving it up
    // while the inline editor opens behind it would stack two surfaces and
    // trap focus in the wrong one.
    this.state.select(null);
    this.form.set({
      id: job.id,
      name: job.name,
      cronExpr: job.cronExpr,
      prompt: job.prompt,
      workspaceRoot: job.workspaceRoot ?? '',
      timezone: job.timezone,
      enabled: job.enabled,
    });
    this.formOpen.set(true);
  }

  public closeForm(): void {
    this.formOpen.set(false);
  }

  public patchForm(patch: Partial<CronJobFormState>): void {
    this.form.update((f) => ({ ...f, ...patch }));
  }

  public async submitForm(): Promise<void> {
    if (!this.canSubmit()) return;
    const f = this.form();
    const workspaceRoot =
      f.workspaceRoot.trim().length === 0 ? null : f.workspaceRoot;

    if (f.id) {
      await this.state.update(f.id, {
        name: f.name,
        cronExpr: f.cronExpr,
        prompt: f.prompt,
        workspaceRoot,
        timezone: f.timezone,
        enabled: f.enabled,
      });
    } else {
      const params: CronCreateParams = {
        name: f.name,
        cronExpr: f.cronExpr,
        prompt: f.prompt,
        workspaceRoot,
        timezone: f.timezone,
        enabled: f.enabled,
      };
      await this.state.create(params);
    }
    this.formOpen.set(false);
  }

  public async toggleEnabled(job: ScheduledJobDto): Promise<void> {
    await this.state.toggle(job.id, !job.enabled);
  }

  public async runNow(id: string): Promise<void> {
    this.state.select(id);
    await this.state.runNow(id);
  }

  public confirmDelete(job: ScheduledJobDto): void {
    const proceed =
      typeof globalThis.confirm === 'function'
        ? globalThis.confirm(
            `Delete cron job "${job.name}"? This cannot be undone.`,
          )
        : true;
    if (!proceed) return;
    void this.state.delete(job.id);
  }

  public selectJob(id: string): void {
    this.state.select(id);
  }

  /** Drawer asked to close — clearing the selection is what closes it. */
  public closeDetail(): void {
    this.state.select(null);
  }

  public runSelected(): void {
    const job = this.selectedJob();
    if (job) void this.runNow(job.id);
  }

  public editSelected(): void {
    const job = this.selectedJob();
    if (job) this.editJob(job);
  }

  public toggleSelected(): void {
    const job = this.selectedJob();
    if (job) void this.toggleEnabled(job);
  }

  public deleteSelected(): void {
    const job = this.selectedJob();
    if (job) this.confirmDelete(job);
  }

  public describeExpr(expr: string): string {
    return this.cronExpr.describe(expr);
  }

  public formatTime(epochMs: number | null): string {
    return formatTime(epochMs);
  }

  public formatRelative(epochMs: number | null): string {
    return formatRelative(epochMs);
  }

  public inputValue(event: Event): string {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    return target.value;
  }

  public selectValue(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  public checkboxValue(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
}
