import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { CliAdapterManifest } from '@ptah-extension/shared';
import { Check, CircleHelp, LucideAngularModule, Minus } from 'lucide-angular';
import { cliCapabilityView } from './cli-capability-view';

@Component({
  selector: 'ptah-cli-capability-detail',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The expanded row spans every matrix column, so it is wider than the
  // visible scroll area. Keep it inside the visible part of the matrix
  // (`cqw` = the matrix host container) and pinned to its left edge.
  styles: `:host { display: block; position: sticky; left: 1rem; max-width: calc(100cqw - 4.75rem); }`,
  template: `<div class="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(14rem,100%),1fr))] gap-4 text-xs text-base-content" data-testid="cli-capability-detail">
    @for (group of view().groups; track group.heading) {
      <section class="min-w-0" [attr.aria-label]="group.heading">
        <h4 class="mb-2 font-semibold uppercase tracking-wide text-base-content-muted">{{ group.heading }}</h4>
        <dl class="grid gap-2">
          @for (line of group.lines; track line.label) {
            <div class="min-w-0">
              <dt class="flex items-center gap-1.5 font-medium">
                <lucide-angular [img]="line.state === 'supported' ? CheckIcon : line.state === 'unsupported' ? MinusIcon : HelpIcon"
                  class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {{ line.label }}
              </dt>
              <dd class="ml-5 text-base-content">{{ line.value }}
                @if (line.reason) { <span class="mt-0.5 block break-words text-base-content-muted">{{ line.reason }}</span> }
              </dd>
            </div>
          }
        </dl>
      </section>
    }
  </div>`,
})
export class CliCapabilityDetailComponent {
  protected readonly CheckIcon = Check;
  protected readonly MinusIcon = Minus;
  protected readonly HelpIcon = CircleHelp;
  readonly manifest = input<CliAdapterManifest>();
  protected readonly view = computed(() => cliCapabilityView(this.manifest()));
}
