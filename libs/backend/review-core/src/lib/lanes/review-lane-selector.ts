import type { Lens } from '@ptah-extension/review-contracts';

export type ReviewLaneKind = 'triage' | Lens | 'verifier';
export type LaneLimitState = 'confirmed-room' | 'unknown' | 'at-limit';

export interface ReviewLaneCapability {
  id: string;
  family: string;
  limitState: LaneLimitState;
}

export interface LaneChoice {
  kind: ReviewLaneKind;
  lane: ReviewLaneCapability;
}

/** Admission order is stable so a run can explain which coverage was unavailable. */
export class ReviewLaneSelector {
  select(
    kinds: readonly ReviewLaneKind[],
    capabilities: readonly ReviewLaneCapability[],
    lensAuthorFamily?: string,
  ): { selected: LaneChoice[]; unavailable: ReviewLaneKind[] } {
    const selected: LaneChoice[] = [];
    const unavailable: ReviewLaneKind[] = [];
    const usedFamilies = new Set<string>();
    for (const kind of kinds.slice(0, 6)) {
      const candidates = capabilities.filter((lane) => lane.limitState !== 'at-limit');
      if (kind === 'verifier' && lensAuthorFamily) candidates.sort((a, b) =>
        Number(a.family === lensAuthorFamily) - Number(b.family === lensAuthorFamily));
      const lane = candidates.find((entry) => !usedFamilies.has(entry.family)) ?? candidates[0];
      if (!lane) { unavailable.push(kind); continue; }
      selected.push({ kind, lane });
      usedFamilies.add(lane.family);
    }
    unavailable.push(...kinds.slice(6));
    return { selected, unavailable };
  }
}
