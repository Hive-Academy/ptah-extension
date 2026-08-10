import type { PickerWorkspaceScopedParams } from '@ptah-extension/shared';

/**
 * Build the optional workspace-scoping fragment shared by the `@` file picker
 * (`context:getAllFiles`, `context:getFileSuggestions`) and the `/` command
 * picker (`autocomplete:agents`, `autocomplete:commands`) RPC params.
 *
 * There is exactly ONE convention on this wire (TASK_2026_200 Batch 2,
 * {@link PickerWorkspaceScopedParams}):
 *
 * - a non-empty absolute path → send it, and the backend answers for that root
 *   regardless of what the process-global `IWorkspaceProvider` currently reports;
 * - no root to offer → **omit the field entirely**. Absent means "the
 *   process-global active workspace folder", which is the pre-TASK_2026_200
 *   behaviour and the documented fallback.
 *
 * The empty string is NOT "no opinion" and MUST never be sent: the backend Zod
 * schemas reject `''` because it would `path.resolve` to the process CWD — i.e.
 * a silently wrong root, which is the entire defect class this task exists to
 * kill. Whitespace-only values are treated the same way as empty.
 *
 * Spread the result into the params object so the key is genuinely absent
 * rather than present-and-`undefined`:
 *
 * ```ts
 * await rpc.call('context:getAllFiles', {
 *   includeImages: false,
 *   limit: 1000,
 *   ...pickerWorkspaceScope(this.vscodeService.config().workspaceRoot),
 * });
 * ```
 *
 * @param root - Candidate workspace root; `null`/`undefined`/blank all mean "omit".
 * @returns `{ workspaceRoot }` when a usable root was supplied, otherwise `{}`.
 */
export function pickerWorkspaceScope(
  root: string | null | undefined,
): PickerWorkspaceScopedParams {
  if (typeof root !== 'string') {
    return {};
  }
  const trimmed = root.trim();
  return trimmed.length > 0 ? { workspaceRoot: trimmed } : {};
}
