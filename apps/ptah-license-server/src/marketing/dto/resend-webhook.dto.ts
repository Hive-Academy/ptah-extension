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
    // Tags for correlation (campaignId, userId).
    //
    // Resend has shipped two payload shapes in the wild:
    //   1. Object form: `{ campaignId: 'c-1', userId: 'u-1' }`
    //   2. Array form:  `[{ name: 'campaignId', value: 'c-1' }, ...]`
    //
    // The webhook handler passes this through `normalizeTags(...)` before
    // reading IDs so both shapes resolve correctly. Anything else collapses
    // to an empty record and emits a warn-level log so silent contract drift
    // is observable.
    tags?:
      | Record<string, string>
      | Array<{ name: string; value: string }>
      | undefined;
    // Bounce sub-classification (Resend nests this on bounce events).
    // 'hard' / 'permanent' → opt-out flip. 'soft' / 'transient' → counter only.
    bounce?: {
      type?: 'hard' | 'soft' | 'permanent' | 'transient' | string;
      message?: string;
    };
  };
  type: ResendWebhookType;
}
