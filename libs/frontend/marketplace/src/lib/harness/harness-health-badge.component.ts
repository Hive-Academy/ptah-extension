import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  CircleCheck,
  CircleHelp,
  LucideAngularModule,
  RefreshCw,
  TriangleAlert,
} from 'lucide-angular';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { HarnessHealthStore } from './harness-health.store';
import {
  harnessBadgeTone,
  type HarnessBadgeTone,
} from './harness-health.model';
import { HarnessTargetRowComponent } from './harness-target-row.component';

/** Per-tone classes for the badge trigger. Kept as whole strings so Tailwind can see them. */
const TONE_CLASSES: Readonly<Record<HarnessBadgeTone, string>> = {
  success: 'border-success/40 bg-success/10 text-success hover:bg-success/20',
  warning: 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/20',
  error: 'border-error/40 bg-error/10 text-error hover:bg-error/20',
  neutral:
    'border-base-300 bg-base-200/60 text-base-content-muted hover:bg-base-200',
};

/**
 * HarnessHealthBadgeComponent — "is my harness actually on disk?" at a glance,
 * with the per-target detail one click away.
 *
 * Answers the only question the Plugins page could not previously answer:
 * enabling a skill wrote it to the user layer, but whether it reached
 * `.claude/skills`, `.agents/skills`, `.github/skills` and the rest was
 * invisible until an agent failed to read a file that "should" exist
 * (TASK_2026_278, defect 16 — "no verification, no health surface").
 *
 * Severity comes from the backend summary, produced by the ONE shared reducer
 * that also sets `ptah harness doctor`'s exit code. This component picks
 * colours and words; it never decides what healthy means.
 *
 * Complexity Level: 2 — one store, one open/closed flag, derived view models,
 * child row component. No container/presentational split: the only state is
 * `open`.
 */
@Component({
  selector: 'ptah-harness-health-badge',
  standalone: true,
  imports: [
    LucideAngularModule,
    NativePopoverComponent,
    HarnessTargetRowComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-native-popover
      [isOpen]="open()"
      placement="bottom-end"
      [hasBackdrop]="true"
      backdropClass="transparent"
      (closed)="close()"
    >
      <button
        trigger
        type="button"
        data-testid="harness-health-badge"
        class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] font-medium transition-colors"
        [class]="toneClass()"
        [attr.aria-expanded]="open()"
        [attr.aria-label]="'Harness health: ' + summary().label"
        (click)="toggle()"
      >
        @if (store.busy()) {
          <span class="loading loading-spinner loading-xs"></span>
        } @else {
          <lucide-angular
            [img]="toneIcon()"
            class="w-3 h-3"
            aria-hidden="true"
          />
        }
        <span>{{ summary().label }}</span>
      </button>

      <div
        content
        class="w-80 max-h-[26rem] overflow-y-auto p-3 space-y-2"
        role="dialog"
        aria-label="Harness health detail"
      >
        <div class="flex items-start gap-2">
          <div class="flex-1 min-w-0">
            <h3 class="text-xs font-semibold text-base-content">
              Harness targets
            </h3>
            <p
              class="text-[10px] text-base-content-muted mt-0.5 leading-relaxed"
            >
              Where your skills, commands, agents and MCP servers were copied.
              Greyed rows are tools not installed in this workspace.
            </p>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-xs shrink-0"
            data-testid="harness-refresh"
            [disabled]="store.busy()"
            (click)="refresh()"
            aria-label="Re-check harness health"
          >
            <lucide-angular
              [img]="RefreshIcon"
              class="w-3 h-3"
              aria-hidden="true"
            />
          </button>
        </div>

        @if (store.error(); as message) {
          <div class="alert alert-error alert-sm py-1 px-2" role="alert">
            <span class="text-[11px]">{{ message }}</span>
          </div>
        }

        @if (sourcesNote(); as note) {
          <p
            class="text-[11px] text-warning"
            data-testid="harness-sources-note"
            role="status"
          >
            {{ note }}
          </p>
        }

        @if (store.targets().length === 0) {
          <p
            class="text-[11px] text-base-content-muted text-center py-4 rounded-lg border border-dashed border-base-300"
            data-testid="harness-empty"
          >
            @if (store.loading()) {
              Checking your harness…
            } @else {
              No harness pass has run for this workspace yet.
            }
          </p>
        } @else {
          <div class="space-y-1.5">
            @for (target of store.targets(); track target.target) {
              <ptah-harness-target-row [target]="target" />
            }
          </div>
        }

        @if (collisionCount() > 0) {
          <p
            class="text-[11px] text-base-content-muted"
            data-testid="harness-collisions"
          >
            {{ collisionCount() }}
            {{ collisionCount() === 1 ? 'skill is' : 'skills are' }} shadowed by
            another of the same name and will not take effect. Rename one to
            resolve — reconciling cannot.
          </p>
        }

        <div class="flex items-center justify-between gap-2 pt-1">
          <span class="text-[10px] text-base-content-muted">
            {{ generatedLabel() }}
          </span>
          <button
            type="button"
            class="btn btn-primary btn-xs"
            data-testid="harness-reconcile"
            [disabled]="store.busy()"
            (click)="reconcile()"
          >
            @if (store.reconciling()) {
              <span class="loading loading-spinner loading-xs"></span>
              Reconciling…
            } @else {
              Reconcile now
            }
          </button>
        </div>
      </div>
    </ptah-native-popover>
  `,
})
export class HarnessHealthBadgeComponent implements OnInit {
  protected readonly store = inject(HarnessHealthStore);

  protected readonly RefreshIcon = RefreshCw;

  protected readonly open = signal(false);

  protected readonly summary = this.store.summary;

  protected readonly toneClass = computed(
    () => TONE_CLASSES[harnessBadgeTone(this.summary().level)],
  );

  protected readonly toneIcon = computed(() => {
    switch (harnessBadgeTone(this.summary().level)) {
      case 'success':
        return CircleCheck;
      case 'neutral':
        return CircleHelp;
      default:
        return TriangleAlert;
    }
  });

  protected readonly collisionCount = computed(() => this.summary().collisions);

  /**
   * Why the harness is incomplete when the cause is the SOURCES rather than any
   * one target. Without this the panel would show six healthy-looking rows with
   * `0/0` and no explanation (E2 / E3).
   */
  protected readonly sourcesNote = computed<string | null>(() => {
    switch (this.summary().sources) {
      case 'pending-download':
        return 'Skill content is still downloading. Targets fill in once it finishes.';
      case 'sources-missing':
        return 'No skill sources on disk yet. They download on the next online start — nothing is broken.';
      case 'ok':
        return null;
    }
  });

  protected readonly generatedLabel = computed(() => {
    const health = this.store.health();
    if (health === null) {
      return 'Never checked';
    }
    const at = new Date(health.generatedAt);
    return Number.isNaN(at.getTime())
      ? 'Last checked just now'
      : `Checked ${at.toLocaleTimeString()}`;
  });

  /** Load on mount — the badge only mounts on the Plugins page. */
  public ngOnInit(): void {
    void this.store.refresh();
  }

  protected toggle(): void {
    this.open.update((isOpen) => !isOpen);
  }

  protected close(): void {
    this.open.set(false);
  }

  /** Explicit re-check bypasses the backend's cached report. */
  protected refresh(): void {
    void this.store.refresh({ refresh: true });
  }

  protected reconcile(): void {
    void this.store.reconcile();
  }
}
