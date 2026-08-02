import {
  Controller,
  Get,
  Inject,
  Post,
  Body,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '@ptah-api/identity';
import { dtoPipe } from '@ptah-api/core';
import { SessionService } from './session.service';
import { SessionRequestDto } from './dto/session-request.dto';

/**
 * SessionController — authenticated 1:1 session eligibility + requests.
 *
 * Mounted at `/api/v1/sessions/*`. `JwtAuthGuard` is applied per-route, so this
 * is NOT a public endpoint: the requester's identity comes from the JWT
 * (`request.user`), never from the body. `GET eligibility` reports whether the
 * caller still has their one free session; `POST request` persists a
 * `session_requests` row and fires two best-effort notification emails.
 *
 * ⚠️ EVERY `@Body()` / `@Query()` PARAM MUST BIND `dtoPipe(TheDto)`.
 * A bare `@Body() dto: X` is SILENTLY UNVALIDATED in this server: esbuild does
 * not emit `emitDecoratorMetadata`, so Nest cannot infer the DTO type and the
 * global ValidationPipe short-circuits — every `class-validator` decorator
 * becomes inert. Before TASK_2026_170 that let an `additionalNotes` of any
 * length through despite `@MaxLength(2000)`.
 * See `libs/api/core/src/lib/common/dto-validation.pipe.ts`. The structural
 * test in `apps/ptah-license-server/src/common/controller-validation.spec.ts`
 * fails the build if a binding is dropped.
 */
@Controller('v1/sessions')
export class SessionController {
  private readonly logger = new Logger(SessionController.name);

  constructor(
    @Inject(SessionService) private readonly sessionService: SessionService,
  ) {}

  @Get('eligibility')
  @UseGuards(JwtAuthGuard)
  async checkEligibility(
    @Req() req: Request,
  ): Promise<{ hasFreeSession: boolean; usedFreeSession: boolean }> {
    const user = req.user as { userId?: string; id?: string };
    const userId = user.userId || user.id || '';
    return this.sessionService.checkEligibility(userId);
  }

  @Post('request')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async requestSession(
    @Body(dtoPipe(SessionRequestDto)) body: SessionRequestDto,
    @Req() req: Request,
  ): Promise<{ success: boolean; message: string; isFreeSession: boolean }> {
    const user = req.user as {
      email: string;
      userId?: string;
      id?: string;
    };

    this.logger.log(
      `Session request from ${user.email} for topic: ${body.sessionTopicId}`,
    );

    const result = await this.sessionService.createRequest({
      userId: user.userId || user.id || '',
      userEmail: user.email,
      sessionTopicId: body.sessionTopicId,
      additionalNotes: body.additionalNotes,
      paddleTransactionId: body.paddleTransactionId,
    });

    return {
      success: true,
      message: result.isFreeSession
        ? "Your free session request has been submitted! We'll email you with available dates."
        : "Your session request has been submitted! We'll email you with available dates once payment is confirmed.",
      isFreeSession: result.isFreeSession,
    };
  }
}
