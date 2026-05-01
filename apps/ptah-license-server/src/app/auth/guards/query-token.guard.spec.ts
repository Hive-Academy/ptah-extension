import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { RequestUser } from '../interfaces/request-user.interface';
import { AuthService } from '../services/auth.service';
import { TicketService } from '../services/token/ticket.service';
import { QueryTokenAuthGuard } from './query-token.guard';

/**
 * Unit tests for QueryTokenAuthGuard (TASK_2025_294 W1.B4).
 *
 * Dual-mode guard:
 *   1. Short-lived ticket: `ticketService.validateAndConsume(token)` returns
 *      `{ userId, tenantId }` on success, or `null` if not a ticket.
 *   2. JWT fallback: `authService.validateToken(token)` resolves with the
 *      full RequestUser.
 *
 * Contract under test:
 *   - Missing `?token=` → 401 "Missing query token"
 *   - Valid ticket → returns true; request.user = { userId, tenantId }
 *   - Invalid ticket (null) + valid JWT → returns true; request.user = RequestUser
 *   - Invalid ticket + JWT throws → 401 "Invalid or expired token"
 *   - Ticket service throws (replay / expired) → 401 "Invalid or expired token"
 */

interface RequestWithQuery {
  query: Record<string, unknown>;
  user?: unknown;
}

function makeContext(request: RequestWithQuery): ExecutionContext {
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
    ...overrides,
  } as unknown as RequestUser;
}

describe('QueryTokenAuthGuard', () => {
  let authService: jest.Mocked<AuthService>;
  let ticketService: jest.Mocked<TicketService>;
  let guard: QueryTokenAuthGuard;

  beforeEach(() => {
    authService = {
      validateToken: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;
    ticketService = {
      validateAndConsume: jest.fn(),
    } as unknown as jest.Mocked<TicketService>;
    guard = new QueryTokenAuthGuard(authService, ticketService);
  });

  it('throws UnauthorizedException("Missing query token") when ?token is absent', async () => {
    const request: RequestWithQuery = { query: {} };

    await expect(
      guard.canActivate(makeContext(request)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      'Missing query token',
    );
    expect(ticketService.validateAndConsume).not.toHaveBeenCalled();
    expect(authService.validateToken).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when ?token is an empty string', async () => {
    const request: RequestWithQuery = { query: { token: '' } };

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      'Missing query token',
    );
    expect(ticketService.validateAndConsume).not.toHaveBeenCalled();
    expect(authService.validateToken).not.toHaveBeenCalled();
  });

  it('returns true and attaches ticket user context when ticket is valid', async () => {
    ticketService.validateAndConsume.mockResolvedValueOnce({
      userId: 'user-xyz',
      tenantId: 'tenant-9',
      email: 'bob@example.com',
    });
    const request: RequestWithQuery = {
      query: { token: 'ticket_abc123' },
    };

    const result = await guard.canActivate(makeContext(request));

    expect(result).toBe(true);
    expect(ticketService.validateAndConsume).toHaveBeenCalledWith(
      'ticket_abc123',
    );
    expect(authService.validateToken).not.toHaveBeenCalled();
    expect(request.user).toEqual({
      userId: 'user-xyz',
      tenantId: 'tenant-9',
    });
  });

  it('falls back to JWT validation when ticket validation returns null', async () => {
    ticketService.validateAndConsume.mockResolvedValueOnce(null);
    const user = makeRequestUser();
    authService.validateToken.mockResolvedValueOnce(user);
    const request: RequestWithQuery = {
      query: { token: 'jwt.signed.token' },
    };

    const result = await guard.canActivate(makeContext(request));

    expect(result).toBe(true);
    expect(ticketService.validateAndConsume).toHaveBeenCalledWith(
      'jwt.signed.token',
    );
    expect(authService.validateToken).toHaveBeenCalledWith('jwt.signed.token');
    expect(request.user).toBe(user);
  });

  it('throws UnauthorizedException("Invalid or expired token") when ticket null AND JWT invalid', async () => {
    ticketService.validateAndConsume.mockResolvedValue(null);
    authService.validateToken.mockRejectedValue(new Error('jwt malformed'));
    const request: RequestWithQuery = { query: { token: 'bogus' } };

    await expect(
      guard.canActivate(makeContext(request)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      'Invalid or expired token',
    );
    expect(request.user).toBeUndefined();
  });

  it('rewraps ticket-service rejection as "Invalid or expired token" (no leakage)', async () => {
    // Important: the guard must NOT surface the inner error's message —
    // it always says "Invalid or expired token" so consumers can't
    // distinguish ticket-replay from expiry from generic failure.
    ticketService.validateAndConsume.mockRejectedValue(
      new Error('ticket already consumed'),
    );
    const request: RequestWithQuery = { query: { token: 'replayed_ticket' } };

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      'Invalid or expired token',
    );
    await expect(guard.canActivate(makeContext(request))).rejects.not.toThrow(
      'ticket already consumed',
    );
    expect(authService.validateToken).not.toHaveBeenCalled();
  });

  it('rejects JWT that AuthService deems expired with the generic message', async () => {
    ticketService.validateAndConsume.mockResolvedValueOnce(null);
    authService.validateToken.mockRejectedValueOnce(new Error('jwt expired'));
    const request: RequestWithQuery = {
      query: { token: 'expired.jwt.token' },
    };

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      'Invalid or expired token',
    );
  });
});
