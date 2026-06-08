export type OriginKind = 'skill' | 'agent' | 'command';

export interface OriginSidecar {
  kind: OriginKind;
  slug: string;
  pluginId: string | null;
  version: string | null;
  sourceHash: string;
  clonedAt: number;
  diverged: boolean;
  lastEnhancedAt: number | null;
  historyDir: string;
  currentContentHash?: string;
  conflictsWith?: string;
}

export const ORIGIN_SIDECAR_FILENAME = '.ptah-origin.json';

export const DEFAULT_HISTORY_DIR = '.history';
