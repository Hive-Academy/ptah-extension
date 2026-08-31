/**
 * McpCallerWorkspaceResolver — the `ICallerWorkspaceResolver` implementation
 * (TASK_2026_364 Batch C).
 *
 * Bridges the request-scoped MCP context (`mcp-request-context.ts`, filled by
 * the HTTP handler from the `/workspace/{root}` and `/session/{id}` URL
 * segments) to consumers that must not import this lib — today
 * `cli-agent-runtime`'s `AgentProcessManager`, which injects the
 * `PLATFORM_TOKENS.CALLER_WORKSPACE_RESOLVER` port instead.
 *
 * Registered by the VS Code and Electron composition roots only. The CLI host
 * never registers it, so its consumers keep the platform-provider fallback.
 */
import { inject, injectable } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  isPathWithinRoots,
} from '@ptah-extension/platform-core';
import type {
  ICallerWorkspaceResolver,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  getCallerSessionId,
  getCallerWorkspaceRoot,
} from './mcp-core/mcp-request-context';

/**
 * Duplicated from SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER to avoid a circular
 * dependency between vscode-lm-tools -> agent-sdk. Must match the string in:
 * libs/backend/agent-sdk/src/lib/di/tokens.ts
 *
 * @see SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER in libs/backend/agent-sdk/src/lib/di/tokens.ts
 * @warning Keep Symbol.for() string value in sync with the canonical definition
 */
const SDK_SESSION_LIFECYCLE_MANAGER = Symbol.for('SdkSessionLifecycleManager');

/** The one lifecycle-manager read this resolver needs (structural, like `SdkSessionLifecycleManagerLike`). */
interface SessionWorkspaceReaderLike {
  getSessionWorkspace(idOrTabId: string): string | undefined;
}

@injectable()
export class McpCallerWorkspaceResolver implements ICallerWorkspaceResolver {
  constructor(
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(SDK_SESSION_LIFECYCLE_MANAGER, { isOptional: true })
    private readonly sessionManager: SessionWorkspaceReaderLike | undefined,
  ) {}

  /**
   * Declared workspace first (the external caller's only identity), then the
   * caller session's workspace. Both are request-scoped, so outside an MCP
   * tool call this returns `undefined` and consumers keep today's behaviour.
   *
   * A declared workspace that is not open — not equal to and not inside any
   * open folder — is REFUSED by name. Answering with another workspace's root
   * instead is the silent misattribution this port exists to close. The
   * containment check (not equality) is deliberate: a spawned agent declares
   * the working directory it runs in, which for a worktree lies INSIDE the
   * open folder rather than being one.
   */
  resolveCallerWorkspaceRoot(): string | undefined {
    const declared = getCallerWorkspaceRoot();
    if (declared) {
      const openFolders = this.workspaceProvider.getWorkspaceFolders();
      if (!isPathWithinRoots(declared, openFolders)) {
        const openList =
          openFolders.length > 0
            ? `open folders: ${openFolders.join(', ')}`
            : 'no folder is open';
        throw new Error(
          `The caller declared workspace '${declared}', but that folder is not open in this window (${openList}). ` +
            `The scoped MCP URL may be stale — re-read the 'ptah' entry in .mcp.json.`,
        );
      }
      return declared;
    }
    const callerSessionId = getCallerSessionId();
    if (callerSessionId) {
      const sessionWorkspace =
        this.sessionManager?.getSessionWorkspace(callerSessionId);
      if (sessionWorkspace) {
        return sessionWorkspace;
      }
    }
    return undefined;
  }
}
