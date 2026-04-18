import type { ResourceWithOptions } from 'adminjs';
import { PrismaService } from '../../prisma/prisma.service';

export function getTrialReminderResource(
  prisma: PrismaService,
  model: unknown,
): ResourceWithOptions {
  return {
    resource: { model, client: prisma },
    options: {
      navigation: { name: 'Users & Auth', icon: 'Bell' },
      listProperties: ['id', 'userId', 'reminderType', 'sentAt', 'emailSentTo'],
      showProperties: ['id', 'userId', 'reminderType', 'sentAt', 'emailSentTo'],
      filterProperties: ['reminderType', 'sentAt'],
      actions: {
        new: { isAccessible: false },
        edit: { isAccessible: false },
        delete: { isAccessible: false },
        bulkDelete: { isAccessible: false },
      },
    },
  };
}
