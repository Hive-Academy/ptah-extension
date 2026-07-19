import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Logger,
  Query,
  Redirect,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from '../app/auth/services/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { DiscourseSsoService } from './discourse-sso.service';

/**
 * DiscourseController — DiscourseConnect SSO provider endpoint.
 *
 * GET /api/v1/sso/discourse?sso=<b64>&sig=<hmac>
 *  - Validates `sig` (HMAC-SHA256 over the raw `sso`); invalid → generic 403.
 *  - Requires the `ptah_auth` JWT cookie; absent/invalid → 302 to
 *    FRONTEND_URL/login?returnUrl=<this url> so the user authenticates and
 *    bounces back with the same sso/sig.
 *  - On success → 302 to DISCOURSE_URL/session/sso_login?sso=..&sig.. asserting
 *    identity + the `builders` group (add for members, remove otherwise).
 *
 * Throttled at 20/min (below the global 100) — it is an unauthenticated entry
 * point (auth is proven by the cookie, not the route) hit during login redirects.
 */
@Controller('v1/sso')
export class DiscourseController {
  private readonly logger = new Logger(DiscourseController.name);

  constructor(
    @Inject(DiscourseSsoService)
    private readonly ssoService: DiscourseSsoService,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {}

  @Get('discourse')
  @Redirect()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async discourse(
    @Query('sso') sso: string | undefined,
    @Query('sig') sig: string | undefined,
    @Req() req: Request,
  ): Promise<{ url: string; statusCode: number }> {
    // 1. Validate the inbound DiscourseConnect signature. Never leak why.
    const request = this.ssoService.parseAndValidate(sso, sig);
    if (!request) {
      throw new ForbiddenException('Invalid SSO request');
    }

    // A signed request with no DISCOURSE_URL means a half-configured deploy
    // (secret set, URL missing) — reject cleanly instead of a 500 later.
    if (!this.discourseBaseUrl()) {
      this.logger.warn(
        'DISCOURSE_SSO_SECRET is set but DISCOURSE_URL is not — rejecting SSO request',
      );
      throw new ForbiddenException('Invalid SSO request');
    }

    // 2. Require an authenticated session (ptah_auth cookie). If missing or
    //    invalid, send the user through login and back to this exact URL.
    const token = req.cookies?.['ptah_auth'];
    const user = token ? await this.safeValidate(token) : null;
    if (!user) {
      return { url: this.loginRedirect(req), statusCode: 302 };
    }

    // 3. Resolve entitlement + display name, then hand a signed assertion back
    //    to Discourse.
    const isBuilders = await this.isBuildersMember(user.id);
    const name = await this.resolveName(user.id, user.email);

    const response = this.ssoService.buildResponse({
      nonce: request.nonce,
      externalId: user.id,
      email: user.email,
      name,
      isBuilders,
    });

    const target = new URL(`${this.discourseBaseUrl()}/session/sso_login`);
    target.searchParams.set('sso', response.sso);
    target.searchParams.set('sig', response.sig);

    return { url: target.toString(), statusCode: 302 };
  }

  /** Validate the JWT without throwing — an invalid token behaves as "absent". */
  private async safeValidate(
    token: string,
  ): Promise<{ id: string; email: string } | null> {
    try {
      const user = await this.authService.validateToken(token);
      return { id: user.id, email: user.email };
    } catch {
      return null;
    }
  }

  private loginRedirect(req: Request): string {
    const frontendUrl = (
      this.configService.get<string>('FRONTEND_URL') || 'https://ptah.live'
    ).replace(/\/+$/, '');
    // Prefer the configured public API origin over the request Host header so
    // the returnUrl can never be seeded from attacker-influenced input.
    const apiPublicUrl = (
      this.configService.get<string>('API_PUBLIC_URL') || ''
    )
      .trim()
      .replace(/\/+$/, '');
    const origin =
      apiPublicUrl || `${req.protocol || 'https'}://${req.get('host')}`;
    const thisUrl = `${origin}${req.originalUrl}`;
    return `${frontendUrl}/login?returnUrl=${encodeURIComponent(thisUrl)}`;
  }

  private discourseBaseUrl(): string {
    return (this.configService.get<string>('DISCOURSE_URL') || '')
      .trim()
      .replace(/\/+$/, '');
  }

  /** Build a display name from the DB profile, falling back to the email local part. */
  private async resolveName(userId: string, email: string): Promise<string> {
    try {
      const dbUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true },
      });
      const full = [dbUser?.firstName, dbUser?.lastName]
        .filter((part): part is string => Boolean(part && part.trim()))
        .join(' ')
        .trim();
      if (full) {
        return full;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to resolve name for user ${userId}: ${message}`);
    }
    return email.split('@')[0] || email;
  }

  /**
   * Resolve active Builders membership from the DB (subscription first, then a
   * non-expired active builders license) — mirrors the members gate.
   */
  private async isBuildersMember(userId: string): Promise<boolean> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId, status: { in: ['active', 'trialing'] } },
      orderBy: { updatedAt: 'desc' },
    });
    if (subscription) {
      return true;
    }
    const license = await this.prisma.license.findFirst({
      where: { userId, status: 'active', plan: 'builders' },
      orderBy: { createdAt: 'desc' },
    });
    if (!license) {
      return false;
    }
    if (license.expiresAt && license.expiresAt < new Date()) {
      return false;
    }
    return true;
  }
}
