import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  CronCreateParams,
  CronUpdateParams,
  JobRunDto,
  ScheduledJobDto,
} from '@ptah-extension/shared';
import { CronRpcService } from './cron-rpc.service';

/**
 * Aggregate stats derived from the current job list. The backend does not
 * yet expose a `cron:stats` handler (only nine methods are wired); we derive
 * stats client-side from the job list to keep parity with the architecture
 * spec without inventing a non-existent RPC.
 */
export interface CronAggregateStats {
  total: number;
  enabled: number;
  disabled: number;
  nextRunAt: number | null;
}

@Injectable({ providedIn: 'root' })
export class CronStateService {
  private readonly rpc = inject(CronRpcService);

  // === Writable state ===
  private readonly _jobs = signal<ScheduledJobDto[]>([]);
  private readonly _selectedJobId = signal<string | null>(null);
  private readonly _runs = signal<JobRunDto[]>([]);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  // === Readonly exports ===
  public readonly jobs = this._jobs.asReadonly();
  public readonly selectedJobId = this._selectedJobId.asReadonly();
  public readonly runs = this._runs.asReadonly();
  public readonly loading = this._loading.asReadonly();
  public readonly error = this._error.asReadonly();

  // === Computed ===
  public readonly selectedJob = computed<ScheduledJobDto | null>(() => {
    const id = this._selectedJobId();
    if (!id) return null;
    return this._jobs().find((j) => j.id === id) ?? null;
  });

  public readonly stats = computed<CronAggregateStats>(() => {
    const jobs = this._jobs();
    const enabled = jobs.filter((j) => j.enabled);
    const upcoming = enabled
      .map((j) => j.nextRunAt)
      .filter((v): v is number => typeof v === 'number');
    const nextRunAt = upcoming.length === 0 ? null : Math.min(...upcoming);
    return {
      total: jobs.length,
      enabled: enabled.length,
      disabled: jobs.length - enabled.length,
      nextRunAt,
    };
  });

  public select(id: string | null): void {
    this._selectedJobId.set(id);
    if (id) {
      void this.loadRuns(id);
    } else {
      this._runs.set([]);
    }
  }

  public async refresh(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const result = await this.rpc.list({});
      this._jobs.set(result.jobs);
    } catch (err) {
      this._error.set(this.toMessage(err));
    } finally {
      this._loading.set(false);
    }
  }

  public async create(spec: CronCreateParams): Promise<ScheduledJobDto | null> {
    this._error.set(null);
    try {
      const result = await this.rpc.create(spec);
      this._jobs.update((jobs) => [...jobs, result.job]);
      return result.job;
    } catch (err) {
      this._error.set(this.toMessage(err));
      return null;
    }
  }

  public async update(
    id: string,
    patch: CronUpdateParams['patch'],
  ): Promise<ScheduledJobDto | null> {
    this._error.set(null);
    try {
      const result = await this.rpc.update({ id, patch });
      this._jobs.update((jobs) =>
        jobs.map((j) => (j.id === result.job.id ? result.job : j)),
      );
      return result.job;
    } catch (err) {
      this._error.set(this.toMessage(err));
      return null;
    }
  }

  public async delete(id: string): Promise<boolean> {
    this._error.set(null);
    try {
      const result = await this.rpc.delete({ id });
      if (result.ok) {
        this._jobs.update((jobs) => jobs.filter((j) => j.id !== id));
        if (this._selectedJobId() === id) {
          this._selectedJobId.set(null);
          this._runs.set([]);
        }
      }
      return result.ok;
    } catch (err) {
      this._error.set(this.toMessage(err));
      return false;
    }
  }

  public async toggle(id: string, enabled: boolean): Promise<void> {
    this._error.set(null);
    try {
      const result = await this.rpc.toggle({ id, enabled });
      this._jobs.update((jobs) =>
        jobs.map((j) => (j.id === result.job.id ? result.job : j)),
      );
    } catch (err) {
      this._error.set(this.toMessage(err));
    }
  }

  public async runNow(id: string): Promise<JobRunDto | null> {
    this._error.set(null);
    try {
      const result = await this.rpc.runNow({ id });
      if (result.run) {
        this._runs.update((runs) => [result.run as JobRunDto, ...runs]);
      }
      return result.run;
    } catch (err) {
      this._error.set(this.toMessage(err));
      return null;
    }
  }

  public async loadRuns(id: string, limit = 50): Promise<void> {
    this._error.set(null);
    try {
      const result = await this.rpc.runs({ id, limit });
      this._runs.set(result.runs);
    } catch (err) {
      this._error.set(this.toMessage(err));
    }
  }

  /**
   * Aggregate stats are derived client-side via the {@link stats} computed.
   * This method exists for API symmetry with the requested spec; it simply
   * triggers a refresh of the underlying job list.
   */
  public async loadStats(): Promise<void> {
    await this.refresh();
  }

  private toMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return 'Unknown cron error';
  }
}
