import {
  PROVIDER_ACCOUNT_DUPLICATE_ROUTE_SUMMARY,
  type ProviderAccountActionResult,
  type ProviderAccountBinding,
  type ProviderAccountSelectionRequest,
  type ProviderAccountSummary,
} from './provider-account.types';
import {
  ProviderAccountActionResultSchema,
  ProviderAccountBindingSchema,
  ProviderAccountSelectionRequestSchema,
  ProviderAccountSelectionSchema,
  ProviderAccountSummarySchema,
  classifyProviderAccountBinding,
  parseProviderAccountActionResult,
  parseProviderAccountBinding,
  parseProviderAccountSelectionRequest,
  parseProviderAccountSummary,
  readProviderAccountSelectionField,
} from '@ptah-extension/shared/schemas';

const PROFILE_ID = 'acct1234';
const RUN_ID = 'run12345';
const FINGERPRINT = 'a'.repeat(64);
const OWNER_KEY = 'ab'.repeat(32);

const namedRequest: ProviderAccountSelectionRequest = {
  provider: 'claude',
  scope: 'lane',
  selection: { kind: 'named', profileId: PROFILE_ID },
};

const summary: ProviderAccountSummary = {
  profileId: PROFILE_ID,
  label: 'Büro work',
  provider: 'claude',
  state: 'signed-in',
  owner: 'verified',
  revision: 3,
  activeRunCount: 1,
};

const knownBinding: ProviderAccountBinding = {
  version: 1,
  provider: 'claude',
  profileId: PROFILE_ID,
  routeRevision: 4,
  routeFingerprint: FINGERPRINT,
  authEpoch: 2,
  runId: RUN_ID,
  identity: { kind: 'known', ownerKey: OWNER_KEY },
};

const unknownBinding: ProviderAccountBinding = {
  ...knownBinding,
  provider: 'codex',
  identity: { kind: 'unknown' },
};

const actionResult: ProviderAccountActionResult = {
  code: 'conflict',
  summary: PROVIDER_ACCOUNT_DUPLICATE_ROUTE_SUMMARY,
};

const SUMMARY_KEYS = [
  'activeRunCount',
  'label',
  'owner',
  'profileId',
  'provider',
  'revision',
  'state',
];

describe('provider account selection', () => {
  it.each([
    { kind: 'omitted' } as const,
    { kind: 'ambient' } as const,
    { kind: 'named', profileId: PROFILE_ID } as const,
  ])('round-trips %j', (selection) => {
    expect(ProviderAccountSelectionSchema.parse(selection)).toEqual(selection);
  });

  it('round-trips a scoped named request', () => {
    expect(parseProviderAccountSelectionRequest(namedRequest)).toEqual({
      ok: true,
      value: namedRequest,
    });
    expect(ProviderAccountSelectionRequestSchema.parse(namedRequest)).toEqual(
      namedRequest,
    );
  });

  it.each(['main', 'lane'] as const)('accepts scope %s', (scope) => {
    const request = { ...namedRequest, scope };
    expect(ProviderAccountSelectionRequestSchema.parse(request)).toEqual(
      request,
    );
  });

  it.each([
    ['path', 'C:\\Users\\acct'],
    ['env', { ANTHROPIC_API_KEY: 'present' }],
    ['authEpoch', 4],
    ['epoch', 4],
    ['ownerKey', OWNER_KEY],
    ['owner', 'person@example.com'],
    ['canonicalConfigDir', '/tmp/claude'],
    ['directory', '/tmp/claude'],
    ['binding', knownBinding],
  ])('rejects selection authority field %s', (key, value) => {
    expect(
      parseProviderAccountSelectionRequest({
        ...namedRequest,
        selection: { kind: 'ambient', [key]: value },
      }).ok,
    ).toBe(false);
    expect(
      ProviderAccountSelectionRequestSchema.safeParse({
        ...namedRequest,
        [key]: value,
      }).success,
    ).toBe(false);
  });

  it.each(['openai', '', 'claude-cli'])(
    'rejects provider %j',
    (provider) => {
      expect(
        ProviderAccountSelectionRequestSchema.safeParse({
          ...namedRequest,
          provider,
        }).success,
      ).toBe(false);
    },
  );

  it.each(['global', 'default', 'workspace', ''])(
    'rejects scope %j',
    (scope) => {
      expect(
        ProviderAccountSelectionRequestSchema.safeParse({
          ...namedRequest,
          scope,
        }).success,
      ).toBe(false);
    },
  );

  it('rejects a short, slashed or flag-shaped profile id', () => {
    for (const profileId of ['short', 'acct/../../../x', '-acct1234', '']) {
      expect(
        ProviderAccountSelectionSchema.safeParse({
          kind: 'named',
          profileId,
        }).success,
      ).toBe(false);
    }
  });

  it('does not treat a missing field as a corrupt selection', () => {
    expect(readProviderAccountSelectionField(undefined)).toEqual({
      status: 'omitted',
    });
    expect(readProviderAccountSelectionField(null)).toEqual({
      status: 'invalid',
    });
    expect(
      readProviderAccountSelectionField({
        kind: 'named',
        profileId: PROFILE_ID,
        canonicalConfigDir: '/tmp/claude',
      }),
    ).toEqual({ status: 'invalid' });
    expect(
      readProviderAccountSelectionField({
        kind: 'named',
        profileId: PROFILE_ID,
      }),
    ).toEqual({
      status: 'present',
      selection: { kind: 'named', profileId: PROFILE_ID },
    });
  });
});

