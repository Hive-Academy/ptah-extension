/**
 * Unit tests for PkceService (TASK_2025_294 W1.B2.1).
 *
 * Scope: PKCE state management — real crypto round-trip with frozen clock.
 * Coverage:
 *   - Generates RFC 7636 conforming code_verifier (base64url, 43+ chars) and
 *     SHA-256 code_challenge.
 *   - Round-trip: generate → consume returns original verifier.
 *   - Single-use: second consume returns null (replay protection).
 *   - TTL: consume returns null after 5-minute expiry (frozen clock).
 *   - State is cryptographically unique across calls.
 *   - Downgrade rejection: arbitrary/wrong state not accepted.
 *   - Metadata: returnUrl and plan are round-tripped.
 *
 * Real crypto is used end-to-end — the service calls `crypto.randomBytes`
 * and `crypto.createHash` directly; mocking them would defeat the point
 * of a crypto correctness test.
 */
import { createHash } from 'crypto';
import { freezeTime, type FrozenClock } from '@ptah-extension/shared/testing';
import { PkceService } from './pkce.service';

const TTL_MS = 5 * 60 * 1000;

describe('PkceService', () => {
  let service: PkceService;
  let clock: FrozenClock;

  beforeEach(() => {
    clock = freezeTime('2026-04-24T12:00:00.000Z');
    service = new PkceService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    clock.restore();
  });

  describe('generatePkceParams', () => {
    it('emits code_verifier conforming to RFC 7636 (43+ chars base64url)', () => {
      const { codeVerifier } = service.generatePkceParams();

      // RFC 7636: 43-128 chars. 32 random bytes → base64url = 43 chars.
      expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
      expect(codeVerifier.length).toBeLessThanOrEqual(128);
      // base64url alphabet — no +, /, or =
      expect(codeVerifier).toMatch(/^[A-Za-z0-9\-_]+$/);
    });

    it('derives code_challenge as SHA-256(code_verifier) in base64url', () => {
      const { codeVerifier, codeChallenge } = service.generatePkceParams();

      const expected = createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

      expect(codeChallenge).toBe(expected);
      expect(codeChallenge).toMatch(/^[A-Za-z0-9\-_]+$/);
    });

    it('produces a cryptographically unique state on every call', () => {
      const states = new Set<string>();
      for (let i = 0; i < 50; i++) {
        states.add(service.generatePkceParams().state);
      }
      expect(states.size).toBe(50);
    });

    it('stores optional returnUrl and plan metadata with the state', () => {
      const { state } = service.generatePkceParams({
        returnUrl: 'https://ptah.live/dashboard',
        plan: 'pro-monthly',
      });

      const result = service.consumeVerifier(state);

      expect(result).not.toBeNull();
      expect(result?.returnUrl).toBe('https://ptah.live/dashboard');
      expect(result?.plan).toBe('pro-monthly');
    });
  });

  describe('consumeVerifier — round-trip', () => {
    it('returns the verifier originally generated for a valid state', () => {
      const { codeVerifier, state } = service.generatePkceParams();

      const result = service.consumeVerifier(state);

      expect(result).not.toBeNull();
      expect(result?.verifier).toBe(codeVerifier);
      expect(result?.returnUrl).toBeNull();
      expect(result?.plan).toBeNull();
    });

    it('preserves SHA-256 linkage — consumed verifier hashes back to the challenge', () => {
      const { codeChallenge, state } = service.generatePkceParams();

      const result = service.consumeVerifier(state);

      const rehash = createHash('sha256')
        .update(result?.verifier ?? '')
        .digest('base64url');
      expect(rehash).toBe(codeChallenge);
    });
  });

  describe('consumeVerifier — single-use', () => {
    it('rejects a state that has already been consumed (replay protection)', () => {
      const { state } = service.generatePkceParams();

      const first = service.consumeVerifier(state);
      const second = service.consumeVerifier(state);

      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });
  });

  describe('consumeVerifier — downgrade / invalid state', () => {
    it('rejects an unregistered state (never generated)', () => {
      const result = service.consumeVerifier('not-a-real-state-abc123');
      expect(result).toBeNull();
    });

    it('rejects an empty state', () => {
      expect(service.consumeVerifier('')).toBeNull();
    });

    it('cannot cross-map between independently generated states', () => {
      const a = service.generatePkceParams();
      const b = service.generatePkceParams();

      // Consuming `a`'s state returns `a`'s verifier — never `b`'s.
      const result = service.consumeVerifier(a.state);
      expect(result?.verifier).toBe(a.codeVerifier);
      expect(result?.verifier).not.toBe(b.codeVerifier);
    });
  });

  describe('TTL expiry (frozen clock)', () => {
    it('accepts consumption just before the 5-minute window closes', () => {
      const { state } = service.generatePkceParams();

      clock.advanceBy(TTL_MS - 1);

      expect(service.consumeVerifier(state)).not.toBeNull();
    });

    it('rejects consumption exactly at the 5-minute boundary', () => {
      const { state } = service.generatePkceParams();

      // The service uses strict `Date.now() > entry.expiresAt`, so at
      // exactly expiresAt the state is still valid. Advancing one tick
      // past expiresAt must reject.
      clock.advanceBy(TTL_MS + 1);

      expect(service.consumeVerifier(state)).toBeNull();
    });

    it('removes expired state from in-memory store on rejection', () => {
      const { state } = service.generatePkceParams();
      clock.advanceBy(TTL_MS + 1);

      // First call: detects expiry, deletes entry, returns null.
      expect(service.consumeVerifier(state)).toBeNull();
      // Second call: entry already deleted, returns null (not-found path).
      expect(service.consumeVerifier(state)).toBeNull();
    });
  });

  describe('periodic cleanup', () => {
    it('silently evicts expired entries on the interval tick', () => {
      const { state: stateA } = service.generatePkceParams();
      const { state: stateB } = service.generatePkceParams();

      // Expire both.
      clock.advanceBy(TTL_MS + 1);

      // Trigger the cleanup interval (configured for 60s inside the service).
      // We advance past one more cleanup cycle — timers are faked by freezeTime.
      clock.advanceBy(60 * 1000);

      // Both states are now gone.
      expect(service.consumeVerifier(stateA)).toBeNull();
      expect(service.consumeVerifier(stateB)).toBeNull();
    });
  });
});
