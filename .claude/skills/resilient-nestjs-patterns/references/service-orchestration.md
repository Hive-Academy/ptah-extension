# Service Orchestration Pattern

## Overview

When a domain grows complex, a single service class accumulates unrelated methods, excessive dependencies, and tangled logic. The Service Orchestration pattern decomposes this into focused child services coordinated by an orchestrator.

## The Problem

A typical "god service" in a growing NestJS application:

```typescript
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly emailService: EmailService,
    private readonly cacheService: CacheService,
    private readonly cryptoService: CryptoService,
    private readonly logger: Logger,
  ) {}

  // OAuth PKCE methods
  generateCodeVerifier() {
    /* ... */
  }
  generateCodeChallenge(verifier: string) {
    /* ... */
  }
  storeOAuthState(state: OAuthState) {
    /* ... */
  }
  validateOAuthState(state: string) {
    /* ... */
  }

  // Token methods
  generateAccessToken(user: User) {
    /* ... */
  }
  generateRefreshToken(user: User) {
    /* ... */
  }
  validateToken(token: string) {
    /* ... */
  }
  revokeToken(token: string) {
    /* ... */
  }

  // User sync methods
  syncUserFromProvider(providerData: ProviderUser) {
    /* ... */
  }
  linkAccount(userId: string, provider: string) {
    /* ... */
  }

  // Magic link methods
  generateMagicLink(email: string) {
    /* ... */
  }
  validateMagicLink(token: string) {
    /* ... */
  }
}
```

**Symptoms this pattern addresses:**

- Class has 8+ constructor dependencies
- Methods group into 3+ unrelated clusters
- File exceeds 500 lines
- Unit tests require mocking most dependencies for every test case

## The Solution

Decompose into focused child services. The original service becomes a thin orchestrator.

```
AuthService (orchestrator)
  |- PkceService        (OAuth PKCE state management)
  |- TokenService       (JWT generation and validation)
  |- UserSyncService    (external provider user sync)
  |- MagicLinkService   (passwordless authentication tokens)
```

## Implementation

### Step 1: Identify Clusters

Group methods by the single concern they address:

```
PKCE concern:       generateCodeVerifier, generateCodeChallenge, storeOAuthState, validateOAuthState
Token concern:      generateAccessToken, generateRefreshToken, validateToken, revokeToken
User sync concern:  syncUserFromProvider, linkAccount
Magic link concern: generateMagicLink, validateMagicLink
```

### Step 2: Extract Child Services

Each cluster becomes its own injectable service with only the dependencies it needs.

```typescript
// libs/auth/src/lib/services/token.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class TokenService {
  private readonly accessTokenTtl: string;
  private readonly refreshTokenTtl: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
  ) {
    this.accessTokenTtl = this.configService.get('JWT_ACCESS_TTL', '15m');
    this.refreshTokenTtl = this.configService.get('JWT_REFRESH_TTL', '7d');
  }

  generateTokenPair(user: User): TokenPair {
    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      accessToken: this.jwtService.sign(payload, { expiresIn: this.accessTokenTtl }),
      refreshToken: this.jwtService.sign(payload, { expiresIn: this.refreshTokenTtl }),
    };
  }

  async validateAccessToken(token: string): Promise<JwtPayload> {
    try {
      const payload = this.jwtService.verify(token);
      const isRevoked = await this.cacheService.get(`revoked:${token}`);
      if (isRevoked) throw new UnauthorizedException('Token has been revoked');
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  async revokeToken(token: string): Promise<void> {
    const payload = this.jwtService.decode(token) as JwtPayload;
    const ttl = payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : 3600;
    await this.cacheService.set(`revoked:${token}`, true, { ttl });
  }
}
```

Other child services follow the same pattern -- each takes only the dependencies it needs (PkceService needs CacheService, UserSyncService needs PrismaService, etc.).

### Step 3: Create the Orchestrator

The original service becomes a thin coordinator that delegates to child services.

```typescript
// libs/auth/src/lib/services/auth.service.ts
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PkceService } from './pkce.service';
import { TokenService, TokenPair } from './token.service';
import { UserSyncService } from './user-sync.service';
import { MagicLinkService } from './magic-link.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly pkceService: PkceService,
    private readonly tokenService: TokenService,
    private readonly userSyncService: UserSyncService,
    private readonly magicLinkService: MagicLinkService,
  ) {}

  async initiateOAuthFlow(provider: string, redirectUri: string): Promise<OAuthInitResult> {
    const verifier = this.pkceService.generateCodeVerifier();
    const challenge = this.pkceService.generateCodeChallenge(verifier);
    const stateKey = await this.pkceService.storeOAuthState({ provider, redirectUri, codeVerifier: verifier });
    return { stateKey, codeChallenge: challenge };
  }

  async completeOAuthFlow(stateKey: string, providerData: ProviderUser): Promise<TokenPair> {
    const state = await this.pkceService.validateOAuthState(stateKey);
    if (!state) throw new UnauthorizedException('Invalid or expired OAuth state');

    const user = await this.userSyncService.syncFromProvider(providerData);
    this.logger.log(`OAuth flow completed for user ${user.id}`);
    return this.tokenService.generateTokenPair(user);
  }

  async requestMagicLink(email: string): Promise<void> {
    await this.magicLinkService.generate(email);
  }

  async completeMagicLink(token: string): Promise<TokenPair> {
    const user = await this.magicLinkService.validate(token);
    return this.tokenService.generateTokenPair(user);
  }

  async validateToken(token: string): Promise<JwtPayload> {
    return this.tokenService.validateAccessToken(token);
  }
}
```

