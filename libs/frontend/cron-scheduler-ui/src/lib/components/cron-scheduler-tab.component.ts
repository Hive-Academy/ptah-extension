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
  Pencil,
  Play,
  Power,
  PowerOff,
  RefreshCw,
  Trash2,
} from 'lucide-angular';
import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import type {
  CronCreateParams,
  JobRunDto,
  ScheduledJobDto,
} from '@ptah-extension/shared';

import { CronExpressionService } from '../services/cron-expression.service';
import {
  CronStateService,
  type CronScopeFilter,
} from '../services/cron-state.service';

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
  imports: [CommonModule, FormsModule, LucideAngularModule],
  template: `
    @if (!isElectron()) {
      <div
        class="flex flex-col items-center gap-2 px-6 py-16 text-center"
        data-testid="cron-empty-state"
      >
        <lucide-angular
          [img]="CalendarClockIcon"
          class="size-8 text-base-content/30"
          aria-hidden="true"
        />
        <p class="text-sm font-medium">Schedules need the desktop app</p>
        <p class="text-xs text-base-content/60">
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
              <p class="mt-0.5 text-sm text-base-content/60">
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
              class="btn btn-ghost btn-sm btn-square text-base-content/50 transition-colors duration-150 hover:text-base-content"
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
              <div class="stat-title text-base-content/60">Jobs</div>
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
              <div class="stat-title text-base-content/60">Enabled</div>
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
              <div class="stat-figure text-base-content/50">
                <lucide-angular
                  [img]="CirclePauseIcon"
                  class="w-6 h-6"
                  aria-hidden="true"
                />
              </div>
              <div class="stat-title text-base-content/60">Disabled</div>
              <div
                class="stat-value text-2xl text-base-content/70"
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
              <div class="stat-title text-base-content/60">Next run</div>
              <div class="stat-value text-sm font-medium text-info">
                {{ formatTime(stats().nextRunAt) }}
              </div>
              @if (stats().nextRunAt !== null) {
                <div class="stat-desc text-base-content/60">
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
              class="size-8 text-base-content/30"
              aria-hidden="true"
            />
            <p class="text-sm font-medium">No scheduled jobs yet</p>
            <p class="max-w-sm text-xs text-base-content/60">
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
            class="overflow-hidden rounded-xl border border-base-300 bg-base-200/40"
            aria-label="Scheduled jobs"
          >
            <table class="table table-sm">
              <thead>
                <tr class="text-xs text-base-content/50">
                  <th class="font-normal">Name</th>
                  <th class="font-normal">Schedule</th>
                  <th class="font-normal">Next run</th>
                  <th class="font-normal">Status</th>
                  <th class="text-right font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (job of jobs(); track job.id) {
                  <tr
                    class="group cursor-pointer transition-colors duration-150 hover:bg-base-300/20"
                    data-testid="cron-job-row"
                    [class.bg-base-300/40]="selectedJobId() === job.id"
                    (click)="selectJob(job.id)"
                  >
                    <td>
                      <div class="font-medium">{{ job.name }}</div>
                      <div class="text-xs text-base-content/60">
                        {{ job.timezone }}
                      </div>
                    </td>
                    <td>
                      <div class="font-mono text-xs">{{ job.cronExpr }}</div>
                      <div class="text-xs text-base-content/60">
                        {{ describeExpr(job.cronExpr) }}
                      </div>
                    </td>
                    <td class="text-xs">
                      <div>{{ formatTime(job.nextRunAt) }}</div>
                      <div class="text-base-content/50">
                        {{ formatRelative(job.nextRunAt) }}
                      </div>
                    </td>
                    <td>
                      <span class="inline-flex items-center gap-1.5">
                        <span
                          class="inline-block size-1.5 rounded-full"
                          [class.bg-success]="job.enabled"
                          [class.bg-base-content/30]="!job.enabled"
                        ></span>
                        <span class="text-xs text-base-content/70">
                          {{ job.enabled ? 'enabled' : 'disabled' }}
                        </span>
                      </span>
                    </td>
                    <td class="text-right">
                      <div
                        class="inline-flex items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                      >
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs btn-square text-base-content/50 transition-colors duration-150"
                          aria-label="Run now"
                          title="Run now"
                          (click)="$event.stopPropagation(); runNow(job.id)"
                        >
                          <lucide-angular
                            [img]="PlayIcon"
                            class="size-3.5"
                            aria-hidden="true"
                          />
                        </button>
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs btn-square text-base-content/50 transition-colors duration-150"
                          aria-label="Edit job"
                          title="Edit job"
                          (click)="$event.stopPropagation(); editJob(job)"
                        >
                          <lucide-angular
                            [img]="PencilIcon"
                            class="size-3.5"
                            aria-hidden="true"
                          />
                        </button>
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs btn-square text-base-content/50 transition-colors duration-150"
                          [attr.aria-label]="
                            job.enabled ? 'Disable job' : 'Enable job'
                          "
                          [attr.title]="
                            job.enabled ? 'Disable job' : 'Enable job'
                          "
                          (click)="$event.stopPropagation(); toggleEnabled(job)"
                        >
                          <lucide-angular
                            [img]="job.enabled ? PowerOffIcon : PowerIcon"
                            class="size-3.5"
                            aria-hidden="true"
                          />
                        </button>
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs btn-square text-base-content/50 transition-colors duration-150 hover:text-error"
                          aria-label="Delete job"
                          title="Delete job"
                          (click)="$event.stopPropagation(); confirmDelete(job)"
                        >
                          <lucide-angular
                            [img]="Trash2Icon"
                            class="size-3.5"
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
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
                <span class="text-xs text-base-content/60">Name</span>
                <input
                  type="text"
                  class="input input-bordered input-sm"
                  data-testid="cron-form-name"
                  [value]="form().name"
                  (input)="patchForm({ name: inputValue($event) })"
                />
              </label>

              <label class="flex flex-col gap-1">
                <span class="text-xs text-base-content/60"
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
                <span class="text-xs text-base-content/60"
                  >Prompt / handler</span
                >
                <textarea
                  class="textarea textarea-bordered textarea-sm font-mono"
                  rows="3"
                  data-testid="cron-form-prompt"
                  [value]="form().prompt"
                  (input)="patchForm({ prompt: inputValue($event) })"
                ></textarea>
                <span class="text-xs text-base-content/50">
                  Reserved internal handlers (prefixed "handler:") are rejected
                  by the backend.
                </span>
              </label>

              <label class="flex flex-col gap-1">
                <span class="text-xs text-base-content/60"
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
                <span class="text-xs text-base-content/60">Timezone</span>
                <select
                  class="select select-bordered select-sm"
                  [value]="form().timezone"
                  (change)="patchForm({ timezone: selectValue($event) })"
                >
                  @for (tz of timezoneOptions(); track tz) {
                    <option [value]="tz">{{ tz }}</option>
                  }
                </select>
                <span class="text-xs text-base-content/50">
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
                <span class="text-xs text-base-content/60">Enabled</span>
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

        @if (selectedJob()) {
          <section
            class="overflow-hidden rounded-xl border border-base-300 bg-base-200/40"
            aria-label="Run history"
          >
            <header class="flex items-center justify-between gap-3 px-4 py-3">
              <h2 class="text-sm font-semibold">
                Run history — {{ selectedJob()?.name }}
              </h2>
              <span class="text-xs text-base-content/60">
                Last {{ runs().length }} runs
              </span>
            </header>
            @if (runs().length === 0) {
              <p class="px-4 pb-3 text-xs text-base-content/60">
                No runs recorded yet.
              </p>
            } @else {
              <ul class="divide-y divide-base-300">
                @for (run of runs(); track run.id) {
                  <li class="flex items-center justify-between gap-3 px-4 py-2">
                    <span class="font-mono text-xs">{{
                      formatTime(run.scheduledFor)
                    }}</span>
                    <span class="inline-flex items-center gap-1.5">
                      <span
                        class="inline-block size-1.5 rounded-full"
                        [class]="statusDotClass(run)"
                      ></span>
                      <span class="text-xs text-base-content/70">
                        {{ run.status }}
                      </span>
                    </span>
                    <span class="truncate text-xs text-base-content/60">
                      {{ run.resultSummary || run.errorMessage || '' }}
                    </span>
                  </li>
                }
              </ul>
            }
          </section>
        }

        <p class="text-xs text-base-content/50">
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
  protected readonly PlayIcon = Play;
  protected readonly PencilIcon = Pencil;
  protected readonly PowerIcon = Power;
  protected readonly PowerOffIcon = PowerOff;
  protected readonly Trash2Icon = Trash2;

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

  public describeExpr(expr: string): string {
    return this.cronExpr.describe(expr);
  }

  public formatTime(epochMs: number | null): string {
    if (epochMs === null || epochMs === undefined) return '—';
    try {
      return new Date(epochMs).toLocaleString();
    } catch {
      return String(epochMs);
    }
  }

  public formatRelative(epochMs: number | null): string {
    if (epochMs === null || epochMs === undefined) return '';
    const delta = epochMs - Date.now();
    const absMs = Math.abs(delta);
    const minutes = Math.round(absMs / 60_000);
    const future = delta >= 0;
    if (minutes < 1) return future ? 'in <1m' : 'just now';
    if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;
    const days = Math.round(hours / 24);
    return future ? `in ${days}d` : `${days}d ago`;
  }

  public statusDotClass(run: JobRunDto): string {
    switch (run.status) {
      case 'succeeded':
        return 'bg-success';
      case 'failed':
        return 'bg-error';
      case 'running':
        return 'bg-info';
      case 'skipped':
        return 'bg-warning';
      default:
        return 'bg-base-content/30';
    }
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
