import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { Check, LucideAngularModule, Minus } from 'lucide-angular';
import type { HarnessTargetHealth } from '@ptah-extension/shared';
import {
  HARNESS_FACET_ORDER,
  harnessFacetLabel,
  harnessTargetLabel,
  harnessTargetNeedsAttention,
} from './harness-health.model';

/**
 * One target's line in the harness health panel. Pure presentation — it takes a
 * {@link HarnessTargetHealth} and emits nothing.
 *
 * The row exists to keep ONE distinction visible, because conflating the two is
 * what made the old sync silent (defect 12 / 16 of the TASK_2026_278 inventory):
 *
 *  - `unsupported` — grey, an em dash. The target genuinely cannot carry that
 *    facet (Codex has no project-command directory). Not actionable, and no
 *    number of reconciles would change it.
 *  - `missing` — red, a count. Ptah should have put files there and they are
 *    not there. Actionable; this is what "Reconcile now" fixes.
 *
 * An undetected target is greyed wholesale: it is not installed in this
 * workspace, so its facets are hypothetical.
 *
 * Complexity Level: 1 — one input, two derived views, no state.
 */
@Component({
  selector: 'ptah-harness-target-row',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="rounded-lg border p-2 space-y-1.5"
      [class]="
        needsAttention()
          ? 'border-warning/40 bg-warning/5'
          : 'border-base-300 bg-base-200/30'
      "
      [attr.data-testid]="'harness-target-' + target().target"
    >
      <div class="flex items-center gap-2">
        <span
          class="text-xs font-medium truncate"
          [class]="
            target().detected ? 'text-base-content' : 'text-base-content-muted'
          "
        >
          {{ label() }}
        </span>

        @if (target().detected) {
          <span class="text-[10px] text-base-content-muted font-mono">
            {{ target().found }}/{{ target().expected }}
          </span>
        } @else {
          <span
            class="px-1.5 py-0.5 rounded-full bg-base-300/60 text-[10px] font-medium text-base-content-muted"
            data-testid="harness-target-absent"
          >
            Not installed
          </span>
        }

        @if (missingCount() > 0) {
          <span
            class="ml-auto text-[10px] font-semibold text-error"
            data-testid="harness-target-missing"
          >
            {{ missingCount() }} missing
          </span>
        }
      </div>

      <!-- Facet chips: capability first, then the gap. -->
      <div class="flex flex-wrap gap-1">
        @for (facet of facets(); track facet.id) {
          <span
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium"
            [class]="facet.chipClass"
            [attr.data-testid]="
              'harness-facet-' + target().target + '-' + facet.id
            "
            [attr.title]="facet.title"
          >
            @if (facet.supported) {
              <lucide-angular
                [img]="CheckIcon"
                class="w-2.5 h-2.5"
                aria-hidden="true"
              />
            } @else {
              <lucide-angular
                [img]="MinusIcon"
                class="w-2.5 h-2.5"
                aria-hidden="true"
              />
            }
            <span>{{ facet.label }}</span>
          </span>
        }
      </div>

      @if (target().writeFailed.length > 0) {
        <ul class="space-y-0.5" data-testid="harness-target-write-failed">
          @for (failure of target().writeFailed; track failure.relPath) {
            <li class="text-[10px] text-error break-all">
              <code class="font-mono">{{ failure.relPath }}</code> —
              {{ failure.reason }}
            </li>
          }
        </ul>
      }

      @if (target().overwrittenLocalEdit.length > 0) {
        <p
          class="text-[10px] text-base-content-muted"
          data-testid="harness-target-overwritten"
        >
          {{ target().overwrittenLocalEdit.length }} local
          {{ target().overwrittenLocalEdit.length === 1 ? 'edit' : 'edits' }}
          replaced from the source. Edit skills in the Ptah user layer so your
          changes survive the next sync.
        </p>
      }
    </div>
  `,
})
export class HarnessTargetRowComponent {
  public readonly target = input.required<HarnessTargetHealth>();

  protected readonly CheckIcon = Check;
  protected readonly MinusIcon = Minus;

  protected readonly label = computed(() =>
    harnessTargetLabel(this.target().target),
  );

  protected readonly needsAttention = computed(() =>
    harnessTargetNeedsAttention(this.target()),
  );

  protected readonly missingCount = computed(
    () => this.target().missing.length,
  );

  /**
   * Chip view models in a fixed facet order.
   *
   * A supported facet on an undetected target is muted rather than green: the
   * capability is real but nothing was written, so claiming a tick would
   * overstate what is on disk.
   */
  protected readonly facets = computed(() => {
    const target = this.target();
    return HARNESS_FACET_ORDER.map((facet) => {
      const supported = target.facets[facet] === 'supported';
      return {
        id: facet,
        label: harnessFacetLabel(facet),
        supported,
        chipClass: chipClassFor(supported, target.detected),
        title: supported
          ? `${harnessTargetLabel(target.target)} carries ${facet}`
          : `${harnessTargetLabel(target.target)} cannot carry ${facet} — nothing to install`,
      };
    });
  });
}

function chipClassFor(supported: boolean, detected: boolean): string {
  if (!supported || !detected) {
    return 'border-base-300 bg-base-300/30 text-base-content-muted';
  }
  return 'border-success/40 bg-success/10 text-success';
}
