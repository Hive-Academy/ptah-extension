import type { ResourceWithOptions } from 'adminjs';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/services/email.service';
import { sendMarketingEmailAction } from '../actions/send-marketing-email.action';

export function getUserResource(
  prisma: PrismaService,
  model: unknown,
  emailService: EmailService,
): ResourceWithOptions {
  return {
    resource: { model, client: prisma },
    options: {
      navigation: { name: 'Users & Auth', icon: 'User' },
      listProperties: [
        'id',
        'email',
        'firstName',
        'lastName',
        'emailVerified',
        'createdAt',
      ],
      showProperties: [
        'id',
        'workosId',
        'paddleCustomerId',
        'email',
        'firstName',
        'lastName',
        'emailVerified',
        'createdAt',
        'updatedAt',
      ],
      editProperties: ['email', 'firstName', 'lastName', 'emailVerified'],
      filterProperties: ['email', 'emailVerified', 'createdAt'],
      actions: {
        delete: { isAccessible: false },
        bulkDelete: { isAccessible: false },
        sendMarketingEmail: sendMarketingEmailAction(emailService),
      },
    },
  };
}
