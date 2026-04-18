import type { ResourceWithOptions } from 'adminjs';
import { PrismaService } from '../../prisma/prisma.service';

export function getSessionRequestResource(
  prisma: PrismaService,
  model: unknown,
): ResourceWithOptions {
  return {
    resource: { model, client: prisma },
    options: {
      navigation: { name: 'Sessions', icon: 'Calendar' },
      listProperties: [
        'id',
        'userId',
        'sessionTopicId',
        'isFreeSession',
        'status',
        'paymentStatus',
        'createdAt',
      ],
      showProperties: [
        'id',
        'userId',
        'sessionTopicId',
        'additionalNotes',
        'isFreeSession',
        'status',
        'paymentStatus',
        'paddleTransactionId',
        'scheduledAt',
        'createdAt',
        'updatedAt',
      ],
      editProperties: ['status', 'paymentStatus', 'scheduledAt'],
      filterProperties: ['status', 'paymentStatus', 'isFreeSession'],
      actions: {
        delete: { isAccessible: false },
        bulkDelete: { isAccessible: false },
      },
    },
  };
}
