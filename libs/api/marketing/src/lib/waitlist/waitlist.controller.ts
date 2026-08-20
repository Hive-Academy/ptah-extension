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
import { dtoPipe } from '@ptah-api/core';
import { WaitlistService, WaitlistJoinStatus } from './waitlist.service';
import { JoinWaitlistDto } from './dto/join-waitlist.dto';

/**
 * WaitlistController - public Builders waitlist signup.
 *
 * POST /api/v1/waitlist
 *  - 201 { status: 'joined' }         on first join
 *  - 200 { status: 'already_joined' } on duplicate (deduped by lowercased email)
 *  - 400                              on invalid email (`dtoPipe`, see below)
 *
 * Public + strictly throttled (5/min) since it is un-authenticated. This is
 * stricter than the global 100/min default, mirroring the contact endpoint.
 *
 * ⚠️ EVERY `@Body()` / `@Query()` PARAM MUST BIND `dtoPipe(TheDto)`.
 * A bare `@Body() dto: X` is SILENTLY UNVALIDATED in this server: esbuild does
 * not emit `emitDecoratorMetadata`, so Nest cannot infer the DTO type and the
 * global ValidationPipe short-circuits — every `class-validator` decorator
 * becomes inert. Before TASK_2026_170 that made
 * `POST /api/v1/waitlist {"email":"not-an-email"}` return 201.
 * See `libs/api/core/src/lib/common/dto-validation.pipe.ts`. The structural
 * test in `apps/ptah-license-server/src/common/controller-validation.spec.ts`
 * fails the build if a binding is dropped.
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
    @Body(dtoPipe(JoinWaitlistDto)) body: JoinWaitlistDto,
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
