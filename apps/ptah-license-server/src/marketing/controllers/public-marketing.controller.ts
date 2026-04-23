import {
  Controller,
  Get,
  Post,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UnsubscribeTokenService } from '../services/unsubscribe-token.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import { getUnsubscribePage } from '../html/unsubscribe-confirmation.html';

@Controller()
export class PublicMarketingController {
  constructor(
    private readonly tokenService: UnsubscribeTokenService,
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * GET /unsubscribe/:token
   * Confirmation page for user-initiated unsubscription
   */
  @Get('unsubscribe/:token')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async unsubscribePage(@Param('token') token: string) {
    const userId = await this.tokenService.verify(token);

    if (!userId) {
      return getUnsubscribePage({
        title: 'Invalid Link',
        message: 'The unsubscription link is invalid or has expired.',
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return getUnsubscribePage({
        title: 'Invalid Link',
        message: 'The unsubscription link is invalid or has expired.',
      });
    }

    // Perform unsubscription
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          marketingOptIn: false,
          unsubscribedAt: new Date(),
        },
      });

      await this.auditLog.write({
        actorEmail: null, // Public action
        action: 'user.unsubscribe',
        targetType: 'User',
        targetId: userId,
        tx,
      });
    });

    return getUnsubscribePage({
      title: 'Unsubscribed',
      message:
        'You have been successfully unsubscribed from our marketing emails.',
      actionUrl: `/resubscribe/${token}`,
      actionLabel: 'Re-subscribe',
    });
  }

  /**
   * POST /unsubscribe/:token
   * One-click unsubscription (RFC 8058)
   */
  @Post('unsubscribe/:token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async unsubscribePost(@Param('token') token: string) {
    const userId = await this.tokenService.verify(token);
    if (!userId) return; // Silent fail for bots

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          marketingOptIn: false,
          unsubscribedAt: new Date(),
        },
      });

      await this.auditLog.write({
        actorEmail: null,
        action: 'user.unsubscribe',
        targetType: 'User',
        targetId: userId,
        tx,
      });
    });
  }

  /**
   * GET /resubscribe/:token
   */
  @Get('resubscribe/:token')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async resubscribe(@Param('token') token: string) {
    const userId = await this.tokenService.verify(token);

    if (!userId) {
      return getUnsubscribePage({
        title: 'Invalid Link',
        message: 'The link is invalid or has expired.',
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return getUnsubscribePage({
        title: 'Invalid Link',
        message: 'The link is invalid or has expired.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          marketingOptIn: true,
          unsubscribedAt: null,
        },
      });

      await this.auditLog.write({
        actorEmail: null,
        action: 'user.resubscribe',
        targetType: 'User',
        targetId: userId,
        tx,
      });
    });

    return getUnsubscribePage({
      title: 'Re-subscribed',
      message:
        'Welcome back! You have been successfully re-subscribed to our marketing emails.',
    });
  }
}
