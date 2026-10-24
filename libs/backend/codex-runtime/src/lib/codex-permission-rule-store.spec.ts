import {
  CodexPermissionRuleStore,
  type CodexPermissionRuleScope,
  type CodexPermissionRuleTarget,
} from './codex-permission-rule-store';
import { codexPermissionPolicy } from './codex-permission-policy';
import type {
  CodexApprovalDecision,
  CodexThreadIdentity,
} from './codex-runtime.types';

const scope: CodexPermissionRuleScope = {
  providerId: 'openai',
  normalizedHome: '/home/account-a',
  workspaceId: 'workspace-a',
  threadId: 'thread-a',
};
const command: CodexPermissionRuleTarget = {
  kind: 'command',
  command: 'npm test',
  cwd: '/work',
};
const files: CodexPermissionRuleTarget = {
  kind: 'fileChange',
  paths: ['/work/a.ts', '/work/b.ts'],
};
const mcp: CodexPermissionRuleTarget = {
  kind: 'mcpElicitation',
  server: 'marker',
  tool: 'write_marker',
};

describe('CodexPermissionRuleStore', () => {
  let store: CodexPermissionRuleStore;
  beforeEach(() => {
    store = new CodexPermissionRuleStore();
  });

  it.each([command, files, mcp])(
    'remembers only the explicitly authorized $kind scope',
    (target) => {
      expect(store.matches(scope, target)).toBe(false);
      expect(store.record(scope, target, 'acceptForSession')).toBe(true);
      expect(store.matches(scope, target)).toBe(true);
      expect(
        codexPermissionPolicy('ask', target.kind, store.matches(scope, target)),
      ).toBe('acceptForSession');
    },
  );

  it.each<CodexApprovalDecision>(['accept', 'decline', 'cancel'])(
    '%s does not add a rule',
    (decision) => {
      expect(store.record(scope, command, decision)).toBe(false);
      expect(store.matches(scope, command)).toBe(false);
    },
  );

  it.each<keyof CodexPermissionRuleScope>([
    'providerId',
    'normalizedHome',
    'workspaceId',
    'threadId',
  ])('isolates %s', (key) => {
    store.record(scope, command, 'acceptForSession');
    expect(store.matches({ ...scope, [key]: 'different' }, command)).toBe(
      false,
    );
  });

  it('isolates command text, cwd and request kind without prefix expansion', () => {
    store.record(scope, command, 'acceptForSession');
    for (const target of [
      { kind: 'command', command: 'npm test --other', cwd: '/work' },
      { kind: 'command', command: 'npm test; rm file', cwd: '/work' },
      { kind: 'command', command: 'npm test', cwd: '/other' },
      files,
      mcp,
    ] satisfies CodexPermissionRuleTarget[])
      expect(store.matches(scope, target)).toBe(false);
  });

  it('matches an exact file set irrespective of order, without directory or subset widening', () => {
    store.record(scope, files, 'acceptForSession');
    expect(
      store.matches(scope, {
        kind: 'fileChange',
        paths: ['/work/b.ts', '/work/a.ts'],
      }),
    ).toBe(true);
    for (const paths of [
      ['/work/a.ts'],
      ['/work/a.ts.extra', '/work/b.ts'],
      ['/work/a.ts', '/work/b.ts', '/outside/c.ts'],
    ]) {
      expect(store.matches(scope, { kind: 'fileChange', paths })).toBe(false);
    }
  });

  it('isolates MCP server and tool', () => {
    store.record(scope, mcp, 'acceptForSession');
    expect(
      store.matches(scope, {
        kind: 'mcpElicitation',
        server: 'other',
        tool: 'write_marker',
      }),
    ).toBe(false);
    expect(
      store.matches(scope, {
        kind: 'mcpElicitation',
        server: 'marker',
        tool: 'delete_marker',
      }),
    ).toBe(false);
  });

  it('retains rules across process generations but not a new host store', () => {
    const identity: CodexThreadIdentity = {
      ...scope,
      contextId: 'context',
      processGeneration: 1,
      profileFingerprint: 'profile',
    };
    store.record(identity, command, 'acceptForSession');
    const restarted = { ...identity, processGeneration: 2 };
    expect(store.matches(restarted, command)).toBe(true);
    expect(new CodexPermissionRuleStore().matches(restarted, command)).toBe(
      false,
    );
  });

  it('clears only the exact scope and allows an explicit later grant', () => {
    const other = { ...scope, threadId: 'other' };
    store.record(scope, command, 'acceptForSession');
    store.record(other, command, 'acceptForSession');
    store.clear(scope);
    expect(store.matches(scope, command)).toBe(false);
    expect(store.matches(other, command)).toBe(true);
    expect(store.record(scope, command, 'acceptForSession')).toBe(true);
  });

  it('disposes all grants permanently and idempotently', () => {
    store.record(scope, command, 'acceptForSession');
    store.record({ ...scope, threadId: 'other' }, mcp, 'acceptForSession');
    store.dispose();
    store.dispose();
    expect(store.matches(scope, command)).toBe(false);
    expect(store.matches({ ...scope, threadId: 'other' }, mcp)).toBe(false);
    expect(store.record(scope, command, 'acceptForSession')).toBe(false);
  });

  it('snapshots mutable caller inputs', () => {
    const mutableScope = { ...scope };
    const paths = ['/work/a.ts', '/work/b.ts'];
    store.record(
      mutableScope,
      { kind: 'fileChange', paths },
      'acceptForSession',
    );
    mutableScope.normalizedHome = '/other';
    paths.push('/outside');
    expect(store.matches(scope, files)).toBe(true);
    expect(store.matches(mutableScope, files)).toBe(false);
    expect(store.matches(scope, { kind: 'fileChange', paths })).toBe(false);
  });

  it('does not collide delimiter-bearing scope or target fields', () => {
    const first = { ...scope, providerId: 'a|b', normalizedHome: 'c' };
    const second = { ...scope, providerId: 'a', normalizedHome: 'b|c' };
    store.record(first, command, 'acceptForSession');
    expect(store.matches(second, command)).toBe(false);
    store.record(
      scope,
      { kind: 'mcpElicitation', server: 'a|b', tool: 'c' },
      'acceptForSession',
    );
    expect(
      store.matches(scope, {
        kind: 'mcpElicitation',
        server: 'a',
        tool: 'b|c',
      }),
    ).toBe(false);
  });

  it.each<keyof CodexPermissionRuleScope>([
    'providerId',
    'normalizedHome',
    'workspaceId',
    'threadId',
  ])('refuses empty %s', (key) => {
    const invalid = { ...scope, [key]: ' ' };
    expect(store.record(invalid, command, 'acceptForSession')).toBe(false);
    expect(store.matches(invalid, command)).toBe(false);
  });

  it.each<CodexPermissionRuleTarget>([
    { kind: 'command', command: '', cwd: '/work' },
    { kind: 'command', command: 'npm test', cwd: '' },
    { kind: 'fileChange', paths: [] },
    { kind: 'fileChange', paths: [''] },
    { kind: 'mcpElicitation', server: '', tool: 'tool' },
    { kind: 'mcpElicitation', server: 'server', tool: '' },
  ])('refuses incomplete targets: %j', (target) => {
    expect(store.record(scope, target, 'acceptForSession')).toBe(false);
    expect(store.matches(scope, target)).toBe(false);
  });
});
