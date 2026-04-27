/**
 * Permission level type — supports both frontend names and SDK mode names.
 *
 * Hoisted from `SessionLifecycleManager.PERMISSION_MODE_MAP` (Wave C7i) so that
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
