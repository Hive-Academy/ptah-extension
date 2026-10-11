/**
 * Section-level provenance of the expanded stats card: what every plan row or
 * every lane row would repeat is lifted into its section header once, and the
 * rows then omit it. Rows that differ keep their own caption or source chips.
 */
import type {
  LaneSubtotalTileModel,
  LaneUsageTileModel,
  PlanLimitTileModel,
} from './stats-limit-view-model.types';

export type PlanCaption = Pick<
  PlanLimitTileModel,
  'caption' | 'captionLead' | 'captionTail'
>;

export interface PlanSectionProvenance {
  /** The caption every plan row carries; `null` when they differ. */
  readonly caption: PlanCaption | null;
  /**
   * Source chips shown in the header; a row whose own list equals this one
   * omits its chips. Empty when no list is shared.
   */
  readonly sourceChips: readonly string[];
}

/** Two source-chip lists name the same sources in the same order. */
export function sameSources(
  a: readonly string[],
  b: readonly string[],
): boolean {
  return a.length === b.length && a.every((source, i) => source === b[i]);
}

/**
 * The caption is lifted when every row carries the same one. The source
 * chips lifted are the list most rows carry, when at least two rows carry it
 * (or the section has a single row), so a lone row never speaks for the rest.
 */
export function planSectionProvenance(
  tiles: readonly PlanLimitTileModel[],
): PlanSectionProvenance {
  if (tiles.length === 0) return { caption: null, sourceChips: [] };
  const first = tiles[0];
  const caption = tiles.every((tile) => tile.caption === first.caption)
    ? {
        caption: first.caption,
        captionLead: first.captionLead,
        ...(first.captionTail && { captionTail: first.captionTail }),
      }
    : null;
  return { caption, sourceChips: mostSharedSources(tiles) };
}

function mostSharedSources(
  tiles: readonly PlanLimitTileModel[],
): readonly string[] {
  let best: readonly string[] = [];
  let bestCount = 0;
  for (const tile of tiles) {
    if (tile.sourceChips.length === 0) continue;
    const count = tiles.filter((other) =>
      sameSources(other.sourceChips, tile.sourceChips),
    ).length;
    if (count > bestCount) {
      best = tile.sourceChips;
      bestCount = count;
    }
  }
  return bestCount >= 2 || tiles.length === 1 ? best : [];
}

/** The caption every lane row and the subtotal share; `null` when they differ. */
export function sharedLaneCaption(
  lanes: readonly LaneUsageTileModel[],
  subtotal: LaneSubtotalTileModel | undefined,
): string | null {
  const captions = [
    ...lanes.map((lane) => lane.caption),
    ...(subtotal ? [subtotal.caption] : []),
  ];
  if (captions.length === 0) return null;
  return captions.every((caption) => caption === captions[0])
    ? captions[0]
    : null;
}
