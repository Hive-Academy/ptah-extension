import { ConfigService } from '@nestjs/config';
import { DiscourseController } from './discourse.controller';

/**
 * Direct unit coverage for the security-sensitive `isAdminEmail` allowlist
 * parser on DiscourseController — the code that decides whether the SSO payload
 * asserts Discourse `admin`/`moderator`. `discourse-sso.service.spec.ts` only
 * exercises `buildResponse` given a precomputed boolean, so without this the
 * parse/match logic (comma-split, trim, case-insensitivity, fail-closed) has no
 * direct test. `isAdminEmail` is private; we reach it via a typed cast — it only
 * depends on ConfigService, so the other collaborators are irrelevant stubs.
 */
describe('DiscourseController.isAdminEmail', () => {
  function makeController(
    adminEmails: string | undefined,
  ): DiscourseController {
    const configService = {
      get: (key: string) => (key === 'ADMIN_EMAILS' ? adminEmails : undefined),
    } as unknown as ConfigService;

    return new DiscourseController(
      {} as never, // ssoService — unused by isAdminEmail
      {} as never, // authService — unused
      {} as never, // prisma — unused
      configService,
    );
  }

  function isAdmin(controller: DiscourseController, email: string): boolean {
    return (
      controller as unknown as { isAdminEmail(email: string): boolean }
    ).isAdminEmail(email);
  }

  it('matches an allowlisted email', () => {
    const c = makeController('abdallah@miramarstaffing.com,other@example.com');
    expect(isAdmin(c, 'abdallah@miramarstaffing.com')).toBe(true);
    expect(isAdmin(c, 'other@example.com')).toBe(true);
  });

  it('is case-insensitive on both sides', () => {
    const c = makeController('Admin@Example.com');
    expect(isAdmin(c, 'admin@example.com')).toBe(true);
    expect(isAdmin(c, 'ADMIN@EXAMPLE.COM')).toBe(true);
  });

  it('tolerates surrounding whitespace in the list and the input', () => {
    const c = makeController('  a@x.com ,  b@y.com  ');
    expect(isAdmin(c, '  a@x.com ')).toBe(true);
    expect(isAdmin(c, 'b@y.com')).toBe(true);
  });

  it('returns false for an email not in the list', () => {
    const c = makeController('admin@example.com');
    expect(isAdmin(c, 'nobody@example.com')).toBe(false);
  });

  it('fails closed (false, no throw) when ADMIN_EMAILS is unset', () => {
    const c = makeController(undefined);
    expect(() => isAdmin(c, 'admin@example.com')).not.toThrow();
    expect(isAdmin(c, 'admin@example.com')).toBe(false);
  });

  it('fails closed when ADMIN_EMAILS is empty / separators only', () => {
    expect(isAdmin(makeController(''), 'admin@example.com')).toBe(false);
    expect(isAdmin(makeController('   '), 'admin@example.com')).toBe(false);
    expect(isAdmin(makeController(',,,'), 'admin@example.com')).toBe(false);
  });
});
