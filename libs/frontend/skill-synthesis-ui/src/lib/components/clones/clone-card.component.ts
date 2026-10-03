/**
 * CloneCardComponent — one Library entry as a card.
 *
 * Replaces a row of the old flat clone table. Two things changed beyond
 * layout, both deliberate:
 *
 * 1. EMPTINESS READS AS EMPTY. The table rendered four `—` cells for an entry
 *    that had simply never run, which looks like broken data. The card shows
 *    only the metrics that actually exist and, when none do, one sentence
 *    saying why.
 *
 * 2. ACTIONS ARE CONTEXTUAL. Availability comes from {@link cloneActionModel},
 *    so an action the backend would reject is either disabled with the reason
 *    on it, or not rendered at all (Rebase on an entry with no upstream).
 *
 * Agent cards on the desktop host also carry one chip per provider copy
 * (`syncChips`, TASK_2026_609) and a note when the agent is not owned by this
 * workspace (`notOwned`). Both default to empty, which renders nothing.
 *
 * Pure presentational: `input()` signals in, `output()` events out, no service
 * injection and no RPC. `OnPush`.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { NativeCardComponent, NativeCardTone } from '@ptah-extension/ui';
import type {
  AgentScorecard,
  CloneSummary,
  SkillCloneStatus,
} from '@ptah-extension/shared';

import { ScorecardBadgeComponent } from './scorecard-badge.component';
import {
  CloneActionModel,
  KEEP_MINE_EXPLANATION,
  cloneActionModel,
  cloneStatusLabel,
  formatRelative,
  formatSuccessRate,
} from './clone-action-gating';
import type { AgentSyncChip, AgentSyncChipState } from './agent-sync-chips';

interface CloneMetric {
  readonly label: string;
  readonly value: string;
  readonly testId: string;
}

interface SyncChipView extends AgentSyncChip {
  readonly toneClass: string;
  readonly title: string;
}

const CHIP_TONE: Record<AgentSyncChipState, string> = {
  unknown: 'badge-ghost',
  'not-detected': 'badge-ghost',
  source: 'badge-info',
  unsupported: 'badge-ghost',
  failed: 'badge-error',
  edited: 'badge-warning',
  missing: 'badge-warning',
  'in-sync': 'badge-success',
  'not-synced': 'badge-ghost',
};

const NOT_OWNED_NOTE =
  'This workspace has no source file for this agent. It was kept because it may hold your own changes.';

function chipTitle(chip: AgentSyncChip): string {
  const where = chip.path === null ? '' : ` — ${chip.path}`;
  const why = chip.reason === undefined ? '' : `: ${chip.reason}`;
  return `${chip.target}: ${chip.label}${where}${why}`;
}

const STATUS_TONE: Record<SkillCloneStatus, NativeCardTone> = {
  authored: 'info',
  clone: 'neutral',
  synth: 'secondary',
  diverged: 'warning',
};

const STATUS_DOT: Record<SkillCloneStatus, string> = {
  authored: 'bg-info',
  clone: 'bg-base-content/40',
  synth: 'bg-secondary',
  diverged: 'bg-warning',
};

const STATUS_HINT: Record<SkillCloneStatus, string> = {
  authored: 'Built in this workspace or by you — no upstream source.',
  clone: 'Copied from a plugin; upstream changes can be rebased in.',
  synth: 'Materialised from an accepted recommendation.',
  diverged: 'Upstream changed since this copy was made.',
};

@Component({
  selector: 'ptah-clone-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NativeCardComponent, ScorecardBadgeComponent],
  template: `
    <ptah-native-card
      [tone]="tone()"
      [spine]="true"
      [clickable]="true"
      [disabled]="busy()"
      density="compact"
      [ariaLabel]="'Open details for ' + clone().slug"
      data-testid="clone-card"
      (activated)="opened.emit(clone())"
    >
      <div card-header class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate font-mono text-sm font-medium">
            {{ clone().slug }}
          </p>
          <p class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span
              class="inline-block size-1.5 rounded-full"
              [class]="dotClass()"
              aria-hidden="true"
            ></span>
            <span
              class="text-base-content-muted"
              [title]="statusHint()"
              data-testid="clones-status-badge"
              >{{ statusLabel() }}</span
            >
            <span class="text-base-content/25" aria-hidden="true">·</span>
            <span
              class="tabular-nums"
              [class.text-success]="actions().eligibility === 'ready'"
              [class.text-base-content-muted]="
                actions().eligibility !== 'ready'
              "
              [title]="eligibilityTitle()"
              data-testid="clones-enhance-hint"
              >{{ actions().eligibilityLabel }}</span
            >
          </p>
        </div>

        @if (busy()) {
          <span
            class="loading loading-spinner loading-xs shrink-0"
            role="status"
            aria-label="Working"
            data-testid="clone-card-busy"
          ></span>
        }
      </div>

      @if (metrics().length === 0) {
        <p
          class="text-xs text-base-content-muted"
          data-testid="clone-card-unused"
        >
          Never invoked yet — usage metrics appear after its first recorded run.
        </p>
      } @else {
        <dl
          class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4"
          data-testid="clone-card-metrics"
        >
          @for (m of metrics(); track m.testId) {
            <div class="min-w-0">
              <dt
                class="text-[10px] uppercase tracking-wide text-base-content-muted"
              >
                {{ m.label }}
              </dt>
              <dd class="truncate tabular-nums" [attr.data-testid]="m.testId">
                {{ m.value }}
              </dd>
            </div>
          }
        </dl>
      }

      @if (clone().kind === 'agent') {
        <ptah-scorecard-badge [scorecard]="scorecard()" />
      }

      @if (chipViews().length > 0) {
        <ul
          class="flex flex-wrap gap-1"
          aria-label="Provider copies of this agent"
          data-testid="clone-card-sync-chips"
        >
          @for (chip of chipViews(); track chip.target) {
            <li
              class="badge badge-sm gap-1"
              [class]="chip.toneClass"
              [title]="chip.title"
              [attr.data-state]="chip.state"
              data-testid="clone-card-sync-chip"
            >
              <span class="font-medium">{{ chip.target }}</span>
              {{ chip.label }}
            </li>
          }
        </ul>
        @for (chip of failedChips(); track chip.target) {
          <p
            class="break-all text-[11px] text-error"
            data-testid="clone-card-sync-failed"
          >
            {{ chip.target }}: could not write {{ chip.path }} —
            {{ chip.reason }}
          </p>
        }
      }

      @if (notOwned()) {
        <p
          class="text-[11px] text-base-content-muted"
          data-testid="clone-card-not-owned"
        >
          {{ notOwnedNote }}
        </p>
      }

      @if (actions().upstreamNote; as note) {
        <p
          class="rounded-lg bg-base-300/40 px-2 py-1.5 text-[11px] text-base-content-muted"
          data-testid="clone-card-upstream-note"
        >
          {{ note }}
        </p>
      }

      <div card-footer class="flex flex-wrap items-center gap-1.5 pt-1">
        <button
          type="button"
          class="btn btn-ghost btn-xs transition-colors duration-150"
          data-testid="clones-enhance-btn"
          [disabled]="!actions().enhance.enabled || busy()"
          [title]="actions().enhance.reason ?? enhanceEnabledTitle"
          [attr.aria-disabled]="!actions().enhance.enabled || busy()"
          (click)="enhance.emit(clone())"
        >
          Enhance now
        </button>

        <button
          type="button"
          class="btn btn-ghost btn-xs transition-colors duration-150"
          data-testid="clones-revert-btn"
          [disabled]="!actions().revert.enabled || busy()"
          [title]="actions().revert.reason ?? 'Restore an earlier snapshot.'"
          (click)="revert.emit(clone())"
        >
          Revert
        </button>

        @if (actions().rebase; as rebaseAction) {
          <button
            type="button"
            class="btn btn-ghost btn-xs text-warning transition-colors duration-150"
            data-testid="clones-rebase-btn"
            [disabled]="!rebaseAction.enabled || busy()"
            title="Replace your local copy with the current upstream version."
            (click)="rebase.emit(clone())"
          >
            Rebase to upstream
          </button>
        }

        @if (actions().keep) {
          <button
            type="button"
            class="btn btn-ghost btn-xs text-warning transition-colors duration-150"
            data-testid="clones-keep-btn"
            [disabled]="busy()"
            [title]="keepMineExplanation"
            (click)="keep.emit(clone())"
          >
            Keep mine
          </button>
        }
      </div>
    </ptah-native-card>
  `,
})
export class CloneCardComponent {
  public readonly clone = input.required<CloneSummary>();
  /** Batched agent scorecard; `null` means "no data yet", never zeros. */
  public readonly scorecard = input<AgentScorecard | null>(null);
  /** An action for this entry is in flight. */
  public readonly busy = input<boolean>(false);
  /**
   * One chip per provider copy of this agent (from {@link agentSyncChips}).
   * Empty renders nothing: skills, commands, and the VS Code host pass none.
   */
  public readonly syncChips = input<readonly AgentSyncChip[]>([]);
  /**
   * The seed quarantine kept this agent although the workspace has no source
   * for it (it may hold local work). `false` renders nothing.
   */
  public readonly notOwned = input<boolean>(false);

  public readonly opened = output<CloneSummary>();
  public readonly enhance = output<CloneSummary>();
  public readonly revert = output<CloneSummary>();
  public readonly rebase = output<CloneSummary>();
  public readonly keep = output<CloneSummary>();

  protected readonly keepMineExplanation = KEEP_MINE_EXPLANATION;
  protected readonly enhanceEnabledTitle =
    'Propose an improvement from recorded usage. You review the diff before anything is written.';

  protected readonly notOwnedNote = NOT_OWNED_NOTE;

  protected readonly chipViews = computed<SyncChipView[]>(() =>
    this.syncChips().map((chip) => ({
      ...chip,
      toneClass: CHIP_TONE[chip.state],
      title: chipTitle(chip),
    })),
  );

  /** `failed` chips, whose path and reason are spelled out under the row. */
  protected readonly failedChips = computed<AgentSyncChip[]>(() =>
    this.syncChips().filter((chip) => chip.state === 'failed'),
  );

  protected readonly actions = computed<CloneActionModel>(() =>
    cloneActionModel(this.clone()),
  );

  protected readonly statusLabel = computed<SkillCloneStatus>(() =>
    cloneStatusLabel(this.clone()),
  );

  protected readonly tone = computed<NativeCardTone>(
    () => STATUS_TONE[this.statusLabel()],
  );

  protected readonly dotClass = computed(() => STATUS_DOT[this.statusLabel()]);

  protected readonly statusHint = computed(
    () => STATUS_HINT[this.statusLabel()],
  );

  protected readonly eligibilityTitle = computed(() => {
    const model = this.actions();
    if (model.eligibility === 'ready') {
      return 'Eligible for automatic enhancement on the next Curator pass.';
    }
    return model.enhance.reason ?? '';
  });

  /**
   * Only the metrics that actually carry data. An entry that has never run
   * produces an EMPTY list, which the template renders as one explanatory
   * sentence instead of a row of em dashes.
   */
  protected readonly metrics = computed<CloneMetric[]>(() => {
    const c = this.clone();
    const out: CloneMetric[] = [];

    if (c.invocationCount > 0) {
      out.push({
        label: 'Invocations',
        value: String(c.invocationCount),
        testId: 'clone-metric-invocations',
      });
    }

    const success = formatSuccessRate(c);
    if (success !== null) {
      out.push({
        label: 'Success',
        value: success,
        testId: 'clone-metric-success',
      });
    }

    if (c.lastEnhancedAt !== null) {
      out.push({
        label: 'Last enhanced',
        value: formatRelative(c.lastEnhancedAt),
        testId: 'clone-metric-last-enhanced',
      });
    }

    if (c.historyCount > 0) {
      out.push({
        label: 'History',
        value: `${c.historyCount} snapshot${c.historyCount === 1 ? '' : 's'}`,
        testId: 'clone-metric-history',
      });
    }

    return out;
  });
}
