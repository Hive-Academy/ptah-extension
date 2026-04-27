import { ConfigService } from '@nestjs/config';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AdminApiKeyGuard } from '../../../license/guards/admin-api-key.guard';

/**
 * Unit tests for AdminApiKeyGuard (TASK_2025_294 W1.B4).
 *
 * Strategy: instantiate the guard directly with a mocked ConfigService,
 * then invoke `canActivate` with a minimal ExecutionContext stub that
 * exposes the request shape the guard reads (`request.headers['x-api-key']`).
 *
 * Contract under test:
 *   - Missing / non-string key → 401
 *   - Server-side missing ADMIN_API_KEY → 401 (config error)
 *   - Wrong key (same length, different content) → 401
 *   - Wrong key (different length) → 401 (hash-based comparison normalises length)
 *   - Correct key → returns true
 */

interface RequestShape {
  headers: Record<string, string | string[] | undefined>;
}

function makeContext(request: RequestShape): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T = unknown>() => request as unknown as T,
      getResponse: <T = unknown>() => ({}) as T,
      getNext: <T = unknown>() => (() => undefined) as unknown as T,
    }),
    // Unused surface — narrow to `any` locally to avoid plumbing the full
    // ExecutionContext interface (getArgs, getHandler, getClass, getType).
  } as unknown as ExecutionContext;
}

describe('AdminApiKeyGuard', () => {
  const VALID_KEY = 'super-secret-admin-key-0123456789';
  let config: jest.Mocked<ConfigService>;
  let guard: AdminApiKeyGuard;

  beforeEach(() => {
    config = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'ADMIN_API_KEY') return VALID_KEY;
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;
    guard = new AdminApiKeyGuard(config);
  });

  it('returns true when x-api-key header matches ADMIN_API_KEY exactly', () => {
    const ctx = makeContext({ headers: { 'x-api-key': VALID_KEY } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws UnauthorizedException when x-api-key header is missing', () => {
    const ctx = makeContext({ headers: {} });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx)).toThrow('Invalid API key');
  });

  it('throws UnauthorizedException when x-api-key header is not a string (array)', () => {
    const ctx = makeContext({
      headers: { 'x-api-key': ['key-a', 'key-b'] },
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when provided key is wrong but same length', () => {
    // Same length to confirm the comparison is content-sensitive (not length-only).
    const wrong = 'super-secret-admin-key-XXXXXXXXXX';
    expect(wrong.length).toBe(VALID_KEY.length);
    const ctx = makeContext({ headers: { 'x-api-key': wrong } });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx)).toThrow('Invalid API key');
  });

  it('throws UnauthorizedException when provided key has wrong length', () => {
    // Guard uses hash-based comparison, so mismatched lengths must not crash
    // `timingSafeEqual` — they must be rejected cleanly via hash inequality.
    const ctx = makeContext({ headers: { 'x-api-key': 'short' } });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx)).toThrow('Invalid API key');
  });

  it('throws server-configuration error when ADMIN_API_KEY env var is missing', () => {
    config.get.mockReturnValue(undefined);
    const ctx = makeContext({ headers: { 'x-api-key': 'anything' } });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx)).toThrow(
      'Server configuration error: ADMIN_API_KEY not set',
    );
  });

  it('throws server-configuration error when ADMIN_API_KEY is an empty string', () => {
    config.get.mockReturnValue('');
    const ctx = makeContext({ headers: { 'x-api-key': 'anything' } });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx)).toThrow(
      'Server configuration error: ADMIN_API_KEY not set',
    );
  });

  it('reads ADMIN_API_KEY from ConfigService (not raw process.env)', () => {
    const ctx = makeContext({ headers: { 'x-api-key': VALID_KEY } });
    guard.canActivate(ctx);
    expect(config.get).toHaveBeenCalledWith('ADMIN_API_KEY');
  });
});
