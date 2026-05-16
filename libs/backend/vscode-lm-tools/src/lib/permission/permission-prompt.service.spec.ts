/**
 * permission-prompt.service — unit specs.
 *
 * `PermissionPromptService` sits between the `approval_prompt` MCP handler and
 * the VS Code webview. It:
 *   1. Creates permission requests with UUIDs and human-readable descriptions.
 *   2. Stores Promise resolvers while the user decides (blocks indefinitely).
 *   3. Resolves pending requests when the webview responds, optionally
 *      persisting "Always Allow" rules to workspace state.
 *   4. Pre-authorises tool calls by matching `ToolName:JSON(input)` against
 *      persisted `PermissionRule` entries via `minimatch`.
 *
 * The tests exercise all four surfaces plus concurrent-prompt ordering and
 * allow/deny/always_allow semantics.
 *
 * `@ptah-extension/vscode-core` pulls `vscode` transitively — stub the tiny
 * surface we touch (only `TOKENS`) so the jest node env doesn't explode.
 */

import 'reflect-metadata';

jest.mock('@ptah-extension/vscode-core', () => ({
  TOKENS: { LOGGER: Symbol.for('Logger') },
}));

jest.mock('@ptah-extension/platform-core', () => ({
  PLATFORM_TOKENS: {
    WORKSPACE_STATE_STORAGE: Symbol.for('PlatformWorkspaceStateStorage'),
  },
}));

import type {
  PermissionRequest,
  PermissionResponse,
  PermissionRule,
} from '@ptah-extension/shared';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { createMockStateStorage } from '@ptah-extension/platform-core/testing';
import { PermissionPromptService } from './permission-prompt.service';
import type { ApprovalPromptParams } from '../code-execution/types';

