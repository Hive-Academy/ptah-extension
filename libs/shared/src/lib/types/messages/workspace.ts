import type { WorkspaceInfo } from '../common.types';

/**
 * Re-export the existing WorkspaceInfo shape from common.types so the
 * messages barrel exports a single canonical WorkspaceInfo.
 *
 * (The existing definition in common.types.ts:16 uses `type: string`
 * rather than `'workspace' | 'folder'` — the looser shape is preserved
 * to avoid a breaking change.)
 */
export type { WorkspaceInfo };

/**
 * Payload for MESSAGE_TYPES.WORKSPACE_CHANGED ('workspaceChanged').
 *
 * Emitted by the backend whenever the active workspace folder changes.
 * The `origin` field enables frontend self-echo suppression: if the
 * receiving service stamped this origin on the RPC call that triggered
 * the change, it may drop the event.
 *
 * Convention:
 *   origin === null   → external change; receiver MUST apply
 *   origin === string → user-initiated; receiver SHOULD drop if it owns the token
 */
export interface WorkspaceChangedPayload {
  workspaceInfo: WorkspaceInfo | null;
  origin: string | null;
}
