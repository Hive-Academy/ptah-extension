import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { RequestUser } from '../interfaces/request-user.interface';
import { AuthService } from '../services/auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Unit tests for JwtAuthGuard (TASK_2025_294 W1.B4).
 *
 * Strategy: instantiate the guard with a mocked AuthService whose
 * `validateToken` we can resolve or reject per test. The guard only reads
 * `request.cookies['ptah_auth']` and writes `request.user` on success, so
 * an ExecutionContext stub exposing `switchToHttp().getRequest()` is
 * sufficient — no full @nestjs/testing module needed.
 *
 * Contract under test:
 *   - Missing `ptah_auth` cookie → 401 with setup-friendly message
 *   - `validateToken` throws (expired / tampered / invalid) → 401 wraps error
 *   - Valid token → returns true and mutates `request.user` with the
 *     RequestUser returned by AuthService.validateToken
 */

interface RequestWithCookies {
  cookies?: Record<string, string | undefined>;
  user?: unknown;
}
// Intentional: we model only the fields the guard touches. The guard calls
// `getRequest<Request>()` internally, so our stub is cast once at the
// boundary via `makeContext`.

function makeContext(request: RequestWithCookies): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T = unknown>() => request as unknown as T,
      getResponse: <T = unknown>() => ({}) as T,
      getNext: <T = unknown>() => (() => undefined) as unknown as T,
    }),
  } as unknown as ExecutionContext;
}

function makeRequestUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 'user-abc',
    email: 'alice@example.com',
    tenantId: 'tenant-1',
    roles: ['user'],
    permissions: [],
    subscriptionTier: 'community',
    organizationId: undefined,
    ...overrides,
  } as unknown as RequestUser;
}

describe('JwtAuthGuard', () => {
  let authService: jest.Mocked<AuthService>;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    authService = {
      validateToken: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;
    guard = new JwtAuthGuard(authService);
  });

  it('attaches user to request and returns true when ptah_auth cookie is valid', async () => {
    const user = makeRequestUser();
    authService.validateToken.mockResolvedValueOnce(user);
    const request: RequestWithCookies = {
      cookies: { ptah_auth: 'valid.jwt.token' },
    };

    const result = await guard.canActivate(makeContext(request));

    expect(result).toBe(true);
    expect(authService.validateToken).toHaveBeenCalledWith('valid.jwt.token');
    expect(request.user).toBe(user);
  });

  it('throws UnauthorizedException with login hint when ptah_auth cookie is missing', async () => {
    const request: RequestWithCookies = { cookies: {} };

    const promise = guard.canActivate(makeContext(request));
    await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      'No authentication token provided. Please login.',
    );
    expect(authService.validateToken).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when cookies are entirely absent on the request', async () => {
    // Some requests (e.g. initial requests before cookie-parser runs) arrive
    // without a cookies property at all — the optional chain must handle this.
    const request: RequestWithCookies = {};

    await expect(
      guard.canActivate(makeContext(request)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authService.validateToken).not.toHaveBeenCalled();
  });

  it('wraps expired-token rejection from AuthService in UnauthorizedException', async () => {
    // Persistent rejection (not mockRejectedValueOnce) so both expects see it.
    authService.validateToken.mockRejectedValue(new Error('jwt expired'));
    const request: RequestWithCookies = {
      cookies: { ptah_auth: 'expired.jwt.token' },
    };

    await expect(
      guard.canActivate(makeContext(request)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      'Authentication failed: jwt expired',
    );
    expect(request.user).toBeUndefined();
  });

  it('wraps tampered-signature rejection from AuthService in UnauthorizedException', async () => {
    authService.validateToken.mockRejectedValue(new Error('invalid signature'));
    const request: RequestWithCookies = {
      cookies: { ptah_auth: 'tampered.jwt.token' },
    };

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      'Authentication failed: invalid signature',
    );
    expect(request.user).toBeUndefined();
  });

  it('does not mutate request.user if validateToken rejects', async () => {
    authService.validateToken.mockRejectedValueOnce(new Error('malformed'));
    const request: RequestWithCookies = {
      cookies: { ptah_auth: 'malformed' },
      user: undefined,
    };

    await expect(
      guard.canActivate(makeContext(request)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(request.user).toBeUndefined();
  });
});
