import {
  Controller,
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
import { ContactService } from './contact.service';
import { ContactMessageDto } from './dto/contact-message.dto';

/**
 * ContactController — authenticated "contact us" message relay.
 *
 * Mounted at `/api/v1/contact`. `JwtAuthGuard` is applied per-route, so this is
 * NOT a public endpoint: the sender's identity comes from the JWT
 * (`request.user`), never from the body. Messages are relayed by email via
 * `ContactService` → `EmailService`; nothing is persisted.
 *
 * ⚠️ EVERY `@Body()` / `@Query()` PARAM MUST BIND `dtoPipe(TheDto)`.
 * A bare `@Body() dto: X` is SILENTLY UNVALIDATED in this server: esbuild does
 * not emit `emitDecoratorMetadata`, so Nest cannot infer the DTO type and the
 * global ValidationPipe short-circuits — every `class-validator` decorator
 * becomes inert. Before TASK_2026_170 that made
 * `POST /v1/contact {"subject":"ab"}` return 201 despite `@MinLength(3)`.
 * See `libs/api/core/src/lib/common/dto-validation.pipe.ts`. The structural
 * test in `apps/ptah-license-server/src/common/controller-validation.spec.ts`
 * fails the build if a binding is dropped.
 */
@Controller('v1/contact')
export class ContactController {
  private readonly logger = new Logger(ContactController.name);

  constructor(
    @Inject(ContactService) private readonly contactService: ContactService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async sendMessage(
    @Body(dtoPipe(ContactMessageDto)) body: ContactMessageDto,
    @Req() req: Request,
  ): Promise<{ success: boolean; message: string }> {
    const user = req.user as { email: string; userId?: string; id?: string };

    this.logger.log(`Contact message received from ${user.email}`);

    await this.contactService.sendContactMessage({
      userEmail: user.email,
      userId: user.userId || user.id || 'unknown',
      subject: body.subject,
      message: body.message,
      category: body.category,
    });

    return {
      success: true,
      message:
        "Your message has been sent. We'll get back to you as soon as possible.",
    };
  }
}
