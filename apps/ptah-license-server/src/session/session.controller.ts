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
import { JwtAuthGuard } from '../app/auth/guards/jwt-auth.guard';
import { SessionService } from './session.service';
import { SessionRequestDto } from './dto/session-request.dto';

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
    @Body() body: SessionRequestDto,
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
