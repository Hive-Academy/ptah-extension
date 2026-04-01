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
import { JwtAuthGuard } from '../app/auth/guards/jwt-auth.guard';
import { ContactService } from './contact.service';
import { ContactMessageDto } from './dto/contact-message.dto';

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
    @Body() body: ContactMessageDto,
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
