/**
 * Unit tests for AuthService (TASK_2025_294 W1.B2.1).
 *
 * Scope: Orchestration layer that coordinates PkceService, WorkosUserService,
 * JwtTokenService, and UserSyncService. We test the branches — crypto
 * correctness is covered in the dedicated token-service specs.
 *
 * Strategy: all collaborators are `jest.Mocked<T>` — no `any`. This spec
 * exercises the happy paths and the failure / security branches.
 *
 * Coverage:
 *   - getAuthorizationUrl / getOAuthAuthorizationUrl — PKCE + WorkOS plumbing.
 *   - authenticateWithCode — successful login, expired / invalid PKCE state,
 *     syncUser → JWT generation pipeline, returnUrl/plan propagation.
 *   - authenticateWithPassword — successful login, wrong credentials bubble
 *     up as UnauthorizedException, email_verification_required branch.
 *   - verifyEmailCode — WorkOS verify → sync → JWT.
 *   - createUserWithPassword — triggers sendVerificationEmail.
 *   - validateToken / generateJwtToken — delegation to JwtTokenService.
 */
import type { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import type { User } from '@workos-inc/node';
import { AuthService } from './auth.service';
import type { PkceService } from './token/pkce.service';
import type { JwtTokenService } from './token/jwt-token.service';
import type { WorkosUserService } from './workos/workos-user.service';
import type { UserSyncService } from './sync/user-sync.service';
import type { RequestUser } from '../interfaces/request-user.interface';

const DB_USER_ID = '00000000-0000-4000-8000-0000000000AA';
const WORKOS_USER_ID = 'user_01HABCDEF';

function makeWorkOSUser(overrides: Partial<User> = {}): User {
  return {
    id: WORKOS_USER_ID,
    email: 'user@example.com',
    emailVerified: true,
    firstName: null,
    lastName: null,
    object: 'user',
    profilePictureUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastSignInAt: null,
    externalId: null,
    metadata: {},
    ...overrides,
  } as unknown as User;
}

function makeRequestUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: DB_USER_ID,
    email: 'user@example.com',
    tenantId: `user_${DB_USER_ID}`,
    organizationId: undefined,
    roles: ['user'],
    permissions: ['read:docs', 'write:docs'],
    tier: 'community',
    ...overrides,
  };
}

// ConfigService.get is generic with multiple overloads; spec only needs the
// 1-arg form. A minimal local type avoids clashing with NestJS's overload set.
type MockConfig = { get: jest.Mock };

