import 'reflect-metadata';
import {
  UNATTENDED_DENY_WINDOW_MAX_MS,
  UnattendedSessionPolicyRegistry,
  type UnattendedSessionPolicy,
} from './unattended-session-policy.registry';
import { SdkError } from '../errors';

const TAB_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function makePolicy(
  overrides: Partial<UnattendedSessionPolicy> = {},
): UnattendedSessionPolicy {
  return {
    bashAllowlist: ['git status'],
    writableRoot: '/root/.claude-worktrees/child',
    denyWindowMs: 30_000,
    ownerLabel: 'parent tab',
    ...overrides,
  };
}

describe('UnattendedSessionPolicyRegistry', () => {
  let registry: UnattendedSessionPolicyRegistry;

  beforeEach(() => {
    registry = new UnattendedSessionPolicyRegistry();
  });

  it('returns the registered policy for its routing id', () => {
    registry.register(TAB_ID, makePolicy());
    expect(registry.get(TAB_ID)).toMatchObject({
      bashAllowlist: ['git status'],
      writableRoot: '/root/.claude-worktrees/child',
      denyWindowMs: 30_000,
      ownerLabel: 'parent tab',
    });
  });

  it('returns undefined for an unknown or undefined id', () => {
    registry.register(TAB_ID, makePolicy());
    expect(registry.get('other-tab')).toBeUndefined();
    expect(registry.get(undefined)).toBeUndefined();
  });

  it('the disposer removes the registration and is idempotent', () => {
    const dispose = registry.register(TAB_ID, makePolicy());
    dispose();
    expect(registry.get(TAB_ID)).toBeUndefined();
    expect(() => dispose()).not.toThrow();
  });

  it('a stale disposer does not remove a newer registration under the same id', () => {
    const disposeOld = registry.register(
      TAB_ID,
      makePolicy({ ownerLabel: 'old' }),
    );
    registry.register(TAB_ID, makePolicy({ ownerLabel: 'new' }));

    disposeOld();

    expect(registry.get(TAB_ID)?.ownerLabel).toBe('new');
  });

  it.each([
    ['negative', -5, 0],
    ['zero', 0, 0],
    ['NaN', Number.NaN, 0],
    ['infinite', Number.POSITIVE_INFINITY, 0],
    ['in range', 45_000, 45_000],
    ['above the ceiling', 3_600_000, UNATTENDED_DENY_WINDOW_MAX_MS],
  ])('clamps a %s deny window', (_label, input, expected) => {
    registry.register(TAB_ID, makePolicy({ denyWindowMs: input }));
    expect(registry.get(TAB_ID)?.denyWindowMs).toBe(expected);
  });

  it('stores a copy, so mutating the caller array does not change the policy', () => {
    const allowlist = ['git status'];
    registry.register(TAB_ID, makePolicy({ bashAllowlist: allowlist }));
    allowlist.push('rm -rf');
    expect(registry.get(TAB_ID)?.bashAllowlist).toEqual(['git status']);
  });

  it.each(['', '   '])('refuses a blank routing id %p', (id) => {
    expect(() => registry.register(id, makePolicy())).toThrow(SdkError);
  });
});
