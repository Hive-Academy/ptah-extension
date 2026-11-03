# Authentication Patterns

## Overview

Authentication verifies user identity. This guide covers JWT-based authentication and integration with external providers.

## JWT Authentication

### 1. Install Dependencies

```bash
npm install @nestjs/passport @nestjs/jwt passport passport-jwt
npm install -D @types/passport-jwt
```

### 2. JWT Strategy

```typescript
// libs/shared/auth/src/lib/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

export interface JwtPayload {
  sub: string; // User ID
  email: string;
  organizationId?: string;
  role?: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    // Optionally validate user still exists/is active
    return payload;
  }
}
```

### 3. Auth Guard

```typescript
// libs/shared/auth/src/lib/guards/jwt-auth.guard.ts
import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }
}
```

### 4. Auth Service

```typescript
// libs/shared/auth/src/lib/auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UserRepository } from './user.repository';

@Injectable()
export class AuthService {
  constructor(private userRepository: UserRepository, private jwtService: JwtService, private configService: ConfigService) {}

  async validateUser(email: string, password: string) {
    const user = await this.userRepository.findByEmail(email);

    if (user && (await bcrypt.compare(password, user.passwordHash))) {
      return user;
    }

    return null;
  }

  async login(email: string, password: string) {
    const user = await this.validateUser(email, password);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      organizationId: user.defaultOrganizationId,
      role: user.role,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken: this.jwtService.sign(payload, {
        expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', '7d'),
      }),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    };
  }

  async register(dto: RegisterDto) {
    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.userRepository.create({
      email: dto.email,
      name: dto.name,
      passwordHash,
    });

    return this.login(dto.email, dto.password);
  }

  async refreshToken(token: string) {
    try {
      const payload = this.jwtService.verify(token);

      const user = await this.userRepository.findById(payload.sub);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      const newPayload: JwtPayload = {
        sub: user.id,
        email: user.email,
        organizationId: user.defaultOrganizationId,
        role: user.role,
      };

      return {
        accessToken: this.jwtService.sign(newPayload),
      };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }
}
```

### 5. Auth Module

```typescript
// libs/shared/auth/src/lib/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get('JWT_EXPIRES_IN', '15m'),
        },
      }),
    }),
  ],
  providers: [JwtStrategy, JwtAuthGuard, AuthService],
  controllers: [AuthController],
  exports: [JwtAuthGuard, AuthService, JwtModule],
})
export class AuthModule {}
```

### 6. Current User Decorator

```typescript
// libs/shared/auth/src/lib/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../strategies/jwt.strategy';

export const CurrentUser = createParamDecorator((data: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  const user = request.user as JwtPayload;

  return data ? user?.[data] : user;
});
```

## External Auth Provider Integration

For integrating with external providers (Clerk, Auth0, WorkOS, etc.):

### Provider Pattern

```typescript
// libs/shared/auth/src/lib/external-auth.interface.ts
export interface IExternalAuthProvider {
  verifyToken(token: string): Promise<ExternalUser>;
  getUser(userId: string): Promise<ExternalUser>;
}

export interface ExternalUser {
  id: string;
  email: string;
  name?: string;
  imageUrl?: string;
  metadata?: Record<string, unknown>;
}
```

### Provider Factory

```typescript
// libs/shared/auth/src/lib/external-auth.provider.ts
export const EXTERNAL_AUTH_PROVIDER = 'EXTERNAL_AUTH_PROVIDER';

export const ExternalAuthProvider = {
  provide: EXTERNAL_AUTH_PROVIDER,
  useFactory: async (config: ConfigService): Promise<IExternalAuthProvider> => {
    const provider = config.get('AUTH_PROVIDER', 'jwt');

    switch (provider) {
      case 'clerk':
        const { ClerkAdapter } = await import('./adapters/clerk.adapter');
        return new ClerkAdapter(config.get('CLERK_SECRET_KEY'));

      case 'auth0':
        const { Auth0Adapter } = await import('./adapters/auth0.adapter');
        return new Auth0Adapter(config.get('AUTH0_DOMAIN'), config.get('AUTH0_CLIENT_ID'));

      case 'workos':
        const { WorkOSAdapter } = await import('./adapters/workos.adapter');
        return new WorkOSAdapter(config.get('WORKOS_API_KEY'));

      default:
        // Return null provider - use JWT strategy instead
        return null;
    }
  },
  inject: [ConfigService],
};
```

### External Auth Strategy

```typescript
// libs/shared/auth/src/lib/strategies/external-auth.strategy.ts
import { Injectable, UnauthorizedException, Optional, Inject } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import { EXTERNAL_AUTH_PROVIDER, IExternalAuthProvider } from '../external-auth.provider';

@Injectable()
export class ExternalAuthStrategy extends PassportStrategy(Strategy, 'external') {
  constructor(
    @Optional()
    @Inject(EXTERNAL_AUTH_PROVIDER)
    private authProvider: IExternalAuthProvider | null
  ) {
    super();
  }

  async validate(request: Request): Promise<any> {
    if (!this.authProvider) {
      throw new UnauthorizedException('External auth not configured');
    }

    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      const externalUser = await this.authProvider.verifyToken(token);
      return {
        sub: externalUser.id,
        email: externalUser.email,
        name: externalUser.name,
        provider: 'external',
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  private extractToken(request: any): string | undefined {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
    return undefined;
  }
}
```

## Auth Controller

```typescript
// libs/shared/auth/src/lib/auth.controller.ts
import { Controller, Post, Body, UseGuards, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtPayload } from './strategies/jwt.strategy';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @Get('me')
  async me(@CurrentUser() user: JwtPayload) {
    return user;
  }
}
```

## Environment Configuration

```bash
# .env
JWT_SECRET=your-super-secret-key-at-least-32-chars
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# For external providers (optional)
AUTH_PROVIDER=jwt  # or 'clerk', 'auth0', 'workos'
CLERK_SECRET_KEY=sk_xxx
AUTH0_DOMAIN=your-domain.auth0.com
AUTH0_CLIENT_ID=xxx
WORKOS_API_KEY=xxx
```
