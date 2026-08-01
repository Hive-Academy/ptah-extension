import {
  Body,
  Controller,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { WaitlistService, WaitlistJoinStatus } from './waitlist.service';
import { JoinWaitlistDto } from './dto/join-waitlist.dto';

/**
 * WaitlistController - public Builders waitlist signup.
 *
 * POST /api/v1/waitlist
 *  - 201 { status: 'joined' }         on first join
 *  - 200 { status: 'already_joined' } on duplicate (deduped by lowercased email)
 *  - 400                              on invalid email (global ValidationPipe)
 *
 * Public + strictly throttled (5/min) since it is un-authenticated. This is
 * stricter than the global 100/min default, mirroring the contact endpoint.
 */
@Controller('v1/waitlist')
export class WaitlistController {
  private readonly logger = new Logger(WaitlistController.name);

  constructor(
    @Inject(WaitlistService) private readonly waitlistService: WaitlistService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async join(
    @Body() body: JoinWaitlistDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: WaitlistJoinStatus }> {
    const { status } = await this.waitlistService.join({
      email: body.email,
      source: body.source,
    });

    res.status(status === 'joined' ? HttpStatus.CREATED : HttpStatus.OK);

    return { status };
  }
}
