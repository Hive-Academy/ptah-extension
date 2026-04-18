import { ResourceWithOptions } from 'adminjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * AdminJS resource configuration for the Subscription model
 *
 * TASK_2025_286: Read-only admin view for subscriptions.
 * Subscriptions are managed entirely by Paddle webhooks and should
 * never be created or edited manually through the admin panel.
 *
 * All write actions (new, edit, delete, bulkDelete) are disabled.
 *
 * @param prisma - PrismaService instance (with DMMF compat applied)
 * @param dmmf - DMMF metadata containing modelMap
 */
export function getSubscriptionResource(
  prisma: PrismaService,
  dmmf: { modelMap: Record<string, unknown> },
): ResourceWithOptions {
  return {
    resource: {
      model: dmmf.modelMap['Subscription'],
      client: prisma,
    },
    options: {
      navigation: { name: 'Licensing', icon: 'CreditCard' },
      listProperties: [
        'id',
        'userId',
        'paddleSubscriptionId',
        'status',
        'priceId',
        'currentPeriodEnd',
        'trialEnd',
      ],
      showProperties: [
        'id',
        'userId',
        'paddleSubscriptionId',
        'paddleCustomerId',
        'status',
        'priceId',
        'currentPeriodEnd',
        'trialEnd',
        'canceledAt',
        'createdAt',
        'updatedAt',
      ],
      filterProperties: ['status', 'priceId', 'currentPeriodEnd'],
      actions: {
        new: { isAccessible: false },
        edit: { isAccessible: false },
        delete: { isAccessible: false },
        bulkDelete: { isAccessible: false },
      },
    },
  };
}
