/**
 * Permission level type — supports both frontend names and SDK mode names.
 *
 * Hoisted from `SessionLifecycleManager.PERMISSION_MODE_MAP` so that
 * both `SessionQueryExecutor` (initial mode resolution in `executeQuery`) and
 * `SessionControl` (frontend→SDK mapping in `setSessionPermissionLevel`) can
 * import the constant without cross-service coupling.
 */
export const PERMISSION_MODE_MAP: Record<string, string> = {
  ask: 'default',
  'auto-edit': 'acceptEdits',
  yolo: 'bypassPermissions',
  plan: 'plan',
  default: 'default',
  acceptEdits: 'acceptEdits',
  bypassPermissions: 'bypassPermissions',
};

/**
 * Reverse of PERMISSION_MODE_MAP: an SDK mode name (or a frontend level name)
 * → the frontend `PermissionLevel`. Used by `SessionControl` to record the
 * per-session level on a `SessionRecord` from `setSessionPermissionLevel`,
 * which accepts either naming. Unknown inputs fall back to 'ask'.
 */
export const LEVEL_FROM_SDK_MODE: Record<
  string,
  'ask' | 'auto-edit' | 'yolo' | 'plan'
> = {
  default: 'ask',
  acceptEdits: 'auto-edit',
  bypassPermissions: 'yolo',
  plan: 'plan',
  ask: 'ask',
  'auto-edit': 'auto-edit',
  yolo: 'yolo',
};
