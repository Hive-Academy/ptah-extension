import { ResourceWithOptions } from 'adminjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * AdminJS resource configuration for the FailedWebhook model
 *
 * TASK_2025_286: Provides admin UI for investigating and resolving
 * failed Paddle webhook deliveries.
 *
 * Only the `resolved` and `resolvedAt` fields are editable, allowing
 * admins to manually mark failed webhooks as resolved after investigation.
 * All other fields are immutable records of the original failure.
 *
 * @param prisma - PrismaService instance (with DMMF compat applied)
 * @param dmmf - DMMF metadata containing modelMap
 */
export function getFailedWebhookResource(
  prisma: PrismaService,
  dmmf: { modelMap: Record<string, unknown> },
): ResourceWithOptions {
  return {
    resource: {
      model: dmmf.modelMap['FailedWebhook'],
      client: prisma,
    },
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