describe('AuthService', () => {
  let config: MockConfig;
  let pkce: jest.Mocked<
    Pick<PkceService, 'generatePkceParams' | 'consumeVerifier'>
  >;
  let workos: jest.Mocked<
    Pick<
      WorkosUserService,
      | 'getAuthorizationUrl'
      | 'getOAuthAuthorizationUrl'
      | 'authenticateWithCode'
      | 'authenticateWithPassword'
      | 'createUser'
      | 'verifyEmail'
      | 'sendVerificationEmail'
    >
  >;
  let jwtToken: jest.Mocked<
    Pick<
      JwtTokenService,
      | 'generateToken'
      | 'generateTokenFromPayload'
      | 'mapWorkOSUserToRequestUser'
      | 'validateToken'
    >
  >;
  let sync: jest.Mocked<Pick<UserSyncService, 'syncUser'>>;
  let service: AuthService;

  beforeEach(() => {
    config = {
      get: jest.fn((key: string) => {
        if (key === 'WORKOS_REDIRECT_URI') return 'https://ptah.live/callback';
        return undefined;
      }),
    };

    pkce = {
      generatePkceParams: jest.fn(),
      consumeVerifier: jest.fn(),
    } as jest.Mocked<
      Pick<PkceService, 'generatePkceParams' | 'consumeVerifier'>
    >;

    workos = {
      getAuthorizationUrl: jest.fn(),
      getOAuthAuthorizationUrl: jest.fn(),
      authenticateWithCode: jest.fn(),
      authenticateWithPassword: jest.fn(),
      createUser: jest.fn(),
      verifyEmail: jest.fn(),
      sendVerificationEmail: jest.fn(),
    } as jest.Mocked<
      Pick<
        WorkosUserService,
        | 'getAuthorizationUrl'
        | 'getOAuthAuthorizationUrl'
        | 'authenticateWithCode'
        | 'authenticateWithPassword'
        | 'createUser'
        | 'verifyEmail'
        | 'sendVerificationEmail'
      >
    >;

    jwtToken = {
      generateToken: jest.fn(),
      generateTokenFromPayload: jest.fn(),
      mapWorkOSUserToRequestUser: jest.fn(),
      validateToken: jest.fn(),
    } as jest.Mocked<
      Pick<
        JwtTokenService,
        | 'generateToken'
        | 'generateTokenFromPayload'
        | 'mapWorkOSUserToRequestUser'
        | 'validateToken'
      >
    >;

    sync = { syncUser: jest.fn() } as jest.Mocked<
      Pick<UserSyncService, 'syncUser'>
    >;

    service = new AuthService(
      config as unknown as ConfigService,
      pkce as unknown as PkceService,
      workos as unknown as WorkosUserService,
      jwtToken as unknown as JwtTokenService,
      sync as unknown as UserSyncService,
    );
  });

  // ==========================================================================
  // AUTHORIZATION URLs
  // ==========================================================================

  describe('getAuthorizationUrl', () => {
    it('generates PKCE params and delegates to WorkosUserService', async () => {
      pkce.generatePkceParams.mockReturnValue({
        codeVerifier: 'verifier',
        codeChallenge: 'challenge',
        state: 'state-abc',
      });
      workos.getAuthorizationUrl.mockReturnValue(
        'https://auth.workos.com/authorize?...',
      );

      const result = await service.getAuthorizationUrl();

      expect(pkce.generatePkceParams).toHaveBeenCalledTimes(1);
      expect(workos.getAuthorizationUrl).toHaveBeenCalledWith(
        'https://ptah.live/callback',
        'state-abc',
        'challenge',
      );
      expect(result).toEqual({
        url: 'https://auth.workos.com/authorize?...',
        state: 'state-abc',
      });
    });
  });

  describe('getOAuthAuthorizationUrl', () => {
    it('passes returnUrl and plan into PKCE params for post-auth redirect', async () => {
      pkce.generatePkceParams.mockReturnValue({
        codeVerifier: 'verifier',
        codeChallenge: 'challenge',
        state: 'state-xyz',
      });
      workos.getOAuthAuthorizationUrl.mockReturnValue(
        'https://github.com/oauth/authorize?...',
      );

      const result = await service.getOAuthAuthorizationUrl(
        'github',
        'https://ptah.live/billing',
        'pro-monthly',
      );

      expect(pkce.generatePkceParams).toHaveBeenCalledWith({
        returnUrl: 'https://ptah.live/billing',
        plan: 'pro-monthly',
      });
      expect(workos.getOAuthAuthorizationUrl).toHaveBeenCalledWith(
        'github',
        'https://ptah.live/callback',
        'state-xyz',
        'challenge',
      );
      expect(result.state).toBe('state-xyz');
    });

    it('works without optional returnUrl / plan', async () => {
      pkce.generatePkceParams.mockReturnValue({
        codeVerifier: 'v',
        codeChallenge: 'c',
        state: 's',
      });
      workos.getOAuthAuthorizationUrl.mockReturnValue('https://google.com/...');

      const result = await service.getOAuthAuthorizationUrl('google');

      expect(pkce.generatePkceParams).toHaveBeenCalledWith({
        returnUrl: undefined,
        plan: undefined,
      });
      expect(result).toEqual({ url: 'https://google.com/...', state: 's' });
    });
  });

  // ==========================================================================
  // authenticateWithCode
  // ==========================================================================

  describe('authenticateWithCode', () => {
    it('completes the OAuth callback pipeline and returns token + user', async () => {
      pkce.consumeVerifier.mockReturnValue({
        verifier: 'verifier-42',
        returnUrl: 'https://ptah.live/dashboard',
        plan: null,
      });
      const workosUser = makeWorkOSUser();
      workos.authenticateWithCode.mockResolvedValue({
        type: 'success',
        user: workosUser,
        organizationId: undefined,
      });
      sync.syncUser.mockResolvedValue({
        id: DB_USER_ID,
        email: 'user@example.com',
      });
      jwtToken.generateToken.mockResolvedValue('signed.jwt.token');
      const mapped = makeRequestUser();
      jwtToken.mapWorkOSUserToRequestUser.mockResolvedValue(mapped);

      const result = await service.authenticateWithCode('auth-code', 'state-1');

      expect(pkce.consumeVerifier).toHaveBeenCalledWith('state-1');
      expect(workos.authenticateWithCode).toHaveBeenCalledWith(
        'auth-code',
        'verifier-42',
      );
      expect(sync.syncUser).toHaveBeenCalledWith(workosUser);
      expect(jwtToken.generateToken).toHaveBeenCalledWith(
        DB_USER_ID,
        workosUser,
        undefined,
      );
      expect(result).toEqual({
        token: 'signed.jwt.token',
        user: mapped,
        returnUrl: 'https://ptah.live/dashboard',
        plan: null,
      });
    });

    it('throws UnauthorizedException when PKCE state is invalid / expired', async () => {
      pkce.consumeVerifier.mockReturnValue(null);

      await expect(
        service.authenticateWithCode('auth-code', 'bad-state'),
      ).rejects.toThrow(UnauthorizedException);

      expect(workos.authenticateWithCode).not.toHaveBeenCalled();
      expect(sync.syncUser).not.toHaveBeenCalled();
      expect(jwtToken.generateToken).not.toHaveBeenCalled();
    });

    it('propagates returnUrl and plan from PKCE state into the result', async () => {
      pkce.consumeVerifier.mockReturnValue({
        verifier: 'v',
        returnUrl: 'https://ptah.live/billing',
        plan: 'pro-yearly',
      });
      workos.authenticateWithCode.mockResolvedValue({
        type: 'success',
        user: makeWorkOSUser(),
      });
      sync.syncUser.mockResolvedValue({
        id: DB_USER_ID,
        email: 'user@example.com',
      });
      jwtToken.generateToken.mockResolvedValue('t');
      jwtToken.mapWorkOSUserToRequestUser.mockResolvedValue(makeRequestUser());

      const result = await service.authenticateWithCode('code', 'state');

      expect(result.returnUrl).toBe('https://ptah.live/billing');
      expect(result.plan).toBe('pro-yearly');
    });

    it('uses the DATABASE user id when generating JWT — never the WorkOS id', async () => {
      pkce.consumeVerifier.mockReturnValue({
        verifier: 'v',
        returnUrl: null,
        plan: null,
      });
      workos.authenticateWithCode.mockResolvedValue({
        type: 'success',
        user: makeWorkOSUser(),
      });
      sync.syncUser.mockResolvedValue({
        id: DB_USER_ID,
        email: 'user@example.com',
      });
      jwtToken.generateToken.mockResolvedValue('t');
      jwtToken.mapWorkOSUserToRequestUser.mockResolvedValue(makeRequestUser());

      await service.authenticateWithCode('code', 'state');

      const [subject] = jwtToken.generateToken.mock.calls[0];
      expect(subject).toBe(DB_USER_ID);
      expect(subject).not.toBe(WORKOS_USER_ID);
    });
  });

  // ==========================================================================
  // authenticateWithPassword
  // ==========================================================================

  describe('authenticateWithPassword', () => {
    it('returns token + user on success', async () => {
      const workosUser = makeWorkOSUser();
      workos.authenticateWithPassword.mockResolvedValue({
        type: 'success',
        user: workosUser,
      });
      sync.syncUser.mockResolvedValue({
        id: DB_USER_ID,
        email: 'user@example.com',
      });
      jwtToken.generateToken.mockResolvedValue('signed.jwt');
      const mapped = makeRequestUser();
      jwtToken.mapWorkOSUserToRequestUser.mockResolvedValue(mapped);

      const result = await service.authenticateWithPassword(
        'user@example.com',
        'hunter2',
      );

      expect(workos.authenticateWithPassword).toHaveBeenCalledWith(
        'user@example.com',
        'hunter2',
      );
      expect(sync.syncUser).toHaveBeenCalledWith(workosUser);
      expect(result).toEqual({ token: 'signed.jwt', user: mapped });
    });

    it('bubbles WorkOS UnauthorizedException for wrong credentials', async () => {
      workos.authenticateWithPassword.mockRejectedValue(
        new UnauthorizedException('Invalid email or password'),
      );

      await expect(
        service.authenticateWithPassword('user@example.com', 'wrong'),
      ).rejects.toThrow(UnauthorizedException);

      expect(sync.syncUser).not.toHaveBeenCalled();
      expect(jwtToken.generateToken).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException with verification payload when email unverified', async () => {
      workos.authenticateWithPassword.mockResolvedValue({
        type: 'email_verification_required',
        userId: WORKOS_USER_ID,
        email: 'unverified@example.com',
      });

      await expect(
        service.authenticateWithPassword('unverified@example.com', 'hunter2'),
      ).rejects.toMatchObject({
        constructor: UnauthorizedException,
      });

      // Confirm payload is a JSON-encoded object with the expected fields.
      try {
        await service.authenticateWithPassword(
          'unverified@example.com',
          'hunter2',
        );
        throw new Error('should have thrown');
      } catch (err) {
        const exc = err as UnauthorizedException;
        const response = exc.getResponse();
        const message =
          typeof response === 'string'
            ? response
            : ((response as { message: string }).message ?? '');
        const parsed = JSON.parse(message);
        expect(parsed).toEqual({
          code: 'email_verification_required',
          userId: WORKOS_USER_ID,
          email: 'unverified@example.com',
          message: expect.stringContaining('verify your email'),
        });
      }

      expect(sync.syncUser).not.toHaveBeenCalled();
      expect(jwtToken.generateToken).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // createUserWithPassword
  // ==========================================================================

  describe('createUserWithPassword', () => {
    it('creates, syncs, and sends verification email — returns pending status', async () => {
      const newUser = makeWorkOSUser({ id: 'user_new', emailVerified: false });
      workos.createUser.mockResolvedValue(newUser);
      sync.syncUser.mockResolvedValue({ id: DB_USER_ID, email: newUser.email });
      workos.sendVerificationEmail.mockResolvedValue(undefined);

      const result = await service.createUserWithPassword(
        'new@example.com',
        'hunter2',
        'New',
        'User',
      );

      expect(workos.createUser).toHaveBeenCalledWith(
        'new@example.com',
        'hunter2',
        'New',
        'User',
      );
      expect(sync.syncUser).toHaveBeenCalledWith(newUser);
      expect(workos.sendVerificationEmail).toHaveBeenCalledWith('user_new');
      expect(result).toEqual({
        userId: 'user_new',
        email: newUser.email,
        pendingVerification: true,
      });
    });
  });

  // ==========================================================================
  // verifyEmailCode
  // ==========================================================================

  describe('verifyEmailCode', () => {
    it('verifies the code, syncs, and issues a JWT', async () => {
      const verified = makeWorkOSUser({ emailVerified: true });
      workos.verifyEmail.mockResolvedValue(verified);
      sync.syncUser.mockResolvedValue({
        id: DB_USER_ID,
        email: verified.email,
      });
      jwtToken.generateToken.mockResolvedValue('jwt');
      const mapped = makeRequestUser();
      jwtToken.mapWorkOSUserToRequestUser.mockResolvedValue(mapped);

      const result = await service.verifyEmailCode(WORKOS_USER_ID, '123456');

      expect(workos.verifyEmail).toHaveBeenCalledWith(WORKOS_USER_ID, '123456');
      expect(result).toEqual({ token: 'jwt', user: mapped });
    });
  });

  describe('resendVerificationCode', () => {
    it('delegates to WorkOS and returns success', async () => {
      workos.sendVerificationEmail.mockResolvedValue(undefined);

      const result = await service.resendVerificationCode(WORKOS_USER_ID);

      expect(workos.sendVerificationEmail).toHaveBeenCalledWith(WORKOS_USER_ID);
      expect(result).toEqual({ success: true });
    });
  });

  // ==========================================================================
  // Token delegation
  // ==========================================================================

  describe('validateToken', () => {
    it('delegates to JwtTokenService.validateToken', async () => {
      const mapped = makeRequestUser();
      jwtToken.validateToken.mockReturnValue(mapped);

      const result = await service.validateToken('some.jwt');

      expect(jwtToken.validateToken).toHaveBeenCalledWith('some.jwt');
      expect(result).toBe(mapped);
    });

    it('propagates UnauthorizedException from JwtTokenService', async () => {
      jwtToken.validateToken.mockImplementation(() => {
        throw new UnauthorizedException('Invalid or expired token');
      });

      await expect(service.validateToken('bad.jwt')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('generateJwtToken', () => {
    it('delegates to JwtTokenService.generateTokenFromPayload', () => {
      jwtToken.generateTokenFromPayload.mockReturnValue('signed.jwt');

      const token = service.generateJwtToken({ sub: DB_USER_ID });

      expect(jwtToken.generateTokenFromPayload).toHaveBeenCalledWith({
        sub: DB_USER_ID,
      });
      expect(token).toBe('signed.jwt');
    });
  });
});
