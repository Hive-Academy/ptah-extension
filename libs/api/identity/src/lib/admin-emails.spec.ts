import type { ConfigService } from '@nestjs/config';
import {
  isAdminAllowlistConfigured,
  isAdminEmail,
  parseAdminEmails,
} from './admin-emails';

/**
 * THE case table for "is this address an admin", now that there is exactly one
 * answer to that question in the server.
 *
 * This file is the reason the five former call sites can stop carrying their
 * own copies of these cases: the PARSE is proven here once, and each call site
 * now only has to prove its own POLICY (throw vs. `false`) on top of it.
 */

function config(adminEmails?: string): ConfigService {
  return {
    get: (key: string) => (key === 'ADMIN_EMAILS' ? adminEmails : undefined),
  } as unknown as ConfigService;
}

describe('parseAdminEmails', () => {
  it.each<[string, string | undefined, string[]]>([
    ['unset', undefined, []],
    ['blank', '   ', []],
    ['separators only', ',,,', []],
    ['single entry', 'admin@example.com', ['admin@example.com']],
    ['lower-cases', 'Admin@Example.COM', ['admin@example.com']],
    [
      'trims and drops empties',
      ' a@x.com , , admin@example.com ,',
      ['a@x.com', 'admin@example.com'],
    ],
  ])('%s -> %j', (_label, raw, expected) => {
    expect(parseAdminEmails(config(raw))).toEqual(expected);
  });
});

describe('isAdminAllowlistConfigured — for the AUTHORIZING caller only', () => {
  it.each<[string, string | undefined, boolean]>([
    ['unset', undefined, false],
    ['blank', '  ', false],
    ['separators only', ',,,', false],
    ['one real entry', 'admin@example.com', true],
  ])('%s -> %s', (_label, raw, expected) => {
    expect(isAdminAllowlistConfigured(config(raw))).toBe(expected);
  });

  it('treats "unset", "blank" and "separators only" identically', () => {
    // All three are the same CONFIGURATION state — nobody is listed — and
    // `AdminGuard` must fail closed on every one of them. Distinguishing them
    // would give a deploy that set `ADMIN_EMAILS=","` an open admin surface.
    const states = [undefined, '', '   ', ',', ',,,', ' , , '];
    for (const raw of states) {
      expect(isAdminAllowlistConfigured(config(raw))).toBe(false);
    }
  });
});

describe('isAdminEmail', () => {
  it.each<[string, string | undefined, string | null | undefined, boolean]>([
    ['listed', 'admin@example.com', 'admin@example.com', true],
    ['listed, different case', 'Admin@Example.com', 'admin@EXAMPLE.com', true],
    [
      'listed among several, padded config',
      ' a@x.com , admin@example.com ',
      'admin@example.com',
      true,
    ],
    // The drift the five copies had ALREADY developed: two of them trimmed the
    // incoming address before comparing and three did not, so this exact input
    // was an admin on some surfaces and not on others.
    ['padded INPUT email', 'admin@example.com', '  admin@example.com  ', true],
    ['not listed', 'someone@example.com', 'admin@example.com', false],
    ['allowlist unset', undefined, 'admin@example.com', false],
    ['allowlist blank', '   ', 'admin@example.com', false],
    ['allowlist separators only', ',,,', 'admin@example.com', false],
    ['empty email', 'admin@example.com', '', false],
    ['whitespace email', 'admin@example.com', '   ', false],
    ['null email', 'admin@example.com', null, false],
    ['undefined email', 'admin@example.com', undefined, false],
  ])('%s -> %s', (_label, adminEmails, email, expected) => {
    expect(isAdminEmail(config(adminEmails), email)).toBe(expected);
  });

  it('NEVER throws, whatever the configuration', () => {
    // Four of the five callers are informational flags that authorize nothing.
    // A throw here would turn "no allowlist configured" into a 500 on a
    // member-facing endpoint — and `member.guard.spec.ts` specifically requires
    // that an unset allowlist does not block a legitimate paying member.
    for (const raw of [undefined, '', ',,,', 'a@b.com']) {
      for (const email of [undefined, null, '', 'a@b.com']) {
        expect(() => isAdminEmail(config(raw), email)).not.toThrow();
      }
    }
  });

  it('an empty allowlist entry can never be matched by an empty email', () => {
    // Belt and braces on the filter: if `.filter(Boolean)` were ever dropped,
    // `ADMIN_EMAILS=","` plus a user with no email would authenticate as admin.
    expect(isAdminEmail(config(','), '')).toBe(false);
    expect(isAdminEmail(config(', ,'), '   ')).toBe(false);
  });
});
