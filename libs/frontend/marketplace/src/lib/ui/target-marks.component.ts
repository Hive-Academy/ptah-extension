import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  BrandMarkComponent,
  CLI_TARGET_BRANDS,
  MonogramTileComponent,
  ProviderMarkComponent,
} from '@ptah-extension/ui';

/**
 * One CLI to draw: the target id and its display name. `ProviderTarget`
 * satisfies it. Typed wider than `McpInstallTarget` on purpose: a target id
 * can reach a row before `CLI_TARGET_BRANDS` knows it (Antigravity once did),
 * and a label lookup can come back empty (`mcpTargetLabel` returns
 * `undefined` for an unmapped key).
 */
export interface TargetMarkItem {
  readonly target: string;
  readonly label?: string | null;
}

/** A target resolved to the component that draws it. */
interface TargetMarkView {
  readonly target: string;
  /** The display name, or the raw target id when there is none. */
  readonly label: string;
  /**
   * `brand`: `ptah-brand-mark` (a monogram when the slug has no artwork).
   * `provider-mark`: `ptah-provider-mark`.
   * `monogram`: a target missing from `CLI_TARGET_BRANDS`, drawn from its id.
   */
  readonly kind: 'brand' | 'provider-mark' | 'monogram';
  /** The brand slug, the provider id, or the raw target id, by `kind`. */
  readonly id: string;
}

/** Marks drawn before the rest collapse into "+N". */
const DEFAULT_MAX_VISIBLE = 4;

/** Own keys only, so `constructor` never resolves to something inherited. */
function isTabledTarget(
  target: string,
): target is keyof typeof CLI_TARGET_BRANDS {
  return Object.hasOwn(CLI_TARGET_BRANDS, target);
}

/** Never throws: a target outside the table becomes a monogram of its id. */
function toView(item: TargetMarkItem): TargetMarkView {
  const target = item.target;
  const label = item.label?.trim() || target;
  if (!isTabledTarget(target)) {
    return { target, label, kind: 'monogram', id: target };
  }
  const brand = CLI_TARGET_BRANDS[target];
  return brand.kind === 'brand'
    ? { target, label, kind: 'brand', id: brand.brandSlug }
    : { target, label, kind: 'provider-mark', id: brand.providerId };
}

/**
 * The CLIs a server reaches, as a row of overlapping marks.
 *
 * `CLI_TARGET_BRANDS` is the allowlist: a `brand` entry renders
 * `ptah-brand-mark` (which draws a monogram for a slug without artwork, as
 * for VS Code), a `provider-mark` entry renders `ptah-provider-mark`. Nothing
 * here branches on a target id.
 *
 * The marks are decorative; a visually hidden list names every target, the
 * collapsed ones included. No theme input: the brand mark picks its dark
 * variant in CSS.
 *
 * @example
 * ```html
 * <ptah-target-marks [targets]="row.targets" />
 * ```
 */
@Component({
  selector: 'ptah-target-marks',
  standalone: true,
  imports: [BrandMarkComponent, MonogramTileComponent, ProviderMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center' },
  template: `
    @if (views().length === 0) {
      <span class="text-xs text-base-content-muted" aria-hidden="true">—</span>
      <span class="sr-only" data-testid="target-marks-empty">
        No CLI targets
      </span>
    } @else {
      <span
        class="flex items-center -space-x-1.5"
        aria-hidden="true"
        data-testid="target-marks"
      >
        @for (mark of visible(); track mark.target) {
          <span
            class="inline-flex rounded-md ring-2 ring-base-100"
            [attr.data-target]="mark.target"
            [attr.title]="mark.label"
          >
            @switch (mark.kind) {
              @case ('brand') {
                <ptah-brand-mark
                  [brandSlug]="mark.id"
                  [label]="mark.label"
                  size="sm"
                />
              }
              @case ('provider-mark') {
                <!-- h-6 w-6 matches MarkTileSize 'sm'; MARK_TILE_BOX_CLASS is not exported by @ptah-extension/ui. -->
                <span
                  class="flex h-6 w-6 items-center justify-center overflow-hidden rounded-md border border-base-300 bg-base-200"
                >
                  <!-- ptah-provider-mark has a fixed 32px box and no size input; 0.625 scales it to the 20px tile art (follow-up: size input in ui). -->
                  <ptah-provider-mark
                    class="block shrink-0 scale-[0.625]"
                    [providerId]="mark.id"
                    fallback="Terminal"
                  />
                </span>
              }
              @default {
                <ptah-monogram-tile [label]="mark.id" size="sm" />
              }
            }
          </span>
        }
        @if (overflow() > 0) {
          <span
            class="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-base-300 bg-base-200 px-1 text-[10px] font-medium tabular-nums text-base-content-muted ring-2 ring-base-100"
            data-testid="target-marks-overflow"
            >+{{ overflow() }}</span
          >
        }
      </span>
      <ul class="sr-only" aria-label="CLI targets" data-testid="target-labels">
        @for (mark of views(); track mark.target) {
          <li>{{ mark.label }}</li>
        }
      </ul>
    }
  `,
})
export class TargetMarksComponent {
  /** The targets, in display order (`ProviderRow.targets`). */
  public readonly targets = input.required<readonly TargetMarkItem[]>();

  /**
   * Marks drawn before the rest collapse into "+N"; at least 1, `Infinity`
   * draws them all. @default 4
   */
  public readonly maxVisible = input<number>(DEFAULT_MAX_VISIBLE);

  protected readonly views = computed(() => this.targets().map(toView));

  private readonly visibleCount = computed(() => {
    const max = this.maxVisible();
    return Number.isNaN(max)
      ? DEFAULT_MAX_VISIBLE
      : Math.max(1, Math.floor(max));
  });

  protected readonly visible = computed(() =>
    this.views().slice(0, this.visibleCount()),
  );

  protected readonly overflow = computed(() =>
    Math.max(0, this.views().length - this.visibleCount()),
  );
}
