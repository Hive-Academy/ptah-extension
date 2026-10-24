import type {
  CodexApprovalDecision,
  CodexThreadIdentity,
} from './codex-runtime.types';

export type CodexPermissionRuleScope = Pick<
  CodexThreadIdentity,
  'providerId' | 'normalizedHome' | 'workspaceId' | 'threadId'
>;

/**
 * Explicit targets supplied by the bridge after protocol validation. Never infer an
 * MCP tool from elicitation prose or treat an arbitrary elicitation as tool approval.
 * Unknown/unattributed actions must not call matches with a fabricated target.
 */
export type CodexPermissionRuleTarget =
  | { readonly kind: 'command'; readonly command: string; readonly cwd: string }
  | { readonly kind: 'fileChange'; readonly paths: readonly string[] }
  | {
      readonly kind: 'mcpElicitation';
      readonly server: string;
      readonly tool: string;
    };

function scopeKey(scope: CodexPermissionRuleScope): string | undefined {
  const parts = [
    scope.providerId,
    scope.normalizedHome,
    scope.workspaceId,
    scope.threadId,
  ];
  return parts.every((part) => part.trim().length > 0)
    ? JSON.stringify(parts)
    : undefined;
}

function targetKey(target: CodexPermissionRuleTarget): string | undefined {
  let parts: readonly string[];
  switch (target.kind) {
    case 'command':
      // Exact command + cwd only: prefix parsing/shell semantics are unproved.
      parts = [target.kind, target.command, target.cwd];
      break;
    case 'fileChange':
      if (target.paths.length === 0) return undefined;
      // Exact path set, no glob, parent-directory, case-folding or prefix expansion.
      parts = [target.kind, ...new Set(target.paths.slice().sort())];
      break;
    case 'mcpElicitation':
      parts = [target.kind, target.server, target.tool];
      break;
  }
  return parts.every((part) => part.trim().length > 0)
    ? JSON.stringify(parts)
    : undefined;
}

/**
 * Runtime-owned, in-memory grants. Keep this instance across child restarts and
 * dispose it with the host runtime. No process generation or turn id is retained:
 * the approval bridge, not this store, rejects stale replies and pending requests.
 * Scope correctness remains an unproved native parity gate.
 */
export class CodexPermissionRuleStore {
  private readonly rules = new Map<string, Set<string>>();
  private disposed = false;

  /** Call only for a live, validated acceptForSession reply. Other decisions never grant. */
  record(
    scope: CodexPermissionRuleScope,
    target: CodexPermissionRuleTarget,
    decision: CodexApprovalDecision,
  ): boolean {
    if (this.disposed || decision !== 'acceptForSession') return false;
    const scopeId = scopeKey(scope);
    const targetId = targetKey(target);
    if (scopeId === undefined || targetId === undefined) return false;
    const targets = this.rules.get(scopeId) ?? new Set<string>();
    targets.add(targetId);
    this.rules.set(scopeId, targets);
    return true;
  }

  matches(
    scope: CodexPermissionRuleScope,
    target: CodexPermissionRuleTarget,
  ): boolean {
    if (this.disposed) return false;
    const scopeId = scopeKey(scope);
    const targetId = targetKey(target);
    return (
      scopeId !== undefined &&
      targetId !== undefined &&
      this.rules.get(scopeId)?.has(targetId) === true
    );
  }

  clear(scope: CodexPermissionRuleScope): void {
    const scopeId = scopeKey(scope);
    if (scopeId !== undefined) this.rules.delete(scopeId);
  }

  dispose(): void {
    this.rules.clear();
    this.disposed = true;
  }
}
