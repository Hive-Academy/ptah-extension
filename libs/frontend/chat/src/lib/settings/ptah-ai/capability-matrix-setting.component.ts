import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ClaudeRpcService, LoggingService } from '@ptah-extension/core';
import {
  OUTCOME_TASK_KINDS,
  type AgentCapabilityMatrixProfile,
  type AgentGetCapabilityMatrixParams,
  type OutcomeTaskKind,
} from '@ptah-extension/shared';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
const RPC_TIMEOUT_MS = 5_000;
const NO_PARAMS: AgentGetCapabilityMatrixParams = {};

interface MatrixRow {
  readonly track: string;
  readonly family: string;
  readonly model: string;
  readonly kind: OutcomeTaskKind;
  readonly scoreLabel: string;
  readonly source: string;
  readonly samples: string;
  readonly stale: string;
}

/**
 * Read-only capability matrix (`agent:getCapabilityMatrix`). Electron only:
 * the parent mounts it under `isElectron`. Unknown cells render as "unrated".
 */
@Component({
  selector: 'ptah-capability-matrix-setting',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      data-glass-surface="content"
      class="flex flex-col gap-3 text-sm text-base-content"
      aria-labelledby="capability-matrix-heading"
      data-testid="capability-matrix-setting"
    >
      <div class="border-b border-base-content/10 pb-2">
        <h3
          id="capability-matrix-heading"
          class="text-base font-semibold text-base-content"
        >
          Capability matrix
        </h3>
        <p class="mt-0.5 text-xs text-base-content-muted">
          Scores for each family, model and task kind. Unrated means no
          evidence yet.
        </p>
      </div>

      @switch (load()) {
        @case ('loading') {
          <p
            class="text-xs text-base-content-muted"
            role="status"
            aria-live="polite"
            data-testid="capability-matrix-loading"
          >
            Loading capability matrix…
          </p>
        }
        @case ('error') {
          <div role="alert" class="space-y-1.5">
            <p data-testid="capability-matrix-error">
              The capability matrix could not be read.
            </p>
            <button
              type="button"
              [class]="
                'btn btn-outline btn-sm border-base-content-muted text-base-content ' +
                focusRing
              "
              (click)="reload()"
              data-testid="capability-matrix-retry"
            >
              Retry
            </button>
          </div>
        }
        @default {
          @if (rows().length === 0) {
            <p
              class="text-xs text-base-content-muted"
              data-testid="capability-matrix-empty"
            >
              No capability matrix yet.
            </p>
          } @else {
            <div class="overflow-x-auto">
              <table class="table table-xs" data-testid="capability-matrix-table">
                <thead>
                  <tr>
                    <th scope="col">Family</th>
                    <th scope="col">Model</th>
                    <th scope="col">Task</th>
                    <th scope="col">Score</th>
                    <th scope="col">Source</th>
                    <th scope="col">Samples</th>
                    <th scope="col">Stale</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of rows(); track row.track) {
                    <tr [attr.data-testid]="'matrix-row-' + row.track">
                      <td>{{ row.family }}</td>
                      <td>{{ row.model }}</td>
                      <td>{{ row.kind }}</td>
                      <td>{{ row.scoreLabel }}</td>
                      <td>{{ row.source }}</td>
                      <td>{{ row.samples }}</td>
                      <td>{{ row.stale }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
      }
    </section>
  `,
  styles: `
    :host-context([data-glass='on']) [data-glass-surface='content'] {
      padding: 1.25rem;
    }
  `,
})
export class CapabilityMatrixSettingComponent implements OnInit {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly logger = inject(LoggingService);

  protected readonly focusRing = FOCUS;
  protected readonly load = signal<'loading' | 'ready' | 'error'>('loading');
  private readonly profiles = signal<readonly AgentCapabilityMatrixProfile[]>(
    [],
  );

  protected readonly rows = computed(() => flatten(this.profiles()));

  ngOnInit(): void {
    void this.reload();
  }

  protected async reload(): Promise<void> {
    this.load.set('loading');
    try {
      const response = await this.rpc.call(
        'agent:getCapabilityMatrix',
        NO_PARAMS,
        { timeout: RPC_TIMEOUT_MS },
      );
      if (!response.isSuccess()) {
        this.profiles.set([]);
        this.load.set('error');
        return;
      }
      this.profiles.set(response.data.profiles);
      this.load.set('ready');
    } catch (error: unknown) {
      // degradation-audit: reported - a failed read shows the error row with Retry.
      this.logger.warn('CapabilityMatrixSetting', 'agent:getCapabilityMatrix failed', {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      });
      this.profiles.set([]);
      this.load.set('error');
    }
  }
}

function flatten(
  profiles: readonly AgentCapabilityMatrixProfile[],
): readonly MatrixRow[] {
  const rows: MatrixRow[] = [];
  for (const profile of profiles) {
    for (const kind of OUTCOME_TASK_KINDS) {
      const cell = profile.cells[kind];
      const unrated = cell.kind === 'unknown';
      rows.push({
        track: `${profile.family}-${profile.model}-${kind}`,
        family: profile.family,
        model: profile.model,
        kind,
        scoreLabel: unrated ? 'unrated' : String(cell.score),
        source: unrated ? '—' : cell.source,
        samples:
          unrated || cell.sampleCount === null ? '—' : String(cell.sampleCount),
        stale: unrated ? '—' : cell.stale ? 'yes' : 'no',
      });
    }
  }
  return rows;
}
