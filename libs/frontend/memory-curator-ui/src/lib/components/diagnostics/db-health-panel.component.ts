import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
} from '@angular/core';
import type {
  MemoryDbHealthDto,
  VecLoadDiagnosticWire,
} from '@ptah-extension/shared';

import { VecEmbedderRecoveryService } from '../../services/vec-embedder-recovery.service';

interface HealthRow {
  readonly label: string;
  readonly primary: number;
  readonly secondary: number;
  readonly secondaryLabel: string;
  readonly mismatch: boolean;
  readonly readError: boolean;
}

const VEC_REASON_COPY: Record<VecLoadDiagnosticWire['reason'], string> = {
  ok: 'Loaded',
  'binary-missing': 'Native binary missing on disk',
  'load-failed': 'Native binary present but failed to load',
  'extensions-disabled': 'better-sqlite3 was built without loadExtension',
  'no-resolver': 'No resolver configured for sqlite-vec',
  'not-attempted': 'No load has been attempted',
};

@Component({
  selector: 'ptah-db-health-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-3">
      <div class="rounded-md border border-base-300 bg-base-100">
        <header
          class="border-b border-base-300 px-3 py-2 text-sm font-semibold text-base-content"
        >
          DB Health
        </header>
        @if (health(); as h) {
          <table class="w-full text-xs">
            <tbody>
              @for (row of rows(); track row.label) {
                <tr class="border-b border-base-200 last:border-b-0">
                  <td class="px-3 py-1.5 font-medium">{{ row.label }}</td>
                  <td class="px-3 py-1.5 text-right tabular-nums">
                    {{ row.primary }} / {{ row.secondary }}
                    <span class="ml-1">{{ row.secondaryLabel }}</span>
                  </td>
                  <td class="px-3 py-1.5 text-right">
                    @if (row.readError) {
                      <span
                        class="font-medium text-warning"
                        data-testid="health-read-error"
                      >
                        ⚠ read failed
                      </span>
                    } @else if (row.mismatch) {
                      <span
                        class="font-bold text-error"
                        data-testid="health-mismatch"
                      >
                        ✗ MISMATCH
                      </span>
                    } @else {
                      <span class="text-success">✓</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr class="border-t border-base-300 bg-base-200/50">
                <td class="px-3 py-1.5 text-xs font-medium" colspan="2">
                  coherent
                </td>
                <td class="px-3 py-1.5 text-right">
                  @if (h.coherent) {
                    <span class="badge badge-success badge-sm">true</span>
                  } @else {
                    <span class="badge badge-error badge-sm">false</span>
                  }
                </td>
              </tr>
            </tfoot>
          </table>
          @if (countErrors().length > 0) {
            <div
              class="border-t border-base-300 px-3 py-2"
              data-testid="health-count-errors"
            >
              <p class="text-xs font-medium text-warning">
                Some health counts could not be read — values shown for those
                tables are incomplete, not necessarily wrong.
              </p>
              <ul class="mt-1 list-disc space-y-0.5 pl-5">
                @for (err of countErrors(); track err) {
                  <li class="font-mono text-[10px] text-base-content/70">
                    {{ err }}
                  </li>
                }
              </ul>
            </div>
          }
        } @else {
          <div class="px-3 py-3 text-xs text-base-content/60">
            No DB health data yet.
          </div>
        }
      </div>

      <div
        class="rounded-md border border-base-300 bg-base-100"
        data-testid="vec-status-panel"
      >
        <header
          class="flex items-center justify-between border-b border-base-300 px-3 py-2"
        >
          <span class="text-sm font-semibold text-base-content">
            sqlite-vec
          </span>
          @if (vecAvailable()) {
            <span class="badge badge-success badge-sm" data-testid="vec-badge">
              online
            </span>
          } @else {
            <span class="badge badge-error badge-sm" data-testid="vec-badge">
              offline
            </span>
          }
        </header>
        <div class="px-3 py-2 text-xs">
          @if (vecDiagnostic(); as d) {
            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt class="font-medium text-base-content/70">Reason</dt>
              <dd>{{ vecReasonLabel() }}</dd>
              @if (d.packageName) {
                <dt class="font-medium text-base-content/70">Package</dt>
                <dd class="font-mono">{{ d.packageName }}</dd>
              }
              <dt class="font-medium text-base-content/70">Platform</dt>
              <dd class="font-mono">
                {{ d.processPlatform }}/{{ d.processArch }} (Electron
                {{ d.electronVersion }})
              </dd>
              @if (d.error?.message) {
                <dt class="font-medium text-error">Error</dt>
                <dd class="text-error">{{ d.error?.message }}</dd>
              }
            </dl>
            @if (d.errorChain && d.errorChain.length > 0) {
              <details class="mt-2">
                <summary
                  class="cursor-pointer text-base-content/60 hover:text-base-content"
                >
                  Show {{ d.errorChain.length }} fallback attempt(s)
                </summary>
                <ul class="mt-1 list-disc space-y-1 pl-5">
                  @for (attempt of d.errorChain; track attempt.strategy) {
                    <li class="font-mono text-[10px]">
                      <span class="font-semibold">{{ attempt.strategy }}:</span>
                      {{ attempt.message }}
                    </li>
                  }
                </ul>
              </details>
            }
          } @else {
            <div class="text-base-content/60">
              Status not yet available — open the workspace or click Retry.
            </div>
          }
        </div>
        <div class="flex flex-wrap gap-2 border-t border-base-300 px-3 py-2">
          <button
            type="button"
            class="btn btn-xs btn-primary"
            [disabled]="vecBusy()"
            (click)="onRetryVec()"
            data-testid="vec-retry-btn"
          >
            @if (vecBusy()) {
              <span class="loading loading-spinner loading-xs"></span>
            }
            Retry vec
          </button>
          <button
            type="button"
            class="btn btn-xs btn-ghost"
            [disabled]="!vecDiagnostic()?.attemptedPath"
            (click)="onOpenBindingFolder()"
            data-testid="vec-open-folder-btn"
          >
            Open binding folder
          </button>
        </div>
      </div>

      <div
        class="rounded-md border border-base-300 bg-base-100"
        data-testid="embedder-status-panel"
      >
        <header
          class="flex items-center justify-between border-b border-base-300 px-3 py-2"
        >
          <span class="text-sm font-semibold text-base-content">
            Embedder
          </span>
          <span
            class="badge badge-sm"
            [class.badge-success]="embedderReady()"
            [class.badge-warning]="embedderDownloading() && !embedderReady()"
            [class.badge-error]="
              !embedderReady() &&
              !embedderDownloading() &&
              embedderStatus()?.error !== undefined
            "
            [class.badge-ghost]="
              !embedderReady() &&
              !embedderDownloading() &&
              !embedderStatus()?.error
            "
            data-testid="embedder-badge"
          >
            {{ embedderBadgeLabel() }}
          </span>
        </header>
        <div class="px-3 py-2 text-xs">
          @if (embedderDownloading()) {
            <div class="flex items-center gap-2">
              <progress
                class="progress progress-warning h-2 flex-1"
                [value]="embedderProgressPercent()"
                max="100"
                data-testid="embedder-progress"
              ></progress>
              <span class="tabular-nums">
                {{ embedderProgressPercent() }}%
              </span>
            </div>
            <p class="mt-1 text-base-content/60">
              Downloading ONNX model — first run only, then cached locally.
            </p>
          } @else if (embedderStatus()?.error; as err) {
            <div class="text-error">{{ err.message }}</div>
            <p class="mt-1 text-base-content/60">
              Click Retry after fixing network access or disk-space issues.
            </p>
          } @else if (embedderReady()) {
            <div class="text-base-content/70">
              Model loaded — semantic search and curator embeddings active.
            </div>
          } @else {
            <div class="text-base-content/60">
              Idle — first curator or indexer run will trigger lazy download.
            </div>
          }
        </div>
        <div class="flex flex-wrap gap-2 border-t border-base-300 px-3 py-2">
          <button
            type="button"
            class="btn btn-xs btn-primary"
            [disabled]="embedderBusy() || embedderDownloading()"
            (click)="onRetryEmbedder()"
            data-testid="embedder-retry-btn"
          >
            @if (embedderBusy()) {
              <span class="loading loading-spinner loading-xs"></span>
            }
            {{ embedderReady() ? 'Re-warm' : 'Retry / download now' }}
          </button>
          <button
            type="button"
            class="btn btn-xs btn-ghost"
            (click)="onCopyDiagnostic()"
            data-testid="copy-diagnostic-btn"
          >
            Copy diagnostic
          </button>
        </div>
      </div>

      @if (toast(); as t) {
        <div
          class="alert py-2 text-xs"
          [class.alert-success]="t.kind === 'success'"
          [class.alert-warning]="t.kind === 'warn'"
          [class.alert-error]="t.kind === 'error'"
          role="status"
          data-testid="recovery-toast"
        >
          <span class="flex-1">{{ t.message }}</span>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            (click)="onDismissToast()"
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      }
    </div>
  `,
})
export class DbHealthPanelComponent implements OnInit {
  public readonly health = input<MemoryDbHealthDto | null>(null);

  private readonly recovery = inject(VecEmbedderRecoveryService);

  protected readonly vecDiagnostic = this.recovery.vecDiagnostic;
  protected readonly vecAvailable = this.recovery.vecAvailable;
  protected readonly vecBusy = this.recovery.vecBusy;
  protected readonly embedderStatus = this.recovery.embedderStatus;
  protected readonly embedderReady = this.recovery.embedderReady;
  protected readonly embedderBusy = this.recovery.embedderBusy;
  protected readonly embedderDownloading = this.recovery.embedderDownloading;
  protected readonly toast = this.recovery.lastToast;

  protected readonly vecReasonLabel = computed<string>(() => {
    const d = this.vecDiagnostic();
    if (!d) return 'Unknown';
    return VEC_REASON_COPY[d.reason] ?? d.reason;
  });

  protected readonly embedderProgressPercent = computed<number>(() => {
    const p = this.embedderStatus()?.progress;
    if (typeof p !== 'number') return 0;
    return Math.max(0, Math.min(100, Math.round(p * 100)));
  });

  protected readonly embedderBadgeLabel = computed<string>(() => {
    const s = this.embedderStatus();
    if (!s) return 'unknown';
    if (s.ready) return 'ready';
    if (s.downloading) return 'downloading';
    if (s.error) return 'error';
    return 'idle';
  });

  protected readonly rows = computed<readonly HealthRow[]>(() => {
    const h = this.health();
    if (!h) return [];
    const errors = h.countErrors ?? [];
    const hasReadError = (...tables: string[]): boolean =>
      errors.some((e) => tables.some((t) => e.startsWith(t)));
    return [
      {
        label: 'memory_chunks',
        primary: h.memory_chunks,
        secondary: h.memory_chunks_vec,
        secondaryLabel: 'vec',
        mismatch: h.mismatches.includes('memory_chunks/memory_chunks_vec'),
        readError: hasReadError('memory_chunks_vec', 'memory_chunks:'),
      },
      {
        label: 'memory_chunks',
        primary: h.memory_chunks,
        secondary: h.memory_chunks_fts,
        secondaryLabel: 'fts',
        mismatch: h.mismatches.includes('memory_chunks/memory_chunks_fts'),
        readError: hasReadError('memory_chunks_fts', 'memory_chunks:'),
      },
      {
        label: 'code_symbols',
        primary: h.code_symbols,
        secondary: h.code_symbols_vec,
        secondaryLabel: 'vec',
        mismatch: h.mismatches.includes('code_symbols/code_symbols_vec'),
        readError: hasReadError('code_symbols'),
      },
    ];
  });

  protected readonly countErrors = computed<readonly string[]>(
    () => this.health()?.countErrors ?? [],
  );

  ngOnInit(): void {
    void this.recovery.prime();
  }

  protected onRetryVec(): void {
    void this.recovery.retryVec();
  }

  protected onRetryEmbedder(): void {
    void this.recovery.retryEmbedder();
  }

  protected onOpenBindingFolder(): void {
    void this.recovery.openBindingFolder();
  }

  protected onCopyDiagnostic(): void {
    void this.recovery.copyDiagnostic();
  }

  protected onDismissToast(): void {
    this.recovery.dismissToast();
  }
}
