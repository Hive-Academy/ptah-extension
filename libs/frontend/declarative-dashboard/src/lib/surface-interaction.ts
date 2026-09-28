import type {
  SurfaceDataValue,
  SurfaceOperationStatus,
  SurfaceRejectReason,
  SurfaceSelection,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';

export interface SurfaceActionUiState {
  readonly status: SurfaceOperationStatus | 'not-found' | 'unsupported';
  readonly reason?: SurfaceRejectReason;
  readonly detail?: string;
}

export interface SurfaceInteractionState {
  readonly selection: SurfaceSelection | null;
  readonly selectionUnsynced: boolean;
  readonly pendingValues: ReadonlyMap<string, SurfaceDataValue>;
  readonly issues: ReadonlyMap<string, readonly string[]>;
  readonly actions: ReadonlyMap<string, SurfaceActionUiState>;
  readonly submitDisabled: boolean;
}

export interface SurfaceInputCommit {
  readonly componentId: string;
  readonly value: SurfaceDataValue;
}

export interface SurfaceActionInvoke {
  readonly actionId: string;
}

export type SurfaceSelectionChange = SurfaceSelection | null;
