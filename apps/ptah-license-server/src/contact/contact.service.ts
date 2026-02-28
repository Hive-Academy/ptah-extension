import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../email/services/email.service';
import { ContactCategory } from './dto/contact-message.dto';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(private readonly emailService: EmailService) {}

  async sendContactMessage(params: {
    userEmail: string;
    userId: string;
    subject: string;
    message: string;
    category?: ContactCategory;
  }): Promise<void> {
    const { userEmail, userId, subject, message, category } = params;

    this.logger.log(
      `Processing contact message from ${userEmail} (category: ${
        category || 'general'
      })`
    );

    await this.emailService.sendContactMessage({
      userEmail,
      userId,
      subject,
      message,
      category: category || ContactCategory.GENERAL,
    });

    this.logger.log(`Contact message sent successfully for ${userEmail}`);
  }
}