describe('provider account summary and result', () => {
  it('round-trips a sanitized summary without extra identity fields', () => {
    expect(parseProviderAccountSummary(summary)).toEqual({
      ok: true,
      value: summary,
    });
    const parsed = ProviderAccountSummarySchema.parse(summary);
    expect(Object.keys(parsed).sort()).toEqual(SUMMARY_KEYS);
    expect(JSON.stringify(parsed)).not.toMatch(
      /@|\\|\/tmp|\/home|sk-|ANTHROPIC|ownerKey/,
    );
  });

  it.each([
    'email',
    'organization',
    'token',
    'directory',
    'canonicalConfigDir',
    'authEpoch',
    'env',
  ])('rejects summary field %s', (key) => {
    expect(
      ProviderAccountSummarySchema.safeParse({
        ...summary,
        [key]: 'user@example.com',
      }).success,
    ).toBe(false);
  });

  it.each(['', 'not-a-state', 'signedout'])(
    'rejects state %j',
    (state) => {
      expect(
        ProviderAccountSummarySchema.safeParse({ ...summary, state }).success,
      ).toBe(false);
    },
  );

  it.each([
    'Research & Development',
    'Work: Europe',
    'Team/A',
    'Büro work',
  ])('accepts display label %j', (label) => {
    expect(
      ProviderAccountSummarySchema.parse({ ...summary, label }).label,
    ).toBe(label);
  });

  it.each([
    '',
    ' ',
    ' padded',
    'padded ',
    'x'.repeat(65),
    'has\nnewline',
    'has\u0000null',
    'has\u007fdel',
  ])(
    'rejects unbounded or control-character label %j',
    (label) => {
      expect(
        ProviderAccountSummarySchema.safeParse({ ...summary, label }).success,
      ).toBe(false);
    },
  );

  it('round-trips the duplicate-route sentence and rejects raw output', () => {
    expect(ProviderAccountActionResultSchema.parse(actionResult)).toEqual(
      actionResult,
    );
    expect(parseProviderAccountActionResult(actionResult).ok).toBe(true);
    for (const unsafe of [
      'Failed at C:\\Users\\acct\\.claude',
      'owner user@example.com',
      'ANTHROPIC_API_KEY=present',
      'see https://example.test/auth',
      '',
    ]) {
      expect(
        ProviderAccountActionResultSchema.safeParse({
          code: 'conflict',
          summary: unsafe,
        }).success,
      ).toBe(false);
    }
  });

  it.each(['exception', 'cli-error', ''])(
    'rejects result code %j',
    (code) => {
      expect(
        ProviderAccountActionResultSchema.safeParse({
          code,
          summary: 'Sign-in failed.',
        }).success,
      ).toBe(false);
    },
  );

  it('accepts a hyphenated safe sentence', () => {
    const value = { code: 'cancelled' as const, summary: 'Sign-in cancelled.' };
    expect(ProviderAccountActionResultSchema.parse(value)).toEqual(value);
  });
});

describe('provider account binding', () => {
  it.each(['routeRevision', 'authEpoch'] as const)('accepts zero and safe integers for %s', field => {
    for (const value of [0, 1, Number.MAX_SAFE_INTEGER]) {
      expect(ProviderAccountBindingSchema.safeParse({ ...knownBinding, [field]: value }).success).toBe(true);
    }
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '0']) {
      expect(ProviderAccountBindingSchema.safeParse({ ...knownBinding, [field]: value }).success).toBe(false);
    }
  });

  it('keeps summary revisions positive', () => {
    expect(ProviderAccountSummarySchema.safeParse({ ...summary, revision: 0 }).success).toBe(false);
  });

  it('round-trips known and unknown version-1 bindings', () => {
    expect(parseProviderAccountBinding(knownBinding)).toEqual({
      ok: true,
      value: knownBinding,
    });
    expect(ProviderAccountBindingSchema.parse(unknownBinding)).toEqual(
      unknownBinding,
    );
    expect(classifyProviderAccountBinding(knownBinding)).toEqual({
      status: 'bound',
      binding: knownBinding,
    });
  });

  it('keeps absence distinct from a malformed present binding', () => {
    expect(classifyProviderAccountBinding(undefined)).toEqual({
      status: 'absent',
    });
    for (const malformed of [
      null,
      {},
      { ...knownBinding, version: 2 },
      { ...knownBinding, version: 0 },
      { ...knownBinding, version: '1' },
      { ...knownBinding, routeRevision: 1.5 },
      { ...knownBinding, routeRevision: -1 },
      { ...knownBinding, authEpoch: -1 },
      { ...knownBinding, authEpoch: 1.5 },
      { ...knownBinding, provider: 'openai' },
      { ...knownBinding, canonicalConfigDir: '/tmp/claude' },
      { ...knownBinding, env: { CLAUDE_CONFIG_DIR: '/tmp/claude' } },
      {
        ...knownBinding,
        identity: { kind: 'known', ownerKey: 'person@example.com' },
      },
      {
        ...knownBinding,
        identity: { kind: 'unknown', ownerKey: OWNER_KEY },
      },
      { ...knownBinding, routeFingerprint: 'C:/Users/acct' },
      { ...knownBinding, runId: '../run1234' },
    ]) {
      expect(classifyProviderAccountBinding(malformed)).toEqual({
        status: 'invalid-bound',
      });
      expect(classifyProviderAccountBinding(malformed)).not.toEqual({
        status: 'absent',
      });
    }
  });

  it('rejects an uppercase or short owner digest', () => {
    expect(
      ProviderAccountBindingSchema.safeParse({
        ...knownBinding,
        identity: { kind: 'known', ownerKey: 'AB'.repeat(32) },
      }).success,
    ).toBe(false);
    expect(
      ProviderAccountBindingSchema.safeParse({
        ...knownBinding,
        identity: { kind: 'known', ownerKey: 'abcd' },
      }).success,
    ).toBe(false);
  });
});
