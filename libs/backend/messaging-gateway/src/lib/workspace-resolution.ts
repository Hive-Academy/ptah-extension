/**
 * Effective-workspace resolution for the messaging gateway (TASK_2026_156).
 *
 * Shared by the gateway-chat-bridge turn path and the command control plane
 * (`/sessions`, `/session use`, `/workspace use` no-op detection) so the list,
 * the validation, and the turn always agree (AC-7.2).
 *
 * SEC-2 NOTE — deliberate divergence from
 * `rpc-handlers/utils/workspace-authorization.ts`: that helper accepts
 * SUBPATHS of authorized workspaces; this module matches EXACT roots only.
 * A gateway agent runs yolo-approved, so the allowlist here is the closed set
 * of registered workspace roots (`IWorkspaceProvider.getWorkspaceFolders()`)
 * and nothing else. Do not import the rpc-handlers helper (forbidden edge)
 * and do not loosen the exact-root comparison.
 */
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

/**
 * Canonical form used for every workspace comparison in the gateway:
 * `path.resolve` → forward slashes → lower-case → strip trailing slashes.
 */
export function normalizeWorkspacePath(p: string): string {
  const resolved = path.resolve(p).replace(/\\/g, '/').toLowerCase();
  const stripped = resolved.replace(/\/+$/, '');
  return stripped.length > 0 ? stripped : resolved;
}

/**
 * Closed-set membership: `root` must normalize to EXACTLY one of `folders`.
 * No subpaths, no UNC/tilde/relative acceptance — comparison happens after
 * `path.resolve` on both sides (SEC-2).
 */
export function isAllowlistedWorkspaceRoot(
  root: string,
  folders: string[],
): boolean {
  const normalized = normalizeWorkspacePath(root);
  return folders.some((f) => normalizeWorkspacePath(f) === normalized);
}

/**
 * Short digest of a normalized workspace path — used as the Discord
 * autocomplete choice `value` when the raw path exceeds Discord's 100-char
 * value cap. Matching stays closed-set: validation re-derives the digest of
 * every allowlisted folder and compares, so no raw path can be conjured from
 * a digest (SEC-1).
 */
export function workspaceRootDigest(root: string): string {
  const hex = createHash('sha256')
    .update(normalizeWorkspacePath(root))
    .digest('hex');
  return `#${hex.slice(0, 16)}`;
}

export type EffectiveWorkspace =
  | { ok: true; root: string; source: 'conversation' | 'binding' | 'active' }
  | { ok: false; reason: 'conversation-root-revoked' | 'no-workspace-open' };

/**
 * Conversation-first workspace resolution (AC-7.2, Data-2):
 * - A non-NULL conversation root MUST still be allowlisted, else resolution
 *   FAILS CLOSED (`conversation-root-revoked`) — never a silent fallback to
 *   the binding root.
 * - NULL conversation root → binding root → active workspace →
 *   `no-workspace-open`.
 *
 * On-disk existence is deliberately NOT checked here (kept synchronous and
 * pure); callers that need it (`runTurn`, `/workspace use`) do their own
 * async `fs.access`.
 */
export function resolveEffectiveWorkspaceRoot(args: {
  /** Conversation-pinned root; absent (undefined) in parent channels. */
  conversationRoot: string | null | undefined;
  bindingRoot: string | null;
  workspace: IWorkspaceProvider;
}): EffectiveWorkspace {
  const { conversationRoot, bindingRoot, workspace } = args;

  if (conversationRoot != null && conversationRoot !== '') {
    if (
      !isAllowlistedWorkspaceRoot(
        conversationRoot,
        workspace.getWorkspaceFolders(),
      )
    ) {
      return { ok: false, reason: 'conversation-root-revoked' };
    }
    return { ok: true, root: conversationRoot, source: 'conversation' };
  }

  if (bindingRoot != null && bindingRoot !== '') {
    return { ok: true, root: bindingRoot, source: 'binding' };
  }

  const active = workspace.getWorkspaceRoot();
  if (active !== undefined && active !== '') {
    return { ok: true, root: active, source: 'active' };
  }

  return { ok: false, reason: 'no-workspace-open' };
}
