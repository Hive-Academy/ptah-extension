import 'reflect-metadata';
import type { SessionQuotaProbe } from '@ptah-extension/agent-sdk';
import type { ClaudeAccountNamedRoute } from '@ptah-extension/auth-providers-tokens';
import type { IAuthSecretsService, Logger } from '@ptah-extension/vscode-core';
import type { CodexHomeResolver } from '../providers/codex/codex-home-resolver';
import type {
  ICodexAccountUsageService,
  ICodexOwnerKeySource,
} from '../providers/codex/codex-provider.types';
import {
  ProviderOwnerResolver,
  claudeAccountOwnerKey,
} from './provider-owner.resolver';

function route(dir: string, runId = 'run'): ClaudeAccountNamedRoute {
  // Test-only admission fixture; production callers receive this from admission.
  return {
    kind: 'named',
    provider: 'claude',
    profileId: dir,
    canonicalConfigDir: dir,
    routeFingerprint: dir,
    routeRevision: 1,
    authEpoch: 1,
    runId,
  } as ClaudeAccountNamedRoute;
}

function harness() {
  const readAccount = jest.fn();
  const resolver = new ProviderOwnerResolver(
    {} as Logger,
    {} as IAuthSecretsService,
    { readAccount } as Pick<
      SessionQuotaProbe,
      'readAccount'
    > as SessionQuotaProbe,
    {} as ICodexAccountUsageService & ICodexOwnerKeySource,
    {} as CodexHomeResolver,
  );
  return { resolver, readAccount };
}

describe('Claude account owners', () => {
  it('uses trimmed email and organization, independent of the configuration directory', async () => {
    const { resolver, readAccount } = harness();
    readAccount.mockResolvedValue({
      status: 'available',
      value: { email: ' a@example.test ', organization: ' org ' },
    });
    const first = await resolver.ownerForSession('s1', route('/one'));
    const second = await resolver.ownerForSession('s2', route('/two'));
    expect(first).toEqual(second);
    expect(first.key).toBe(
      claudeAccountOwnerKey({ email: 'a@example.test', organization: 'org' }),
    );
    expect(JSON.stringify(first)).not.toMatch(/example|org|one|two/);
    expect(readAccount).toHaveBeenCalledWith('s2', route('/two'));
  });

  it('separates changed email and changed organization', () => {
    const original = claudeAccountOwnerKey({ email: 'a', organization: 'org' });
    expect(claudeAccountOwnerKey({ email: 'b', organization: 'org' })).not.toBe(
      original,
    );
    expect(
      claudeAccountOwnerKey({ email: 'a', organization: 'other' }),
    ).not.toBe(original);
    expect(claudeAccountOwnerKey({ email: ' ' })).toBeNull();
  });

  it('never promotes failed route/run proof to the previously known owner', async () => {
    const { resolver, readAccount } = harness();
    readAccount.mockResolvedValueOnce({
      status: 'available',
      value: { email: 'a' },
    });
    const known = await resolver.ownerForSession('s', route('/one'));
    readAccount.mockResolvedValue({
      status: 'unavailable',
      code: 'stale-epoch',
    });
    const failed = await resolver.ownerForSession('s', route('/one'));
    const otherRun = await resolver.ownerForSession('s', route('/one', 'next'));
    expect(failed.identityKind).toBe('unknown');
    expect(failed.key).not.toBe(known.key);
    expect(otherRun.key).not.toBe(failed.key);
  });
});
