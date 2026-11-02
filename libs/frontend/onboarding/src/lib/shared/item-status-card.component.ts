import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  Bot,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Loader,
  LucideAngularModule,
  Pause,
  RotateCcw,
  type LucideIconData,
} from 'lucide-angular';
import type { ResumableGenerationAgent } from '@ptah-extension/shared';
import { safeFailureCopy } from '@ptah-extension/setup-wizard';

/** C-B2: a `Record` over `ResumableGenerationAgent['status']` so a new member fails typecheck. */
export const ITEM_STATUS_LABELS: Record<
  ResumableGenerationAgent['status'],
  string
> = {
  pending: 'Waiting',
  running: 'Writing',
  written: 'Written',
  kept: 'Kept (your file)',
  unchanged: 'Already current',
  'changed-since-preview': 'Changed since preview (kept)',
  failed: 'Failed',
};

const WRITE_FAILED_FALLBACK = 'The write failed.';

interface StatusPresentation {
  readonly label: string;
  readonly icon: LucideIconData;
  readonly tone: string;
  readonly border: string;
}

const STATUS_PRESENTATION: Record<
  ResumableGenerationAgent['status'],
  StatusPresentation
> = {
  pending: {
    label: ITEM_STATUS_LABELS.pending,
    icon: Clock,
    tone: 'text-base-content-muted',
    border: 'border-base-300',
  },
  running: {
    label: ITEM_STATUS_LABELS.running,
    icon: Loader,
    tone: 'text-state-run',
    border: 'border-state-run/55',
  },
  written: {
    label: ITEM_STATUS_LABELS.written,
    icon: CircleCheck,
    tone: 'text-state-done',
    border: 'border-base-300',
  },
  kept: {
    label: ITEM_STATUS_LABELS.kept,
    icon: CircleCheck,
    tone: 'text-state-done',
    border: 'border-base-300',
  },
  unchanged: {
    label: ITEM_STATUS_LABELS.unchanged,
    icon: CircleDashed,
    tone: 'text-base-content-muted',
    border: 'border-base-300',
  },
  'changed-since-preview': {
    label: ITEM_STATUS_LABELS['changed-since-preview'],
    icon: Pause,
    tone: 'text-state-need',
    border: 'border-base-300',
  },
  failed: {
    label: ITEM_STATUS_LABELS.failed,
    icon: CircleX,
    tone: 'text-state-err',
    border: 'border-state-err/55',
  },
};

/**
 * One per-agent generation card: status glyph + label, file or section line,
 * safe failure copy, optional retry budget, and Retry this agent.
 */
@Component({
  selector: 'ptah-item-status-card',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <article
      class="flex h-full flex-col gap-2 rounded-[10px] border p-3.5"
      data-glass-surface="tile"
      data-testid="item-status-card"
      [class]="presentation().border"
      [attr.data-status]="agent().status"
    >
      <header class="flex items-start justify-between gap-2">
        <h3 class="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          <lucide-angular
            [img]="icons.bot"
            class="size-[1.05rem] shrink-0 text-base-content-muted"
            aria-hidden="true"
          />
          <span class="truncate">{{ agent().agentId }}</span>
        </h3>
        <span
          class="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border border-base-300 px-2.5 py-1 text-xs font-medium"
          data-glass-surface="tile"
          data-testid="item-status-chip"
          [class]="presentation().tone"
        >
          <lucide-angular
            [img]="presentation().icon"
            class="size-3.5 motion-reduce:animate-none"
            [class.animate-spin]="agent().status === 'running'"
            aria-hidden="true"
          />
          {{ presentation().label }}
        </span>
      </header>
      @if (detailLine(); as line) {
        <p
          class="text-xs text-base-content-muted [overflow-wrap:anywhere]"
          [class.font-mono]="!!agent().filePath && agent().status !== 'running'"
          data-testid="item-status-detail"
        >
          {{ line }}
        </p>
      }
      @if (failureCopy(); as copy) {
        <p class="text-sm text-state-err" data-testid="item-status-failure">
          {{ copy }}
        </p>
      }
      @if (showAttempt()) {
        <p class="text-xs text-base-content-muted" data-testid="item-status-attempt">
          Attempt {{ attempt() }} of {{ budget() }}
        </p>
      }
      @if (agent().status === 'failed') {
        <div>
          <button
            type="button"
            class="btn btn-sm min-h-8"
            data-testid="item-status-retry"
            [disabled]="retrying()"
            (click)="retry.emit(agent().agentId)"
          >
            <lucide-angular
              [img]="icons.retry"
              class="size-4"
              aria-hidden="true"
            />
            Retry this agent
          </button>
        </div>
      }
    </article>
  `,
})
export class ItemStatusCardComponent {
  readonly agent = input.required<ResumableGenerationAgent>();
  /** Current attempt index; the attempt line stays hidden unless `budget` is set too. */
  readonly attempt = input<number | null>(null);
  /** Retry budget `b` in "Attempt a of b". Hidden when the backend omits it. */
  readonly budget = input<number | null>(null);
  readonly retrying = input(false);
  readonly retry = output<string>();

  protected readonly icons = { bot: Bot, retry: RotateCcw } as const;

  protected readonly presentation = computed(
    () => STATUS_PRESENTATION[this.agent().status],
  );

  protected readonly showAttempt = computed(
    () => this.attempt() != null && this.budget() != null,
  );

  protected readonly failureCopy = computed(() => {
    const agent = this.agent();
    if (agent.status !== 'failed' || agent.error == null || agent.error === '') {
      return null;
    }
    return safeFailureCopy(agent.error, WRITE_FAILED_FALLBACK);
  });

  protected readonly detailLine = computed(() => {
    const agent = this.agent();
    if (agent.status === 'running') {
      const n = agent.tailoredSections;
      return `Tailoring ${n} ${n === 1 ? 'section' : 'sections'}`;
    }
    if (agent.status === 'pending') {
      return null;
    }
    return agent.filePath ? agent.filePath : null;
  });
}
