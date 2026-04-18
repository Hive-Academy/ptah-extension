import { ResourceWithOptions } from 'adminjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * AdminJS resource configuration for the SessionRequest model
 *
 * TASK_2025_286: Provides admin UI for managing training session requests.
 * Admins can update status, paymentStatus, and scheduledAt to manage
 * the session lifecycle (pending -> scheduled -> completed/canceled).
 *
 * @param prisma - PrismaService instance (with DMMF compat applied)
 * @param dmmf - DMMF metadata containing modelMap
 */
export function getSessionRequestResource(
  prisma: PrismaService,
  dmmf: { modelMap: Record<string, unknown> },
): ResourceWithOptions {
  return {
    resource: {
      model: dmmf.modelMap['SessionRequest'],
      client: prisma,
    },
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
