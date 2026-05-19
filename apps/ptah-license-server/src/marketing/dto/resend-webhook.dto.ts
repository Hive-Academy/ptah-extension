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
    tags?:
      | Record<string, string>
      | Array<{ name: string; value: string }>
      | undefined;
    bounce?: {
      type?: 'hard' | 'soft' | 'permanent' | 'transient' | string;
      message?: string;
    };
  };
  type: ResendWebhookType;
}
