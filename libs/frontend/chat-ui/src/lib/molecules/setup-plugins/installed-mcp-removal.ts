import type { ClaudeRpcService } from '@ptah-extension/core';
import {
  mcpTargetLabel,
  type InstalledServerGroup,
} from './installed-mcp-groups';

/**
 * Perform the removal for one group.
 *
 * Returns a user-facing message when the removal did NOT fully succeed, and
 * `null` only when it did. A refusal reaches the caller as a string rather
 * than as a silently ignored non-success result — that silence was the
 * reported bug.
 *
 * `rpc` is a PARAMETER, never injected: `setup-plugins/` is a grandfathered
 * exception to chat-ui's no-injected-state rule and must not be widened. The
 * caller — the Installed tab, or the marketplace Connected view — owns the
 * service and hands it in.
 *
 * A `removal: 'none'` group returns `null` without calling anything. Arming
 * the `direct` confirm step stays with the caller: that is a UI rule, not a
 * removal rule.
 */
export async function removeInstalledGroup(
  rpc: ClaudeRpcService,
  group: InstalledServerGroup,
): Promise<string | null> {
  switch (group.removal) {
    case 'smithery': {
      const result = await rpc.call('mcpDirectory:uninstallSmithery', {
        serverKey: group.serverKey,
      });
      if (!result.isSuccess()) {
        return (
          result.error ?? `Smithery could not remove "${group.serverKey}".`
        );
      }
      return result.data.success
        ? null
        : (result.data.error ??
            `Smithery refused to remove "${group.serverKey}".`);
    }

    case 'oauth': {
      const result = await rpc.call('mcpDirectory:disconnectOAuth', {
        serverKey: group.serverKey,
      });
      if (!result.isSuccess()) {
        return result.error ?? `Could not disconnect "${group.serverKey}".`;
      }
      return result.data.success
        ? null
        : (result.data.error ??
            `Disconnecting "${group.serverKey}" was refused.`);
    }

    case 'ptah-managed':
    case 'direct':
      return removeManaged(rpc, group);

    default:
      return null;
  }
}

async function removeManaged(
  rpc: ClaudeRpcService,
  group: InstalledServerGroup,
): Promise<string | null> {
  const result = await rpc.call('mcpDirectory:uninstall', {
    serverKey: group.serverKey,
    targets: group.targets,
    ...(group.removal === 'direct' ? { force: true } : {}),
  });
  if (!result.isSuccess()) {
    return result.error ?? `Could not remove "${group.serverKey}".`;
  }
  const failures = result.data.results.filter((r) => !r.success);
  if (failures.length > 0) {
    return `Could not remove "${group.serverKey}" from: ${failures
      .map(
        (r) =>
          `${mcpTargetLabel(r.target)} (${r.error ?? 'unknown error'})`,
      )
      .join(', ')}`;
  }
  // A backend that reports zero results removed nothing. Saying so beats
  // reloading an identical list and letting the user guess.
  if (result.data.results.length === 0) {
    return `Nothing was removed for "${group.serverKey}".`;
  }
  return null;
}
