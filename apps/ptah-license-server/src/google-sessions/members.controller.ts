import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Logger,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../app/auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from './sessions.service';
import type { BuildersSession } from './google-sessions.types';

/**
 * MembersController — the paid Builders members' area backend.
 *
 * GET /api/v1/members/sessions
 *  - JwtAuthGuard (ptah_auth cookie required — 401 otherwise).
 *  - 403 { reason: 'membership_required' } when the caller's active plan is not
 *    'builders' (resolved from the DB, not the JWT claim, so a stale token can
 *    never grant access).
 *  - 200 { sessions, communityUrl } otherwise. `sessions` is the next 60 days
 *    of Google Calendar events; `communityUrl` is DISCOURSE_URL (null when unset).
 *
 * Feature-off (Google unconfigured): `sessions` is `[]` — the endpoint still
 * responds so the frontend has a stable contract.
 */
@Controller('v1/members')
export class MembersController {
  private readonly logger = new Logger(MembersController.name);

  constructor(
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {}

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getSessions(@Req() req: Request): Promise<{
    sessions: BuildersSession[];
    communityUrl: string | null;
  }> {
    const user = req.user as { id: string; email: string };

    const isBuilders = await this.isBuildersMember(user.id);
    if (!isBuilders) {
      throw new ForbiddenException({ reason: 'membership_required' });
    }

    const sessions = await this.sessions.listUpcomingSessions();
    return { sessions, communityUrl: this.communityUrl() };
  }

  /** DISCOURSE_URL (trimmed, no trailing slash) or null when unset. */
  private communityUrl(): string | null {
    const url = this.configService.get<string>('DISCOURSE_URL')?.trim();
    return url ? url.replace(/\/+$/, '') : null;
  }

  /**
   * Resolve whether the user currently holds an active Builders membership,
   * from the database (subscription first, then license) — mirrors the tier
   * logic in JwtTokenService.determineTier but scoped to the Builders gate.
   */
  private async isBuildersMember(userId: string): Promise<boolean> {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ['active', 'trialing'] },
      },
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
