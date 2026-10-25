import type {
  AgentSessionResumeConfig,
  AgentSessionStartConfig,
  SlashCommandRunConfig,
} from './agent-adapter.types';
import { AgentId, SYSTEM_CLI_TYPES } from './agent-process.types';
import type { CliSessionReference } from './agent-process.types';
import {
  classifyProviderAccountBinding,
  ProviderAccountSelectionSchema,
} from './provider-account.schemas';
import type {
  ProviderAccountBinding,
  ProviderAccountSelection,
  ProviderAccountSummary,
} from './provider-account.types';
import { ProviderProfileSchema } from './provider-profile.schemas';
import type {
  ProviderProfile,
  ProviderProfileAuthEnv,
} from './provider-profile.types';

const legacyProfile: ProviderProfile = {
  providerId: 'anthropic',
  authEnv: {},
  model: 'claude-sonnet-4-20250514',
};

const binding: ProviderAccountBinding = {
  version: 1,
  provider: 'claude',
  profileId: 'account_12345678',
  routeRevision: 1,
  routeFingerprint: 'a'.repeat(64),
  authEpoch: 1,
  runId: 'run_12345678',
  identity: { kind: 'known', ownerKey: 'b'.repeat(64) },
};

const legacyReference: CliSessionReference = {
  cliSessionId: 'cli-session-1',
  cli: 'ptah-cli',
  agentId: AgentId.from('00000000-0000-4000-8000-000000000001'),
  task: 'Implement the assigned task',
  startedAt: '2026-10-22T00:00:00.000Z',
  status: 'completed',
};

describe('provider account binding transport', () => {
  it('parses old unbound profiles and references unchanged', () => {
    expect(ProviderProfileSchema.parse(legacyProfile)).toEqual(legacyProfile);
    const restored: CliSessionReference = JSON.parse(
      JSON.stringify(legacyReference),
    );
    expect(restored).toEqual(legacyReference);
    expect(classifyProviderAccountBinding(restored.accountBinding)).toEqual({
      status: 'absent',
    });
    expect(ProviderProfileSchema.parse(legacyProfile)).not.toHaveProperty(
      'accountBinding',
    );
  });

  it.each([
    null,
    {},
    { ...binding, version: 2 },
    { ...binding, profileId: '' },
    { ...binding, runId: undefined },
    { ...binding, identity: { kind: 'known', ownerKey: 'not-a-hash' } },
    { ...binding, canonicalConfigDir: '/private/account' },
  ])('refuses a malformed present binding rather than legacy absence: %j', (value) => {
    expect(
      ProviderProfileSchema.safeParse({ ...legacyProfile, accountBinding: value })
        .success,
    ).toBe(false);
    expect(classifyProviderAccountBinding(value)).toEqual({
      status: 'invalid-bound',
    });
    const restored: { accountBinding: unknown } = JSON.parse(
      JSON.stringify({ ...legacyReference, accountBinding: value }),
    );
    expect(classifyProviderAccountBinding(restored.accountBinding)).toEqual({
      status: 'invalid-bound',
    });
  });

  it('preserves a rename-independent account ID through start resume slash and reference roundtrips', () => {
    const account: ProviderAccountSummary = {
      profileId: binding.profileId,
      label: 'Original label',
      provider: 'claude',
      state: 'signed-in',
      owner: 'verified',
      revision: 1,
      activeRunCount: 1,
    };
    const renamed = { ...account, label: 'Renamed label' };
    const selection: ProviderAccountSelection = {
      kind: 'named',
      profileId: renamed.profileId,
    };
    const profile: ProviderProfile = {
      ...legacyProfile,
      accountBinding: binding,
      accountBindingId: 'binding_12345678',
    };
    const start: AgentSessionStartConfig = {
      tabId: 'tab-1',
      accountSelection: selection,
      providerProfile: profile,
    };
    const resume: AgentSessionResumeConfig = {
      accountSelection: start.accountSelection,
      providerProfile: start.providerProfile,
    };
    const slash: SlashCommandRunConfig = {
      accountSelection: resume.accountSelection,
      providerProfile: resume.providerProfile,
    };
    for (const config of [start, resume, slash]) {
      const parsed = ProviderProfileSchema.parse(
        JSON.parse(JSON.stringify(config.providerProfile)),
      );
      expect(parsed).toEqual(profile);
      expect(parsed.accountBinding?.profileId).toBe(account.profileId);
      expect(
        ProviderAccountSelectionSchema.parse(
          JSON.parse(JSON.stringify(config.accountSelection)),
        ),
      ).toEqual(selection);
    }
    const reference: CliSessionReference = {
      ...legacyReference,
      accountBinding: slash.providerProfile?.accountBinding,
      accountBindingId: slash.providerProfile?.accountBindingId,
    };
    const restored: CliSessionReference = JSON.parse(JSON.stringify(reference));
    expect(restored).toEqual(reference);
    expect(restored.accountBindingId).toBe(profile.accountBindingId);
    expect(classifyProviderAccountBinding(restored.accountBinding)).toEqual({
      status: 'bound',
      binding,
    });
    expect(JSON.stringify(restored)).not.toContain(account.label);
    expect(JSON.stringify(restored)).not.toContain(renamed.label);
  });

  it('keeps every new field optional for existing callers', () => {
    const start: AgentSessionStartConfig = { tabId: 'legacy-tab' };
    const resume: AgentSessionResumeConfig = {};
    const slash: SlashCommandRunConfig = {};
    expect([
      start.accountSelection,
      resume.accountSelection,
      slash.accountSelection,
    ]).toEqual([undefined, undefined, undefined]);
    expect(legacyProfile.accountBinding).toBeUndefined();
    expect(legacyReference.accountBindingId).toBeUndefined();
  });

  it('preserves finite AuthEnv keys and excludes canonical paths from bindings', () => {
    const finiteKeys: string extends keyof ProviderProfileAuthEnv
      ? false : true = true;
    const noConfigDir: 'CLAUDE_CONFIG_DIR' extends keyof ProviderProfileAuthEnv
      ? false : true = true;
    const noBindingPath: 'canonicalConfigDir' extends keyof ProviderAccountBinding
      ? false : true = true;
    const noReferencePath: 'canonicalConfigDir' extends keyof CliSessionReference
      ? false : true = true;
    expect([finiteKeys, noConfigDir, noBindingPath, noReferencePath]).toEqual([
      true, true, true, true,
    ]);
    expect(SYSTEM_CLI_TYPES).not.toContain('claude');
  });

  it('rejects malformed registry linkage and preserves explicit ambient selection', () => {
    expect(
      ProviderProfileSchema.safeParse({
        ...legacyProfile,
        accountBindingId: '/private/account',
      }).success,
    ).toBe(false);
    expect(ProviderAccountSelectionSchema.parse({ kind: 'ambient' })).toEqual({
      kind: 'ambient',
    });
  });
});