interface MockLogger {
  info: jest.Mock;
  debug: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

function createLogger(): MockLogger {
  return {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function createParams(
  overrides: Partial<ApprovalPromptParams> = {},
): ApprovalPromptParams {
  return {
    tool_name: 'Bash',
    input: { command: 'ls -la' },
    tool_use_id: 'tool-use-abc',
    ...overrides,
  };
}

describe('PermissionPromptService', () => {
  let logger: MockLogger;
  let workspaceState: ReturnType<typeof createMockStateStorage>;
  let svc: PermissionPromptService;

  beforeEach(() => {
    logger = createLogger();
    workspaceState = createMockStateStorage();
    svc = new PermissionPromptService(
      logger as unknown as ConstructorParameters<
        typeof PermissionPromptService
      >[0],
      workspaceState as IStateStorage,
    );
  });

  // ========================================
  // createRequest
  // ========================================

  describe('createRequest', () => {
    it('produces a request with UUID id, tool metadata, and timeoutAt=0', () => {
      const beforeNow = Date.now();
      const req = svc.createRequest(createParams());
      const afterNow = Date.now();

      expect(req.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(req.toolName).toBe('Bash');
      expect(req.toolInput).toEqual({ command: 'ls -la' });
      expect(req.toolUseId).toBe('tool-use-abc');
      expect(req.timeoutAt).toBe(0);
      expect(req.timestamp).toBeGreaterThanOrEqual(beforeNow);
      expect(req.timestamp).toBeLessThanOrEqual(afterNow);
    });

    it('assigns unique ids across calls', () => {
      const a = svc.createRequest(createParams());
      const b = svc.createRequest(createParams());
      expect(a.id).not.toBe(b.id);
    });

    it('builds descriptive strings per tool kind (Bash/Write/Read/Edit/Glob/Grep)', () => {
      const cases: Array<[ApprovalPromptParams, string]> = [
        [
          createParams({ tool_name: 'Bash', input: { command: 'npm test' } }),
          'Execute bash command: npm test',
        ],
        [
          createParams({
            tool_name: 'Write',
            input: { file_path: '/a.ts', content: 'x' },
          }),
          'Write file: /a.ts',
        ],
        [
          createParams({ tool_name: 'Read', input: { file_path: '/b.ts' } }),
          'Read file: /b.ts',
        ],
        [
          createParams({
            tool_name: 'Edit',
            input: { file_path: '/c.ts', old_string: 'a', new_string: 'b' },
          }),
          'Edit file: /c.ts',
        ],
        [
          createParams({ tool_name: 'Glob', input: { pattern: '**/*.ts' } }),
          'Search files: **/*.ts',
        ],
        [
          createParams({ tool_name: 'Grep', input: { pattern: 'TODO' } }),
          'Search content: TODO',
        ],
      ];
      for (const [params, expected] of cases) {
        expect(svc.createRequest(params).description).toBe(expected);
      }
    });

    it('falls back to an "unknown" description when a known tool has malformed input', () => {
      const req = svc.createRequest(
        createParams({ tool_name: 'Bash', input: { notCommand: 'oops' } }),
      );
      expect(req.description).toBe('Execute bash command: unknown');
    });

    it('builds a generic description for unknown tools', () => {
      const req = svc.createRequest(
        createParams({ tool_name: 'CustomTool', input: { a: 1, b: 2, c: 3 } }),
      );
      expect(req.description).toBe('Execute CustomTool with 3 parameters');
    });
  });

  // ========================================
  // setPendingResolver / resolveRequest / removePendingResolver
  // ========================================

  describe('pending resolver lifecycle', () => {
    function makeRequest(id = 'req-1', toolName = 'Bash'): PermissionRequest {
      return {
        id,
        toolName,
        toolInput: { command: 'ls' },
        timestamp: 1_700_000_000_000,
        description: 'desc',
        timeoutAt: 0,
      };
    }

    it('resolves pending request with allow decision', async () => {
      const req = makeRequest();
      const resolved = new Promise<PermissionResponse>((resolve) => {
        svc.setPendingResolver(req.id, resolve, req);
      });

      const found = svc.resolveRequest({ id: req.id, decision: 'allow' });
      const response = await resolved;

      expect(found).toBe(true);
      expect(response.decision).toBe('allow');
    });

    it('resolves deny decision without creating a rule', async () => {
      const req = makeRequest();
      const resolved = new Promise<PermissionResponse>((resolve) => {
        svc.setPendingResolver(req.id, resolve, req);
      });

      svc.resolveRequest({ id: req.id, decision: 'deny', reason: 'nope' });
      const response = await resolved;

      expect(response.decision).toBe('deny');
      expect(response.reason).toBe('nope');
      expect(svc.getRules()).toHaveLength(0);
    });

    it('creates an "allow" rule when decision=always_allow', async () => {
      const req = makeRequest('req-42', 'Bash');
      const resolved = new Promise<PermissionResponse>((resolve) => {
        svc.setPendingResolver(req.id, resolve, req);
      });

      svc.resolveRequest({ id: req.id, decision: 'always_allow' });
      await resolved;

      const rules = svc.getRules();
      expect(rules).toHaveLength(1);
      expect(rules[0]).toMatchObject({
        toolName: 'Bash',
        pattern: 'Bash:*',
        action: 'allow',
      });
      expect(rules[0].id).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('returns false when resolving an unknown request id', () => {
      expect(svc.resolveRequest({ id: 'missing', decision: 'allow' })).toBe(
        false,
      );
      expect(logger.warn).toHaveBeenCalledWith(
        'No pending request found for response',
        expect.objectContaining({ id: 'missing' }),
      );
    });

    it('resolves concurrent requests independently and in caller order', async () => {
      const reqA = makeRequest('req-a', 'Bash');
      const reqB = makeRequest('req-b', 'Write');
      const reqC = makeRequest('req-c', 'Read');

      const promises = [reqA, reqB, reqC].map(
        (r) =>
          new Promise<PermissionResponse>((resolve) => {
            svc.setPendingResolver(r.id, resolve, r);
          }),
      );

      // Resolve in a non-sequential order — each promise should still pair
      // with its own id.
      svc.resolveRequest({ id: 'req-b', decision: 'deny' });
      svc.resolveRequest({ id: 'req-c', decision: 'allow' });
      svc.resolveRequest({ id: 'req-a', decision: 'always_allow' });

      const responses = await Promise.all(promises);
      expect(responses.map((r) => r.decision)).toEqual([
        'always_allow',
        'deny',
        'allow',
      ]);
    });

    it('removePendingResolver drops the entry without resolving its promise', async () => {
      const req = makeRequest();
      let resolvedWith: PermissionResponse | undefined;
      svc.setPendingResolver(
        req.id,
        (r) => {
          resolvedWith = r;
        },
        req,
      );

      expect(svc.removePendingResolver(req.id)).toBe(true);
      // A subsequent resolve should be a no-op (returns false, never fires
      // the stored resolver).
      expect(svc.resolveRequest({ id: req.id, decision: 'allow' })).toBe(false);
      expect(resolvedWith).toBeUndefined();
    });

    it('removePendingResolver returns false when nothing is pending', () => {
      expect(svc.removePendingResolver('ghost')).toBe(false);
    });

    it('does not time out — setPendingResolver never schedules a timer', () => {
      const req = makeRequest();
      const spy = jest.spyOn(global, 'setTimeout');
      try {
        svc.setPendingResolver(req.id, () => undefined, req);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  });

  // ========================================
  // Rules — addRule / getRules / deleteRule / clearRules
  // ========================================

  describe('rules', () => {
    it('addRule persists a complete PermissionRule and returns it', () => {
      const rule = svc.addRule({
        pattern: 'Bash:git*',
        toolName: 'Bash',
        action: 'allow',
        description: 'git operations',
      });

      expect(rule.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(rule.createdAt).toBeGreaterThan(0);
      expect(workspaceState.update).toHaveBeenCalledWith(
        'ptah.permission.rules',
        expect.arrayContaining([expect.objectContaining({ id: rule.id })]),
      );
    });

    it('getRules returns [] when workspace state is empty', () => {
      expect(svc.getRules()).toEqual([]);
    });

    it('deleteRule removes a rule by id and returns true', () => {
      const a = svc.addRule({
        pattern: 'Bash:*',
        toolName: 'Bash',
        action: 'allow',
      });
      const b = svc.addRule({
        pattern: 'Write:*',
        toolName: 'Write',
        action: 'deny',
      });

      expect(svc.deleteRule(a.id)).toBe(true);
      const remaining = svc.getRules();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(b.id);
    });

    it('deleteRule returns false for unknown ids', () => {
      expect(svc.deleteRule('nope')).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        'Rule not found for deletion',
        expect.objectContaining({ ruleId: 'nope' }),
      );
    });

    it('clearRules empties storage', () => {
      svc.addRule({ pattern: 'Bash:*', toolName: 'Bash', action: 'allow' });
      svc.clearRules();
      expect(svc.getRules()).toEqual([]);
    });
  });

  // ========================================
  // checkRules — pre-authorisation
  // ========================================

  describe('checkRules', () => {
    function seed(rules: PermissionRule[]): void {
      workspaceState.__state.seed('ptah.permission.rules', rules);
    }

    it('returns "ask" when no rules exist', () => {
      expect(svc.checkRules('Bash', { command: 'ls' })).toBe('ask');
    });

    it('returns "allow" when a matching allow rule fires', () => {
      seed([
        {
          id: 'r1',
          pattern: 'Bash:*',
          toolName: 'Bash',
          action: 'allow',
          createdAt: 1,
        },
      ]);
      expect(svc.checkRules('Bash', { command: 'ls' })).toBe('allow');
    });

    it('returns "deny" when a matching deny rule fires', () => {
      // minimatch treats `/` as a path separator and `*` does not cross it,
      // so we build a pattern that matches only up to the first `/`.
      seed([
        {
          id: 'r1',
          pattern: 'Bash:*dangerous*',
          toolName: 'Bash',
          action: 'deny',
          createdAt: 1,
        },
      ]);
      expect(svc.checkRules('Bash', { command: 'dangerous-op' })).toBe('deny');
    });

    it('ignores rules scoped to a different tool', () => {
      seed([
        {
          id: 'r1',
          pattern: '*',
          toolName: 'Write',
          action: 'allow',
          createdAt: 1,
        },
      ]);
      expect(svc.checkRules('Bash', { command: 'ls' })).toBe('ask');
    });

    it('returns the first matching rule when multiple apply', () => {
      seed([
        {
          id: 'r1',
          pattern: 'Bash:*',
          toolName: 'Bash',
          action: 'deny',
          createdAt: 1,
        },
        {
          id: 'r2',
          pattern: 'Bash:*',
          toolName: 'Bash',
          action: 'allow',
          createdAt: 2,
        },
      ]);
      expect(svc.checkRules('Bash', { command: 'anything' })).toBe('deny');
    });
  });
});
