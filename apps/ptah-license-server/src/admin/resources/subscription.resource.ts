import type { ResourceWithOptions } from 'adminjs';
import { PrismaService } from '../../prisma/prisma.service';

export function getSubscriptionResource(
  prisma: PrismaService,
  model: unknown,
): ResourceWithOptions {
  return {
    resource: { model, client: prisma },
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
