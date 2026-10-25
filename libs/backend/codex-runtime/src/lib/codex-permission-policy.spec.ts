import { codexPermissionPolicy } from './codex-permission-policy';
import type { CodexPermissionDecision } from './codex-permission-policy';
import type {
  CodexApprovalRequest,
  CodexPermissionLevel,
} from './codex-runtime.types';

const kinds: readonly CodexApprovalRequest['kind'][] = [
  'command',
  'fileChange',
  'mcpElicitation',
  'permissions',
  'userInput',
];
const cases: readonly [
  CodexPermissionLevel,
  readonly CodexPermissionDecision[],
][] = [
  ['ask', ['present', 'present', 'present', 'present', 'present']],
  ['plan', ['decline', 'decline', 'decline', 'decline', 'present']],
  ['auto-edit', ['present', 'accept', 'present', 'present', 'present']],
  ['yolo', ['accept', 'accept', 'accept', 'accept', 'present']],
];

describe('codexPermissionPolicy', () => {
  it.each(cases)(
    '%s routes every request class without a remembered rule',
    (level, expected) => {
      expect(
        kinds.map((kind) => codexPermissionPolicy(level, kind, false, {})),
      ).toEqual(expected);
    },
  );

  it.each<CodexPermissionLevel>(['ask', 'auto-edit', 'yolo'])(
    '%s honors scoped rules but keeps questions interactive',
    (level) => {
      expect(
        kinds.map((kind) => codexPermissionPolicy(level, kind, true, {})),
      ).toEqual([
        'acceptForSession',
        'acceptForSession',
        'acceptForSession',
        'acceptForSession',
        'present',
      ]);
    },
  );

  it.each<CodexApprovalRequest['details'] | undefined>([
    { grantRoot: '/outside' },
    { writableRoots: ['/outside'] },
    { scope: 'session' },
  ])(
    'presents scope widening or unknown file-change details %j even with a rule',
    (details) => {
      for (const level of ['ask', 'auto-edit', 'yolo'] as const) {
        for (const remembered of [false, true]) {
          expect(
            codexPermissionPolicy(level, 'fileChange', remembered, details),
          ).toBe('present');
        }
      }
    },
  );
  it('requires details before auto-edit approval', () => {
    expect(codexPermissionPolicy('auto-edit', 'fileChange', true)).toBe(
      'present',
    );
  });

  it('auto-accepts a validated ordinary file change with a null grantRoot', () => {
    expect(
      codexPermissionPolicy('auto-edit', 'fileChange', false, {
        threadId: 'thread',
        turnId: 'turn',
        itemId: 'item',
        grantRoot: null,
      }),
    ).toBe('accept');
  });

  it('does not let a remembered grant override plan mode', () => {
    expect(
      kinds.map((kind) => codexPermissionPolicy('plan', kind, true)),
    ).toEqual(['decline', 'decline', 'decline', 'decline', 'present']);
  });
});
