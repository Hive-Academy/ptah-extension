import {
  CircleCheck,
  CircleX,
  TriangleAlert,
  type LucideIconData,
} from 'lucide-angular';

/**
 * How one detected CLI's harness sync state is drawn on the Overview.
 *
 * Kept OUT of `harness-health.model.ts` on purpose. That model is in the
 * eager graph (the Dashboard harness card reaches `harnessBlockedPaths`
 * through `@ptah-extension/marketplace/harness`), and esbuild keeps every
 * export of a module that any chunk uses in the chunk the eager side loads.
 * A lazy-only module keeps these words and icons in the Marketplace chunk
 * (R7, Task 17.4).
 */

/**
 * One detected CLI's sync state, row-level like `harnessTargetNeedsAttention`:
 * a failed write is an error, anything else missing or replaced is out of sync.
 */
export type HarnessChipState = 'in-sync' | 'out-of-sync' | 'write-failed';

/** How a chip state is drawn: its word, its tone class and its icon. */
export interface HarnessChipPresentation {
  readonly label: string;
  readonly toneClass: string;
  readonly icon: LucideIconData;
}

/**
 * The harness words. They describe a CLI's sync state, not a server's
 * connection, so they are not `statusPresentation()` words; "out of sync" is
 * the phrase the needs-attention items already use (`data/attention.ts`).
 */
const HARNESS_CHIP_PRESENTATION: Readonly<
  Record<HarnessChipState, HarnessChipPresentation>
> = {
  'in-sync': { label: 'In sync', toneClass: 'text-success', icon: CircleCheck },
  'out-of-sync': {
    label: 'Out of sync',
    toneClass: 'text-warning',
    icon: TriangleAlert,
  },
  'write-failed': {
    label: 'Write failed',
    toneClass: 'text-error',
    icon: CircleX,
  },
};

/** The word, tone and icon of a chip state. */
export function harnessChipPresentation(
  state: HarnessChipState,
): HarnessChipPresentation {
  return HARNESS_CHIP_PRESENTATION[state];
}
