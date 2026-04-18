import { ResourceWithOptions } from 'adminjs';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/services/email.service';
import { getUserResource } from './user.resource';
import { getLicenseResource } from './license.resource';
import { getSubscriptionResource } from './subscription.resource';
import { getFailedWebhookResource } from './failed-webhook.resource';
import { getTrialReminderResource } from './trial-reminder.resource';
import { getSessionRequestResource } from './session-request.resource';

/**
 * AdminJS resource configuration aggregator
 *
 * TASK_2025_286: Returns all Prisma model resource configurations for AdminJS.
 * Each resource maps a Prisma model to an AdminJS resource with
 * list/show/edit/filter property configurations and custom actions.
 *
 * DMMF model metadata is accessed via the compatibility shim at
 * `(prisma as any)._baseDmmf.modelMap` which is applied by
 * `ensurePrismaDmmfCompat()` before this function is called.
 *
 * Resources registered:
 * - User (with marketing email bulk action)
 * - License (masked license key, no delete)
 * - Subscription (read-only, managed by Paddle)
 * - FailedWebhook (edit resolved/resolvedAt only)
 * - TrialReminder (read-only tracking)
 * - SessionRequest (admin scheduling)
 *
 * @param prisma - PrismaService with _baseDmmf compatibility shim applied
 * @param emailService - EmailService for marketing email bulk action
 */
export function getResources(
  prisma: PrismaService,
  emailService: EmailService,
): ResourceWithOptions[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dmmf = (prisma as any)._baseDmmf as {
    modelMap: Record<string, unknown>;
  };

  return [
    getUserResource(prisma, dmmf, emailService),
    getLicenseResource(prisma, dmmf),
    getSubscriptionResource(prisma, dmmf),
    getFailedWebhookResource(prisma, dmmf),
    getTrialReminderResource(prisma, dmmf),
    getSessionRequestResource(prisma, dmmf),
  ];
}
