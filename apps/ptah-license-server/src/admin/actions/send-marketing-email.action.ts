import type { Action, ActionResponse } from 'adminjs';
import { EmailService } from '../../email/services/email.service';

/**
 * Custom AdminJS bulk action: Send Marketing Email
 *
 * TASK_2025_286: Allows admins to send custom marketing emails to selected users
 * from the User resource list view.
 *
 * Flow:
 * 1. Admin selects users in the list view
 * 2. Clicks "Send Marketing Email" bulk action
 * 3. GET request returns info notice with user count
 * 4. POST request validates subject + htmlContent, sends emails via EmailService
 * 5. Returns success/failure summary with sent/failed counts
 *
 * Error handling:
 * - Per-user errors are caught and tracked, allowing the batch to continue
 * - Summary notice reports both sent and failed counts with error details
 */
export function sendMarketingEmailAction(
  emailService: EmailService,
): Partial<Action<ActionResponse>> {
  return {
    actionType: 'bulk',
    icon: 'Send',
    guard:
      'Are you sure you want to send marketing emails to the selected users?',
    handler: async (request, response, context) => {
      const { records, currentAdmin } = context;

      if (request.method === 'get') {
        return {
          records: records?.map((r) => r.toJSON(currentAdmin)) ?? [],
          notice: {
            message: `Ready to send marketing email to ${records?.length ?? 0} selected user(s). Submit with subject and htmlContent fields.`,
            type: 'info' as const,
          },
        };
      }

      // POST: Validate and send emails
      const { subject, htmlContent } = (request.payload ?? {}) as Record<
        string,
        string | undefined
      >;

      if (!subject || !htmlContent) {
        return {
          records: records?.map((r) => r.toJSON(currentAdmin)) ?? [],
          notice: {
            message: 'Both "subject" and "htmlContent" fields are required.',
            type: 'error' as const,
          },
        };
      }

      const results = { sent: 0, failed: 0, errors: [] as string[] };

      for (const record of records ?? []) {
        const email = record.params['email'] as string;
        try {
          await emailService.sendCustomEmail({
            to: email,
            subject,
            html: htmlContent,
          });
          results.sent++;
        } catch (error) {
          results.failed++;
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          results.errors.push(`${email}: ${errorMessage}`);
        }
      }

      const summaryParts = [
        `Sent: ${results.sent}`,
        `Failed: ${results.failed}`,
      ];
      if (results.errors.length > 0) {
        summaryParts.push(`Errors: ${results.errors.join('; ')}`);
      }

      return {
        records: records?.map((r) => r.toJSON(currentAdmin)) ?? [],
        notice: {
          message: summaryParts.join('. '),
          type: results.failed > 0 ? ('error' as const) : ('success' as const),
        },
      };
    },
    component: false,
  };
}
