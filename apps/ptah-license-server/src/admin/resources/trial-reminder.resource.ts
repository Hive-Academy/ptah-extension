import { ResourceWithOptions } from 'adminjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * AdminJS resource configuration for the TrialReminder model
 *
 * TASK_2025_286: Read-only admin view for trial reminder tracking records.
 * These records are created automatically by the trial reminder scheduler
 * (TASK_2025_142) and should never be created or edited manually.
 *
 * All write actions (new, edit, delete, bulkDelete) are disabled.
 *
 * @param prisma - PrismaService instance (with DMMF compat applied)
 * @param dmmf - DMMF metadata containing modelMap
 */
export function getTrialReminderResource(
  prisma: PrismaService,
  dmmf: { modelMap: Record<string, unknown> },
): ResourceWithOptions {
  return {
    resource: {
      model: dmmf.modelMap['TrialReminder'],
      client: prisma,
    },
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
