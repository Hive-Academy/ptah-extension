/**
 * Lane owner resolver (TASK_2026_596, Component 10; Decision 3, Decision 10).
 *
 * The hashing itself belongs to `ProviderOwnerResolver` and is pinned by its
 * own spec; this one pins which owner a lane gets and the upgrade-only rule.
 */
import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { QuotaOwnerRef } from '@ptah-extension/shared';
import {
  LaneOwnerResolver,
  upgradeQuotaOwner,
  type LaneOwnerSource,
} from './lane-owner.resolver';

const ref = (
  providerId: string,
  identityKind: QuotaOwnerRef['identityKind'],
  fp = '0123456789abcdef',
): QuotaOwnerRef => ({
  key: `${providerId}#${identityKind}:${fp}`,
  providerId,
  identityKind,
  label: 'Provider owner',
});

function createResolver(): {
  resolver: LaneOwnerResolver;
  owners: jest.Mocked<LaneOwnerSource>;
  logger: jest.Mocked<Logger>;
} {
  const owners = {
    ownerForCodexHome: jest.fn(() => ref('openai-codex', 'account')),
    ownerForCliStore: jest.fn((cli: string) => ref(cli, 'cli-store')),
    ownerForAntigravity: jest.fn(() => ref('antigravity', 'account')),
    ownerForClaudeAccount: jest.fn(() => ref('anthropic', 'account')),
    ownerForPtahCli: jest.fn(async () => ref('ollama-cloud', 'credential')),
  } as unknown as jest.Mocked<LaneOwnerSource>;
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
  return { resolver: new LaneOwnerResolver(logger, owners), owners, logger };
}

describe('LaneOwnerResolver', () => {
  it('gives a codex lane the owner of the shared CODEX_HOME', () => {
    const { resolver, owners } = createResolver();

    expect(resolver.ownerForLane('codex')).toEqual(
      ref('openai-codex', 'account'),
    );
    expect(owners.ownerForCodexHome).toHaveBeenCalledTimes(1);
  });

  it('gives an opencode lane its CLI credential store', () => {
    const { resolver, owners } = createResolver();

    expect(resolver.ownerForLane('opencode')).toEqual(
      ref('opencode', 'cli-store'),
    );
    expect(owners.ownerForCliStore).toHaveBeenCalledWith('opencode');
  });

  it('gives an antigravity lane its active account owner', () => {
    const { resolver, owners } = createResolver();

    expect(resolver.ownerForLane('antigravity')).toEqual(
      ref('antigravity', 'account'),
    );
    expect(owners.ownerForAntigravity).toHaveBeenCalledTimes(1);
    expect(owners.ownerForCliStore).not.toHaveBeenCalled();
  });

  it.each(['ptah-cli', 'copilot', 'cursor', 'pi'] as const)(
    'gives a %s lane no owner at spawn',
    (cli) => {
      const { resolver, owners } = createResolver();

      expect(resolver.ownerForLane(cli)).toBeUndefined();
      expect(owners.ownerForCodexHome).not.toHaveBeenCalled();
      expect(owners.ownerForCliStore).not.toHaveBeenCalled();
    },
  );

  it('answers no owner, and logs no detail, when the lookup throws', () => {
    const { resolver, owners, logger } = createResolver();
    owners.ownerForCodexHome.mockImplementation(() => {
      throw new TypeError('secret-bearing message');
    });

    expect(resolver.ownerForLane('codex')).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      '[LaneOwnerResolver] lane owner lookup failed',
      { cli: 'codex', errorName: 'TypeError' },
    );
  });

  it('keys a ptah-cli Claude lane by its own account, falling back to the run', () => {
    const { resolver, owners } = createResolver();
    const account = { email: 'a@example.com', organization: 'org' };

    resolver.ownerForClaudeLane(
      account as Parameters<LaneOwnerResolver['ownerForClaudeLane']>[0],
      'agent-7',
    );

    expect(owners.ownerForClaudeAccount).toHaveBeenCalledWith(
      account,
      'run:agent-7',
    );
  });

  it('resolves a ptah-cli lane key through the stored-key owner', async () => {
    const { resolver, owners } = createResolver();

    await expect(
      resolver.ownerForPtahCliKey('cli-1', 'ollama-cloud'),
    ).resolves.toEqual(ref('ollama-cloud', 'credential'));
    expect(owners.ownerForPtahCli).toHaveBeenCalledWith(
      'cli-1',
      'ollama-cloud',
    );
  });
});

describe('upgradeQuotaOwner', () => {
  const known = ref('openai-codex', 'account');
  const unknown = ref('openai-codex', 'unknown');

  it('takes any candidate when there is no owner yet', () => {
    expect(upgradeQuotaOwner(undefined, unknown)).toBe(unknown);
    expect(upgradeQuotaOwner(undefined, known)).toBe(known);
  });

  it('upgrades unknown to known', () => {
    expect(upgradeQuotaOwner(unknown, known)).toBe(known);
  });

  it('never replaces unknown with another unknown', () => {
    expect(
      upgradeQuotaOwner(
        unknown,
        ref('openai-codex', 'unknown', 'ffffffffffffffff'),
      ),
    ).toBeUndefined();
  });

  it('never overwrites a known owner', () => {
    expect(
      upgradeQuotaOwner(
        known,
        ref('openai-codex', 'account', 'ffffffffffffffff'),
      ),
    ).toBeUndefined();
    expect(upgradeQuotaOwner(known, unknown)).toBeUndefined();
  });

  it('ignores an absent candidate', () => {
    expect(upgradeQuotaOwner(unknown, undefined)).toBeUndefined();
  });

  // TASK_2026_616, D2: a cli-store owner may move to the account of the same
  // provider; any other known owner is still never replaced.
  it('upgrades a cli-store owner to the account of the same provider', () => {
    const store = ref('antigravity', 'cli-store');
    const account = ref('antigravity', 'account');

    expect(upgradeQuotaOwner(store, account)).toBe(account);
  });

  it('never upgrades a cli-store owner to an account of another provider', () => {
    expect(
      upgradeQuotaOwner(
        ref('antigravity', 'cli-store'),
        ref('openai-codex', 'account'),
      ),
    ).toBeUndefined();
  });

  it('never upgrades a cli-store owner to a credential or another cli-store', () => {
    const store = ref('antigravity', 'cli-store');

    expect(upgradeQuotaOwner(store, ref('antigravity', 'credential'))).toBe(
      undefined,
    );
    expect(
      upgradeQuotaOwner(
        store,
        ref('antigravity', 'cli-store', 'ffffffffffffffff'),
      ),
    ).toBeUndefined();
  });

  it('never overwrites one account with another', () => {
    expect(
      upgradeQuotaOwner(
        ref('antigravity', 'account'),
        ref('antigravity', 'account', 'ffffffffffffffff'),
      ),
    ).toBeUndefined();
  });
});
