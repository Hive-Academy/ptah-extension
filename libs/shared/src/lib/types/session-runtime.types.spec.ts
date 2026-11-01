import {
  SessionId,
  sessionRuntimeIdentityMismatch,
  type SessionRuntimeIdentity,
} from '../../index';
import {
  SessionRuntimeIdentitySchema,
  parseSessionRuntimeIdentity,
} from '../../schemas';

const claude: SessionRuntimeIdentity = {
  version: 1,
  sessionId: SessionId.from('12345678-1234-4234-8234-123456789abc'),
  providerId: 'anthropic',
  workspaceId: 'workspace-1',
  runtime: 'claude-sdk',
};

const codex: SessionRuntimeIdentity = {
  ...claude,
  providerId: 'openai-codex',
  runtime: 'codex-app-server',
  codex: { normalizedHome: 'd:\\profiles\\codex' },
};

describe('SessionRuntimeIdentitySchema', () => {
  it.each([
    '/',
    '/home/User/.codex',
    '/a\\b',
    'c:\\',
    'c:\\users\\codex',
    '\\\\server\\share\\',
    '\\\\server\\share\\codex',
  ])('accepts normalized home %s', (normalizedHome) => {
    expect(
      SessionRuntimeIdentitySchema.safeParse({
        ...codex,
        codex: { normalizedHome },
      }).success,
    ).toBe(true);
  });

  it.each([
    'relative',
    'C:\\Users\\codex',
    'c:/users/codex',
    '/a/',
    '/a//b',
    '/a/./b',
    '/a/../b',
    '//home',
    'c:\\a\\..\\b',
    'c:\\a\\',
    '\\\\server\\share',
    '/a\0b',
  ])('rejects non-normalized home %s', (normalizedHome) => {
    expect(
      parseSessionRuntimeIdentity({ ...codex, codex: { normalizedHome } }),
    ).toEqual({ ok: false, code: 'rejected' });
  });

  it.each([claude, codex])('accepts $runtime identities', (identity) => {
    expect(SessionRuntimeIdentitySchema.parse(identity)).toEqual(identity);
    expect(parseSessionRuntimeIdentity(identity)).toEqual({
      ok: true,
      value: identity,
    });
  });

  it.each([
    ['missing Codex home', { ...claude, runtime: 'codex-app-server' }],
    ['missing normalized home', { ...codex, codex: {} }],
    ['empty normalized home', { ...codex, codex: { normalizedHome: '' } }],
    ['Claude with a home', { ...claude, codex: codex.codex }],
    ['Claude with undefined codex', { ...claude, codex: undefined }],
    ['unknown version', { ...codex, version: 2 }],
    ['unknown runtime', { ...codex, runtime: 'other' }],
    ['extra top-level key', { ...codex, token: 'must-not-be-returned' }],
    [
      'extra nested key',
      { ...codex, codex: { ...codex.codex, token: 'secret' } },
    ],
    ['invalid session ID', { ...codex, sessionId: 'invalid' }],
    ['empty provider ID', { ...codex, providerId: '' }],
    ['empty workspace ID', { ...codex, workspaceId: '' }],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s without throwing or returning input', (_label, value) => {
    expect(SessionRuntimeIdentitySchema.safeParse(value).success).toBe(false);
    expect(parseSessionRuntimeIdentity(value)).toEqual({
      ok: false,
      code: 'rejected',
    });
  });
});

describe('sessionRuntimeIdentityMismatch', () => {
  it.each([claude, codex])('accepts matching $runtime bindings', (identity) => {
    expect(
      sessionRuntimeIdentityMismatch(identity, { ...identity }),
    ).toBeNull();
  });

  it('does not compare session IDs', () => {
    expect(
      sessionRuntimeIdentityMismatch(codex, {
        ...codex,
        sessionId: SessionId.from('abcdef12-1234-4234-8234-123456789abc'),
      }),
    ).toBeNull();
  });

  it('reports providerId before other differences', () => {
    expect(
      sessionRuntimeIdentityMismatch(codex, {
        ...claude,
        workspaceId: 'other',
      }),
    ).toBe('providerId');
  });

  it('reports workspaceId before runtime or home', () => {
    expect(
      sessionRuntimeIdentityMismatch(codex, {
        ...claude,
        providerId: codex.providerId,
        workspaceId: 'other',
      }),
    ).toBe('workspaceId');
  });

  it('reports runtime before home in either direction', () => {
    const other: SessionRuntimeIdentity = {
      ...claude,
      providerId: codex.providerId,
    };
    expect(sessionRuntimeIdentityMismatch(codex, other)).toBe('runtime');
    expect(sessionRuntimeIdentityMismatch(other, codex)).toBe('runtime');
  });

  it('reports normalizedHome without normalizing paths again', () => {
    expect(
      sessionRuntimeIdentityMismatch(codex, {
        ...codex,
        codex: { normalizedHome: 'D:/profiles/codex' },
      }),
    ).toBe('normalizedHome');
  });
});
