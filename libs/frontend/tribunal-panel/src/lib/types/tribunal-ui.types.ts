import type { CliType } from '@ptah-extension/shared';
import type { TileLayout } from '@ptah-extension/canvas';

export type TribunalMove = 'council' | 'forge' | 'race';

export interface VendorLane {
  laneId: string;
  family: string;
  displayName: string;
  cli: CliType;
  model?: string;
  agentId?: string;
}

export type TribunalTileKind = 'vendor' | 'verdict' | 'diff' | 'scorecard';

export interface TribunalTile {
  tileId: string;
  kind: TribunalTileKind;
  laneId?: string;
  position: TileLayout;
}

export interface RaceScoreCriterion {
  label: string;
  value: string;
}

export interface RaceScore {
  vendor: string;
  criteria: readonly RaceScoreCriterion[];
  verifyPassed: boolean | null;
  rank: number | null;
}

export interface ForgeDiff {
  laneId: string;
  summary: string;
  diff: string;
  reviewNotes: string;
}
