import { ResourceWithOptions } from 'adminjs';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/services/email.service';
import { sendMarketingEmailAction } from '../actions/send-marketing-email.action';

/**
 * AdminJS resource configuration for the User model
 *
 * TASK_2025_286: Provides admin UI for viewing and editing users.
 * Delete and bulkDelete are disabled for safety -- user removal
 * should go through proper channels (WorkOS, API endpoints).
 *
 * Features:
 * - List view with key user fields
 * - Show view with all fields including external IDs
 * - Edit limited to safe fields (email, name, verification)
 * - Bulk marketing email action for selected users
 *
 * @param prisma - PrismaService instance (with DMMF compat applied)
 * @param dmmf - DMMF metadata containing modelMap
 * @param emailService - EmailService for marketing email action
 */
export function getUserResource(
  prisma: PrismaService,
  dmmf: { modelMap: Record<string, unknown> },
  emailService: EmailService,
): ResourceWithOptions {
  return {
    resource: {
      model: dmmf.modelMap['User'],
      client: prisma,
    },
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
