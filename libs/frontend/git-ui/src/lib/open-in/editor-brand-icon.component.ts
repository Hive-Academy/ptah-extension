import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Code2, LucideAngularModule, SquareTerminal } from 'lucide-angular';

/**
 * Small decorative mark for an Open-in target.
 *
 * lucide ships no brand logos, so each editor mark is the vendor's own path
 * data, inlined and bound statically — never `[innerHTML]`. Inlining also
 * keeps the marks inside the JS bundle, which is where the VS Code marketplace
 * scanner tolerates vendor names (root CLAUDE.md); a `.svg` asset per editor
 * would be a non-JS file carrying a trademarked name.
 *
 * Path sources, all redistributable and unmodified except for `fill`:
 *  - VS Code, Cursor, Zed — Simple Icons (CC0 1.0), `simple-icons@latest`
 *    `icons/{visualstudiocode,cursor,zedindustries}.svg`
 *  - Kiro — `kiro.dev/images/logo.svg`, reduced to its rounded plate, the
 *    glyph and its two eyes (the source's luminance mask only clipped to a
 *    box the paths already sit inside)
 *  - Antigravity — `@lobehub/icons-static-svg` (MIT) `icons/antigravity.svg`;
 *    the vendor's own press kit (antigravity.google/press) ships PNG only,
 *    which does not scale to a 12 px control
 *
 * Each mark stays the property of its owner; this is nominative use to name
 * the editor the button opens. The terminal uses lucide's `SquareTerminal`,
 * and an unknown id falls back to a generic code glyph. Always `aria-hidden`:
 * the adjacent label names the target.
 */
@Component({
  selector: 'ptah-editor-brand-icon',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0', 'aria-hidden': 'true' },
  template: `
    @switch (target()) {
      @case ('vscode') {
        <svg
          viewBox="0 0 24 24"
          class="h-3 w-3"
          data-brand="vscode"
          aria-hidden="true"
          focusable="false"
        >
          <path
            fill="#007ACC"
            d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"
          />
        </svg>
      }
      @case ('cursor') {
        <svg
          viewBox="0 0 24 24"
          class="h-3 w-3"
          data-brand="cursor"
          aria-hidden="true"
          focusable="false"
        >
          <path
            fill="currentColor"
            d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23"
          />
        </svg>
      }
      @case ('antigravity') {
        <svg
          viewBox="0 0 24 24"
          class="h-3 w-3"
          data-brand="antigravity"
          aria-hidden="true"
          focusable="false"
        >
          <path
            fill="#4285F4"
            fill-rule="evenodd"
            d="M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z"
          />
        </svg>
      }
      @case ('zed') {
        <svg
          viewBox="0 0 24 24"
          class="h-3 w-3"
          data-brand="zed"
          aria-hidden="true"
          focusable="false"
        >
          <path
            fill="currentColor"
            d="M2.25 1.5a.75.75 0 0 0-.75.75v16.5H0V2.25A2.25 2.25 0 0 1 2.25 0h20.095c1.002 0 1.504 1.212.795 1.92L10.764 14.298h3.486V12.75h1.5v1.922a1.125 1.125 0 0 1-1.125 1.125H9.264l-2.578 2.578h11.689V9h1.5v9.375a1.5 1.5 0 0 1-1.5 1.5H5.185L2.562 22.5H21.75a.75.75 0 0 0 .75-.75V5.25H24v16.5A2.25 2.25 0 0 1 21.75 24H1.655C.653 24 .151 22.788.86 22.08L13.19 9.75H9.75v1.5h-1.5V9.375A1.125 1.125 0 0 1 9.375 8.25h5.314l2.625-2.625H5.625V15h-1.5V5.625a1.5 1.5 0 0 1 1.5-1.5h13.19L21.438 1.5z"
          />
        </svg>
      }
      @case ('kiro') {
        <svg
          viewBox="0 0 1200 1200"
          class="h-3 w-3"
          data-brand="kiro"
          aria-hidden="true"
          focusable="false"
        >
          <rect width="1200" height="1200" rx="260" fill="#9046FF" />
          <path
            fill="#fff"
            d="M398.554 818.914C316.315 1001.03 491.477 1046.74 620.672 940.156C658.687 1059.66 801.052 970.473 852.234 877.795C964.787 673.567 919.318 465.357 907.64 422.374C827.637 129.443 427.623 128.946 358.8 423.865C342.651 475.544 342.402 534.18 333.458 595.051C328.986 625.86 325.507 645.488 313.83 677.785C306.873 696.424 297.68 712.819 282.773 740.645C259.915 783.881 269.604 867.113 387.87 823.883L399.051 818.914H398.554Z"
          />
          <path
            fill="#000"
            d="M636.123 549.353C603.328 549.353 598.359 510.097 598.359 486.742C598.359 465.623 602.086 448.977 609.293 438.293C615.504 428.852 624.697 424.131 636.123 424.131C647.555 424.131 657.492 428.852 664.447 438.541C672.398 449.474 676.623 466.12 676.623 486.742C676.623 525.998 661.471 549.353 636.375 549.353H636.123Z"
          />
          <path
            fill="#000"
            d="M771.24 549.353C738.445 549.353 733.477 510.097 733.477 486.742C733.477 465.623 737.203 448.977 744.41 438.293C750.621 428.852 759.814 424.131 771.24 424.131C782.672 424.131 792.609 428.852 799.564 438.541C807.516 449.474 811.74 466.12 811.74 486.742C811.74 525.998 796.588 549.353 771.492 549.353H771.24Z"
          />
        </svg>
      }
      @case ('terminal') {
        <lucide-angular
          [img]="TerminalIcon"
          class="h-3 w-3"
          data-brand="terminal"
          aria-hidden="true"
        />
      }
      @default {
        <lucide-angular [img]="CodeIcon" class="h-3 w-3" aria-hidden="true" />
      }
    }
  `,
})
export class EditorBrandIconComponent {
  /** An `EditorTargetId`; typed wide so an id from a newer host still renders. */
  readonly target = input.required<string>();
  protected readonly TerminalIcon = SquareTerminal;
  protected readonly CodeIcon = Code2;
}
