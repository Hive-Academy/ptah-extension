/**
 * Permission level type — supports both frontend names and SDK mode names.
 *
 * Hoisted from `SessionLifecycleManager.PERMISSION_MODE_MAP` so that
 * both `SessionQueryExecutor` (initial mode resolution in `executeQuery`) and
 * `SessionControl` (frontend→SDK mapping in `setSessionPermissionLevel`) can
 * import the constant without cross-service coupling.
 *
 * NOTE: `yolo` (and the `bypassPermissions` SDK alias) map to `'default'`, NOT
 * the SDK's `'bypassPermissions'` mode. The SDK does not invoke the
 * `canUseTool` callback at all under `bypassPermissions`, which is the ONLY
 * place `AskUserQuestion` and `ExitPlanMode` are intercepted and routed to the
 * UI (see `SdkPermissionHandler.createCallback`). Keeping the SDK in `'default'`
 * ensures the callback always runs; the callback itself auto-approves every
 * tool when the per-session level is `yolo`. The per-session level is recorded
 * from `LEVEL_FROM_SDK_MODE` below (which still resolves `yolo`/`bypassPermissions`
 * → `yolo`), so YOLO still skips all permission prompts while interactive tools
 * keep working. This map drives ONLY the interactive chat path; the headless
 * one-shot path (`InternalQueryService`) sets `bypassPermissions` directly
 * because it has no UI and no `canUseTool` callback.
 */
export const PERMISSION_MODE_MAP: Record<string, string> = {
  ask: 'default',
  'auto-edit': 'acceptEdits',
  yolo: 'default',
  plan: 'plan',
  default: 'default',
  acceptEdits: 'acceptEdits',
  bypassPermissions: 'default',
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
