/**
 * Resend Webhook DTOs
 */

export type ResendWebhookType =
  | 'email.sent'
  | 'email.delivered'
  | 'email.delivery_delayed'
  | 'email.complained'
  | 'email.bounced'
  | 'email.opened'
  | 'email.clicked';

export interface ResendWebhookPayload {
  created_at: string;
  data: {
    created_at: string;
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    // Tags for correlation (campaignId, userId)
    tags?: Record<string, string>;
  };
  type: ResendWebhookType;
}
