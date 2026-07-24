/**
 * Unit tests for `DiscourseSsoService` — the pure DiscourseConnect codec.
 *
 * Focus:
 *   1. Sign → validate round-trip (a payload we sign validates back, nonce intact).
 *   2. Tamper rejection (any mutation of sso or sig fails the constant-time check).
 *   3. Inbound nonce + return_sso_url passthrough from a Discourse-signed request.
 *   4. add_groups vs remove_groups depending on membership.
 *   5. Feature-off (no secret) rejects everything.
 */

import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { DiscourseSsoService } from './discourse-sso.service';

const SECRET = 'super-secret-discourse-connect-key';

// NB: `null` (not `undefined`) marks the feature-off case — passing `undefined`
// would trigger the `= SECRET` default parameter.
function buildService(secret: string | null = SECRET): DiscourseSsoService {
  const config = {
    get: (key: string): unknown =>
      key === 'DISCOURSE_SSO_SECRET' ? (secret ?? undefined) : undefined,
  } as unknown as ConfigService;
  return new DiscourseSsoService(config);
}

/** Sign an arbitrary querystring the way Discourse would (b64 + hex HMAC). */
function signInbound(
  params: Record<string, string>,
  secret = SECRET,
): { sso: string; sig: string } {
  const qs = new URLSearchParams(params).toString();
  const sso = Buffer.from(qs, 'utf8').toString('base64');
  const sig = createHmac('sha256', secret).update(sso).digest('hex');
  return { sso, sig };
}

describe('DiscourseSsoService', () => {
  describe('isEnabled', () => {
    it('is enabled when the secret is set, disabled otherwise', () => {
      expect(buildService(SECRET).isEnabled()).toBe(true);
      expect(buildService(null).isEnabled()).toBe(false);
    });
  });

  describe('parseAndValidate', () => {
    it('validates a correctly signed inbound request and returns nonce + return_sso_url', () => {
      const svc = buildService();
      const { sso, sig } = signInbound({
        nonce: 'nonce-abc-123',
        return_sso_url: 'https://forum.ptah.live/session/sso_login',
      });

      const result = svc.parseAndValidate(sso, sig);

      expect(result).toEqual({
        nonce: 'nonce-abc-123',
        returnSsoUrl: 'https://forum.ptah.live/session/sso_login',
      });
    });

    it('rejects a tampered sso payload (sig no longer matches)', () => {
      const svc = buildService();
      const { sso, sig } = signInbound({ nonce: 'n1' });
      // Flip the payload but keep the original sig.
      const tampered = Buffer.from('nonce=evil', 'utf8').toString('base64');

      expect(svc.parseAndValidate(tampered, sig)).toBeNull();
      // And a mutated sig against a valid payload is rejected too. Flip the
      // last hex char deterministically so the mutation is always real.
      const mutatedSig = sig.slice(0, -1) + (sig.slice(-1) === '0' ? '1' : '0');
      expect(svc.parseAndValidate(sso, mutatedSig)).toBeNull();
    });

    it('rejects when sig is signed with the wrong secret', () => {
      const svc = buildService();
      const { sso, sig } = signInbound({ nonce: 'n1' }, 'a-different-secret');
      expect(svc.parseAndValidate(sso, sig)).toBeNull();
    });

    it('rejects a valid signature whose payload has no nonce', () => {
      const svc = buildService();
      const { sso, sig } = signInbound({ foo: 'bar' });
      expect(svc.parseAndValidate(sso, sig)).toBeNull();
    });

    it('rejects when sso or sig is missing', () => {
      const svc = buildService();
      expect(svc.parseAndValidate(undefined, 'x')).toBeNull();
      expect(svc.parseAndValidate('x', undefined)).toBeNull();
    });

    it('rejects everything in feature-off mode (no secret)', () => {
      const svc = buildService(null);
      const { sso, sig } = signInbound({ nonce: 'n1' });
      expect(svc.parseAndValidate(sso, sig)).toBeNull();
    });
  });

  describe('buildResponse', () => {
    it('round-trips: a built response validates and preserves the nonce', () => {
      const svc = buildService();
      const { sso, sig } = svc.buildResponse({
        nonce: 'nonce-round-trip',
        externalId: 'usr_42',
        email: 'buyer@example.com',
        name: 'Buyer Example',
        isBuilders: true,
      });

      const back = svc.parseAndValidate(sso, sig);
      expect(back?.nonce).toBe('nonce-round-trip');

      const decoded = new URLSearchParams(
        Buffer.from(sso, 'base64').toString('utf8'),
      );
      expect(decoded.get('external_id')).toBe('usr_42');
      expect(decoded.get('email')).toBe('buyer@example.com');
      expect(decoded.get('name')).toBe('Buyer Example');
    });

    it('asserts add_groups=builders for members', () => {
      const svc = buildService();
      const { sso } = svc.buildResponse({
        nonce: 'n',
        externalId: 'u',
        email: 'e@x.com',
        name: 'E',
        isBuilders: true,
      });
      const decoded = new URLSearchParams(
        Buffer.from(sso, 'base64').toString('utf8'),
      );
      expect(decoded.get('add_groups')).toBe('builders');
      expect(decoded.get('remove_groups')).toBeNull();
    });

    it('asserts remove_groups=builders for non-members (actively pulls lapsed users out)', () => {
      const svc = buildService();
      const { sso } = svc.buildResponse({
        nonce: 'n',
        externalId: 'u',
        email: 'e@x.com',
        name: 'E',
        isBuilders: false,
      });
      const decoded = new URLSearchParams(
        Buffer.from(sso, 'base64').toString('utf8'),
      );
      expect(decoded.get('remove_groups')).toBe('builders');
      expect(decoded.get('add_groups')).toBeNull();
    });

    it('produces a hex HMAC sig of the base64 sso payload', () => {
      const svc = buildService();
      const { sso, sig } = svc.buildResponse({
        nonce: 'n',
        externalId: 'u',
        email: 'e@x.com',
        name: 'E',
        isBuilders: true,
      });
      const expected = createHmac('sha256', SECRET).update(sso).digest('hex');
      expect(sig).toBe(expected);
    });
  });
});
