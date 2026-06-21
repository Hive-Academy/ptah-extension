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
  providerId?: string;
  ptahCliId?: string;
}

export type TribunalTileKind = 'vendor';

export interface TribunalTile {
  tileId: string;
  kind: TribunalTileKind;
  laneId?: string;
  position: TileLayout;
}
