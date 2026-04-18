import type { ResourceWithOptions } from 'adminjs';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/services/email.service';
import { getUserResource } from './user.resource';
import { getLicenseResource } from './license.resource';
import { getSubscriptionResource } from './subscription.resource';
import { getFailedWebhookResource } from './failed-webhook.resource';
import { getTrialReminderResource } from './trial-reminder.resource';
import { getSessionRequestResource } from './session-request.resource';

type GetModelByName = (name: string) => unknown;

export function getResources(
  prisma: PrismaService,
  emailService: EmailService,
  getModelByName: GetModelByName,
): ResourceWithOptions[] {
  return [
    getUserResource(prisma, getModelByName('User'), emailService),
    getLicenseResource(prisma, getModelByName('License')),
    getSubscriptionResource(prisma, getModelByName('Subscription')),
    getFailedWebhookResource(prisma, getModelByName('FailedWebhook')),
    getTrialReminderResource(prisma, getModelByName('TrialReminder')),
    getSessionRequestResource(prisma, getModelByName('SessionRequest')),
  ];
}
