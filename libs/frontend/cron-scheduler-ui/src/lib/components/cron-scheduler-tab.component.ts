// NOTE: backend cron:create is the trust boundary. Client-side
// cron-expression validation here is preview-only.
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
import { VSCodeService } from '@ptah-extension/core';
import type {
  CronCreateParams,
  JobRunDto,
  ScheduledJobDto,
} from '@ptah-extension/shared';

import { CronExpressionService } from '../services/cron-expression.service';
import { CronStateService } from '../services/cron-state.service';

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
  imports: [CommonModule, FormsModule],
  template: `
    @if (!isElectron()) {
      <div class="alert alert-info">
        <span class="text-sm">
          Cron jobs are only available in the Ptah desktop app.
          <a
            class="link link-primary ml-1"
            href="https://github.com/HiveAcademy/ptah-extension/releases"
            target="_blank"
            rel="noopener noreferrer"
            >Download Ptah desktop</a
          >.
        </span>
      </div>
    } @else {
      <div class="flex h-full w-full flex-col gap-4">
        <!-- Aggregate stats -->
        <section
          class="grid grid-cols-2 gap-3 md:grid-cols-4"
          aria-label="Cron statistics"
        >
          <div class="card bg-base-200">
            <div class="card-body p-3">
              <div class="text-xs text-base-content/60">Total jobs</div>
              <div class="text-lg font-semibold">{{ stats().total }}</div>
            </div>
          </div>
          <div class="card bg-base-200">
            <div class="card-body p-3">
              <div class="text-xs text-base-content/60">Enabled</div>
              <div class="text-lg font-semibold text-success">
                {{ stats().enabled }}
              </div>
            </div>
          </div>
          <div class="card bg-base-200">
            <div class="card-body p-3">
              <div class="text-xs text-base-content/60">Disabled</div>
              <div class="text-lg font-semibold text-base-content/70">
                {{ stats().disabled }}
              </div>
            </div>
          </div>
          <div class="card bg-base-200">
            <div class="card-body p-3">
              <div class="text-xs text-base-content/60">Next run</div>
              <div class="text-sm font-mono">
                {{ formatTime(stats().nextRunAt) }}
              </div>
            </div>
          </div>
        </section>

        @if (error()) {
          <div role="alert" class="alert alert-error text-sm">
            <span>{{ error() }}</span>
          </div>
        }

        <!-- Toolbar -->
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="btn btn-primary btn-sm"
            (click)="newJob()"
          >
            New job
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            [disabled]="loading()"
            (click)="refresh()"
          >
            Refresh
          </button>
          <span class="text-xs text-base-content/60">
            Detected timezone: {{ detectedTimezone }}
          </span>
        </div>

        <!-- Jobs table -->
        <section
          class="overflow-x-auto rounded-lg bg-base-200 p-2"
          aria-label="Scheduled jobs"
        >
          @if (jobs().length === 0) {
            <div class="p-4 text-sm text-base-content/60">
              No scheduled jobs yet. Click "New job" to create one.
            </div>
          } @else {
            <table class="table table-sm">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Schedule</th>
                  <th>Next run</th>
                  <th>Status</th>
                  <th class="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (job of jobs(); track job.id) {
                  <tr
                    [class.bg-base-300]="selectedJobId() === job.id"
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
                      @if (job.enabled) {
                        <span class="badge badge-success badge-sm"
                          >enabled</span
                        >
                      } @else {
                        <span class="badge badge-ghost badge-sm">disabled</span>
                      }
                    </td>
                    <td class="text-right">
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs"
                        (click)="$event.stopPropagation(); runNow(job.id)"
                      >
                        Run now
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs"
                        (click)="$event.stopPropagation(); editJob(job)"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs"
                        (click)="$event.stopPropagation(); toggleEnabled(job)"
                      >
                        {{ job.enabled ? 'Disable' : 'Enable' }}
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs text-error"
                        (click)="$event.stopPropagation(); confirmDelete(job)"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>

        <!-- Editor form -->
        @if (formOpen()) {
          <section
            class="rounded-lg border border-base-300 bg-base-100 p-4"
            aria-label="Job editor"
          >
            <h2 class="mb-3 text-sm font-semibold">
              {{ form().id ? 'Edit job' : 'New job' }}
            </h2>
            <div class="grid gap-3 md:grid-cols-2">
              <label class="form-control">
                <span class="label-text text-xs">Name</span>
                <input
                  type="text"
                  class="input input-bordered input-sm"
                  [value]="form().name"
                  (input)="patchForm({ name: inputValue($event) })"
                />
              </label>

              <label class="form-control">
                <span class="label-text text-xs">Cron expression</span>
                <input
                  type="text"
                  class="input input-bordered input-sm font-mono"
                  placeholder="*/5 * * * *"
                  [value]="form().cronExpr"
                  (input)="patchForm({ cronExpr: inputValue($event) })"
                />
                @if (exprPreview().valid) {
                  <span class="mt-1 text-xs text-success">
                    {{ exprPreview().description }}
                  </span>
                } @else if (form().cronExpr.length > 0) {
                  <span class="mt-1 text-xs text-error">
                    {{ exprPreview().error }}
                  </span>
                }
              </label>

              <label class="form-control md:col-span-2">
                <span class="label-text text-xs">Prompt / handler</span>
                <textarea
                  class="textarea textarea-bordered textarea-sm font-mono"
                  rows="3"
                  [value]="form().prompt"
                  (input)="patchForm({ prompt: inputValue($event) })"
                ></textarea>
                <span class="mt-1 text-xs text-base-content/50">
                  Reserved internal handlers (prefixed "handler:") are rejected
                  by the backend.
                </span>
              </label>

              <label class="form-control">
                <span class="label-text text-xs"
                  >Workspace root (optional)</span
                >
                <input
                  type="text"
                  class="input input-bordered input-sm"
                  [value]="form().workspaceRoot"
                  (input)="patchForm({ workspaceRoot: inputValue($event) })"
                />
              </label>

              <label class="form-control">
                <span class="label-text text-xs">Timezone</span>
                <select
                  class="select select-bordered select-sm"
                  [value]="form().timezone"
                  (change)="patchForm({ timezone: selectValue($event) })"
                >
                  @for (tz of timezoneOptions(); track tz) {
                    <option [value]="tz">{{ tz }}</option>
                  }
                </select>
              </label>

              <label class="label cursor-pointer justify-start gap-2">
                <input
                  type="checkbox"
                  class="toggle toggle-sm toggle-primary"
                  [checked]="form().enabled"
                  (change)="patchForm({ enabled: checkboxValue($event) })"
                />
                <span class="label-text text-xs">Enabled</span>
              </label>
            </div>

            <div class="mt-4 flex gap-2">
              <button
                type="button"
                class="btn btn-primary btn-sm"
                [disabled]="!canSubmit() || loading()"
                (click)="submitForm()"
              >
                {{ form().id ? 'Save changes' : 'Create job' }}
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                (click)="closeForm()"
              >
                Cancel
              </button>
            </div>
          </section>
        }

        <!-- Runs history for selected job -->
        @if (selectedJob()) {
          <section class="rounded-lg bg-base-200 p-3" aria-label="Run history">
            <header class="mb-2 flex items-center justify-between">
              <h2 class="text-sm font-semibold">
                Run history — {{ selectedJob()?.name }}
              </h2>
              <span class="text-xs text-base-content/60">
                Last {{ runs().length }} runs
              </span>
            </header>
            @if (runs().length === 0) {
              <p class="text-xs text-base-content/60">No runs recorded yet.</p>
            } @else {
              <ul class="divide-y divide-base-300 text-xs">
                @for (run of runs(); track run.id) {
                  <li class="flex items-center justify-between py-1.5">
                    <span class="font-mono">{{
                      formatTime(run.scheduledFor)
                    }}</span>
                    <span class="badge badge-sm" [class]="statusClass(run)">
                      {{ run.status }}
                    </span>
                    <span class="truncate text-base-content/60">
                      {{ run.resultSummary || run.errorMessage || '' }}
                    </span>
                  </li>
                }
              </ul>
            }
          </section>
        }

        <!-- Settings (read-only) -->
        <section
          class="rounded-lg border border-base-300 p-3 text-xs"
          aria-label="Cron settings"
        >
          <h2 class="mb-1 text-sm font-semibold">Settings</h2>
          <p class="text-base-content/60">
            Cron settings live in <code>~/.ptah/settings.json</code> under
            <code>cron.*</code>. Edit that file and restart Ptah desktop to
            change defaults.
          </p>
        </section>
      </div>
    }
  `,
})
export class CronSchedulerTabComponent implements OnInit {
  private readonly vscodeService = inject(VSCodeService);
  private readonly state = inject(CronStateService);
  private readonly cronExpr = inject(CronExpressionService);

  protected readonly detectedTimezone = detectUserTimezone();

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

  // Editor form state
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

  public newJob(): void {
    this.form.set(emptyForm(this.detectedTimezone));
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
      // R5 mitigation: pass user's timezone in cron:create payload.
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

  public statusClass(run: JobRunDto): string {
    switch (run.status) {
      case 'succeeded':
        return 'badge-success';
      case 'failed':
        return 'badge-error';
      case 'running':
        return 'badge-info';
      case 'skipped':
        return 'badge-warning';
      default:
        return 'badge-ghost';
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
