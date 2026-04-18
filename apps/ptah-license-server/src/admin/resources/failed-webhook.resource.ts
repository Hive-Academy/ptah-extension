import type { ResourceWithOptions } from 'adminjs';
import { PrismaService } from '../../prisma/prisma.service';

export function getFailedWebhookResource(
  prisma: PrismaService,
  model: unknown,
): ResourceWithOptions {
  return {
    resource: { model, client: prisma },
    options: {
      navigation: { name: 'Webhooks', icon: 'AlertTriangle' },
      listProperties: [
        'id',
        'eventId',
        'eventType',
        'errorMessage',
        'retryCount',
        'resolved',
        'attemptedAt',
      ],
      showProperties: [
        'id',
        'eventId',
        'eventType',
        'rawPayload',
        'errorMessage',
        'stackTrace',
        'attemptedAt',
        'retryCount',
        'resolved',
        'resolvedAt',
      ],
      editProperties: ['resolved', 'resolvedAt'],
      filterProperties: ['eventType', 'resolved', 'attemptedAt'],
      actions: {
        new: { isAccessible: false },
        delete: { isAccessible: false },
        bulkDelete: { isAccessible: false },
      },
    },
  };
}