### Step 4: Wire the Module

```typescript
@Module({
  imports: [
    JwtModule.registerAsync({
      /* config */
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PkceService, TokenService, UserSyncService, MagicLinkService],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
```

## When to Split

Apply when **two or more** signals are present:

| Signal                   | Threshold                                            |
| ------------------------ | ---------------------------------------------------- |
| File length              | >500 lines                                           |
| Constructor dependencies | >6 injected services                                 |
| Method clusters          | 3+ groups of unrelated methods                       |
| Test complexity          | >50% of test setup mocks unrelated dependencies      |
| Change frequency         | Different method groups change for different reasons |

## When NOT to Split

- **Service is under 200 lines** -- overhead of multiple files is not worth it
- **All methods share the same dependencies** -- they likely belong together
- **Single domain concern** -- a large service doing one thing well is fine
- **No testing pain** -- if tests are easy to write, the structure is fine

## Testing the Orchestrator

Each child service can be mocked independently, making tests focused and fast.

```typescript
describe('AuthService', () => {
  let authService: AuthService;
  let pkceService: jest.Mocked<PkceService>;
  let tokenService: jest.Mocked<TokenService>;
  let userSyncService: jest.Mocked<UserSyncService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [AuthService, { provide: PkceService, useValue: { generateCodeVerifier: jest.fn(), generateCodeChallenge: jest.fn(), storeOAuthState: jest.fn(), validateOAuthState: jest.fn() } }, { provide: TokenService, useValue: { generateTokenPair: jest.fn(), validateAccessToken: jest.fn() } }, { provide: UserSyncService, useValue: { syncFromProvider: jest.fn() } }, { provide: MagicLinkService, useValue: { generate: jest.fn(), validate: jest.fn() } }],
    }).compile();

    authService = module.get(AuthService);
    pkceService = module.get(PkceService);
    tokenService = module.get(TokenService);
    userSyncService = module.get(UserSyncService);
  });

  it('should sync user and return tokens on valid OAuth state', async () => {
    pkceService.validateOAuthState.mockResolvedValue({ provider: 'github', redirectUri: '/cb', codeVerifier: 'v' });
    userSyncService.syncFromProvider.mockResolvedValue({ id: '1', email: 'test@example.com' } as User);
    tokenService.generateTokenPair.mockReturnValue({ accessToken: 'at', refreshToken: 'rt' });

    const result = await authService.completeOAuthFlow('state-key', { id: 'gh-1', provider: 'github', email: 'test@example.com' } as ProviderUser);

    expect(userSyncService.syncFromProvider).toHaveBeenCalled();
    expect(result).toEqual({ accessToken: 'at', refreshToken: 'rt' });
  });

  it('should throw on invalid OAuth state', async () => {
    pkceService.validateOAuthState.mockResolvedValue(null);
    await expect(authService.completeOAuthFlow('bad', {} as ProviderUser)).rejects.toThrow(UnauthorizedException);
    expect(userSyncService.syncFromProvider).not.toHaveBeenCalled();
  });
});
```

## File Organization

```
libs/auth/src/lib/
├── services/
│   ├── auth.service.ts          # Orchestrator (thin, delegates)
│   ├── pkce.service.ts          # PKCE state management
│   ├── token.service.ts         # JWT generation and validation
│   ├── user-sync.service.ts     # External provider sync
│   └── magic-link.service.ts    # Passwordless authentication
├── auth.controller.ts
├── auth.module.ts
└── index.ts
```

## Key Principles

1. **Orchestrator is thin** -- it coordinates but does not contain business logic itself. If a method does more than delegate and combine results, it belongs in a child service.

2. **Child services are independent** -- they do not depend on each other. The orchestrator calls both and passes data between them.

3. **Expose selectively** -- the module exports the orchestrator (and occasionally a child service like `TokenService` that other modules need). Internal child services stay private.

4. **Split incrementally** -- extract one concern at a time. Start with the cluster that causes the most testing pain.
