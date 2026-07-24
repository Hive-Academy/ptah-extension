import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RESEND_MAIL_SERVICE,
  ResendMailService,
} from '../providers/resend.provider';

/**
 * EmailService - Resend email delivery with retry logic
 *
 * Features:
 * - License key email delivery with setup instructions
 * - Magic link email delivery for portal login
 * - 3-attempt retry with exponential backoff (1s, 2s, 4s)
 * - Graceful error handling (throws after 3 failures)
 *
 * Configuration (environment variables):
 * - RESEND_API_KEY: Resend API key (required)
 * - FROM_EMAIL: Sender email address
 * - FROM_NAME: Sender display name
 * - FRONTEND_URL: Customer portal URL for links
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(RESEND_MAIL_SERVICE)
    private readonly mailService: ResendMailService,
  ) {
    this.logger.log('Email service initialized with Resend');
  }

  /**
   * Send license key email with setup instructions
   *
   * @param params - Email parameters (email, licenseKey, plan, expiresAt)
   * @throws Error after 3 failed retry attempts
   */
  async sendLicenseKey(params: {
    email: string;
    licenseKey: string;
    plan: string;
    expiresAt: Date | null;
  }): Promise<void> {
    const { email, licenseKey, plan, expiresAt } = params;

    const fromEmail = this.config.get<string>('FROM_EMAIL') || 'help@ptah.live';
    const fromName = this.config.get<string>('FROM_NAME') || 'Ptah Team';

    const msg = {
      from: `${fromName} <${fromEmail}>`,
      to: [email],
      subject: 'Your Ptah Premium License Key',
      html: this.getLicenseKeyTemplate({ licenseKey, plan, expiresAt }),
    };

    this.logger.log(`Sending license key email to ${email} (plan: ${plan})`);
    await this.sendWithRetry(msg, 3);
    this.logger.log(`License key email sent successfully to ${email}`);
  }

  /**
   * Send magic link email for portal login
   *
   * @param params - Email parameters (email, magicLink)
   * @throws Error after 3 failed retry attempts
   */
  /**
   * Send a custom email with arbitrary subject and HTML content
   *
   * TASK_2025_286: Used by AdminJS marketing email bulk action
   * to send custom marketing emails to selected users.
   *
   * @param params - Email parameters (to, subject, html)
   * @throws Error after 3 failed retry attempts
   */
  async sendCustomEmail(params: {
    to: string;
    subject: string;
    html: string;
    headers?: Record<string, string>;
    tags?: Array<{ name: string; value: string }>;
  }): Promise<void> {
    const { to, subject, html, headers, tags } = params;

    const fromEmail = this.config.get<string>('FROM_EMAIL') || 'help@ptah.live';
    const fromName = this.config.get<string>('FROM_NAME') || 'Ptah Team';

    const msg = {
      from: `${fromName} <${fromEmail}>`,
      to: [to],
      subject,
      html,
      headers,
      tags,
    };

    this.logger.log(`Sending custom email to ${to}: ${subject}`);
    await this.sendWithRetry(msg, 3);
    this.logger.log(`Custom email sent successfully to ${to}`);
  }

  /**
   * Send confirmation email for a Builders waitlist signup.
   *
   * Fired on first join only. Callers treat delivery failures as non-fatal.
   *
   * @param params - Email parameters (email)
   * @throws Error after 3 failed retry attempts
   */
  async sendWaitlistConfirmation(params: { email: string }): Promise<void> {
    const { email } = params;

    const fromEmail = this.config.get<string>('FROM_EMAIL') || 'help@ptah.live';
    const fromName = this.config.get<string>('FROM_NAME') || 'Ptah Team';

    const msg = {
      from: `${fromName} <${fromEmail}>`,
      to: [email],
      subject: "You're on the Ptah Builders waitlist",
      html: this.getWaitlistConfirmationTemplate(),
    };

    this.logger.log(`Sending Builders waitlist confirmation to ${email}`);
    await this.sendWithRetry(msg, 3);
    this.logger.log(`Builders waitlist confirmation sent to ${email}`);
  }

  /**
   * Send the founding early-adopter invite to a waitlist member.
   *
   * Fired by an admin invite wave (POST /api/v1/admin/waitlist/invite). Carries
   * BOTH checkout options with the founding discounts applied:
   *   - Monthly at 35% off for the first 12 billing cycles
   *   - Yearly at 50% off for the first year
   *
   * The CTA links point at the landing pricing page with `promo=founding`, the
   * billing `cycle`, and a `d=<paddleDiscountId>` param so the landing checkout
   * can pass the discount straight to Paddle. Discount IDs are read from
   * `PADDLE_DISCOUNT_ID_BUILDERS_MONTHLY` / `_YEARLY` via ConfigService.
   *
   * Callers (WaitlistService.inviteBatch) treat a delivery failure as a signal
   * NOT to stamp `notifiedAt`, so the row can be retried on the next wave.
   *
   * @param params - Email parameters (email)
   * @throws Error after 3 failed retry attempts
   */
  async sendFoundingInvite(params: { email: string }): Promise<void> {
    const { email } = params;

    const fromEmail = this.config.get<string>('FROM_EMAIL') || 'help@ptah.live';
    const fromName = this.config.get<string>('FROM_NAME') || 'Ptah Team';

    const msg = {
      from: `${fromName} <${fromEmail}>`,
      to: [email],
      subject: "You're invited — founding member pricing",
      html: this.getFoundingInviteTemplate(),
    };

    this.logger.log(`Sending founding invite to ${email}`);
    await this.sendWithRetry(msg, 3);
    this.logger.log(`Founding invite sent to ${email}`);
  }

  async sendMagicLink(params: {
    email: string;
    magicLink: string;
  }): Promise<void> {
    const { email, magicLink } = params;

    const fromEmail = this.config.get<string>('FROM_EMAIL') || 'help@ptah.live';
    const fromName = this.config.get<string>('FROM_NAME') || 'Ptah Team';

    const msg = {
      from: `${fromName} <${fromEmail}>`,
      to: [email],
      subject: 'Login to Ptah Portal',
      html: this.getMagicLinkTemplate({ magicLink }),
    };

    this.logger.log(`Sending magic link email to ${email}`);
    await this.sendWithRetry(msg, 3);
    this.logger.log(`Magic link email sent successfully to ${email}`);
  }

  /**
   * Send email with retry logic (3 attempts with exponential backoff)
   *
   * Retry delays: 1s, 2s, 4s
   *
   * @private
   * @param msg - Resend message object
   * @param attempts - Number of retry attempts
   * @throws Error if all attempts fail
   */
  private async sendWithRetry(
    msg: {
      from: string;
      to: string[];
      subject: string;
      html: string;
      replyTo?: string;
      headers?: Record<string, string>;
      tags?: Array<{ name: string; value: string }>;
    },
    attempts: number,
  ): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      try {
        const { error } = await this.mailService.emails.send(msg);
        if (error) {
          throw new Error(error.message);
        }
        return;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';

        if (i === attempts - 1) {
          this.logger.error(
            `Email send failed after ${attempts} attempts: ${errorMessage}`,
          );
          throw error;
        }

        const delayMs = Math.pow(2, i) * 1000;
        this.logger.warn(
          `Email send attempt ${
            i + 1
          } failed, retrying in ${delayMs}ms: ${errorMessage}`,
        );
        await this.sleep(delayMs);
      }
    }
  }

  /**
   * Sleep utility for retry delays
   *
   * @private
   * @param ms - Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Generate license key email HTML template
   *
   * @private
   * @param params - Template parameters (licenseKey, plan, expiresAt)
   * @returns HTML email content
   */
  private getLicenseKeyTemplate(params: {
    licenseKey: string;
    plan: string;
    expiresAt: Date | null;
  }): string {
    const { licenseKey, plan, expiresAt } = params;
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'https://ptah.live';

    const expirationText = expiresAt
      ? `<p><strong>Expires:</strong> ${expiresAt.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}</p>`
      : '<p><strong>Expires:</strong> Never</p>';

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Ptah License Key</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #f1f5f9; margin: 0; padding: 0; background-color: #0f172a; }
          .container { max-width: 600px; margin: 0 auto; }
          .header { background: linear-gradient(135deg, #d4af37 0%, #8a6d10 100%); padding: 32px 24px; text-align: center; }
          .header h1 { color: #0a0a0a; margin: 0; font-size: 28px; font-weight: 700; }
          .header p { color: #0a0a0a; opacity: 0.8; margin: 8px 0 0; font-size: 14px; letter-spacing: 1px; text-transform: uppercase; }
          .content { background-color: #1e293b; padding: 32px 24px; }
          .plan-badge { display: inline-block; background-color: #d4af37; color: #0a0a0a; padding: 4px 16px; border-radius: 12px; font-size: 13px; font-weight: 700; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
          .license-key { background-color: #0f172a; border: 2px solid #d4af37; border-radius: 8px; padding: 16px; font-family: 'Courier New', monospace; font-size: 14px; word-break: break-all; margin: 20px 0; color: #f4d47c; }
          .expiry { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
          h2 { color: #f4d47c; font-size: 18px; margin-top: 28px; }
          ol { padding-left: 20px; color: #cbd5e1; }
          li { margin-bottom: 10px; }
          li strong { color: #f1f5f9; }
          .manage-link { display: inline-block; margin-top: 20px; color: #f4d47c; text-decoration: none; font-weight: 600; }
          .footer { background-color: #0f172a; padding: 24px; text-align: center; border-top: 1px solid #334155; }
          .footer p { color: #64748b; font-size: 13px; margin: 4px 0; }
          .footer a { color: #d4af37; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to the Orchestra</h1>
            <p>Your Ptah License Is Ready</p>
          </div>
          <div class="content">
            <div class="plan-badge">${plan}</div>
            <p>You now have access to Ptah's full AI coding orchestra — 3 agent runtimes, 200+ LLM models, and 14 MCP tools, all unified in VS Code.</p>
            <p style="color: #94a3b8; font-size: 14px;">Here's your license key:</p>
            <div class="license-key">${licenseKey}</div>
            ${expirationText}

            <h2>Setup in 5 Steps</h2>
            <ol>
              <li>Open VS Code settings (<strong>Cmd+,</strong> on Mac or <strong>Ctrl+,</strong> on Windows/Linux)</li>
              <li>Search for <strong>"Ptah"</strong> in the settings search bar</li>
              <li>Find <strong>"Ptah: License Key"</strong> setting</li>
              <li>Paste your license key in the input field</li>
              <li>Reload VS Code window (<strong>Cmd+Shift+P</strong> → "Reload Window")</li>
            </ol>

            <a href="${frontendUrl}/portal/dashboard" class="manage-link">Manage your license →</a>
          </div>
          <div class="footer">
            <p>Need help? Reply to this email.</p>
            <p>— The Ptah Team</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate magic link email HTML template
   *
   * @private
   * @param params - Template parameters (magicLink)
   * @returns HTML email content
   */
  private getMagicLinkTemplate(params: { magicLink: string }): string {
    const { magicLink } = params;

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Login to Ptah Portal</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #f1f5f9; margin: 0; padding: 0; background-color: #0f172a; }
          .container { max-width: 600px; margin: 0 auto; }
          .header { background: linear-gradient(135deg, #d4af37 0%, #8a6d10 100%); padding: 28px 24px; text-align: center; }
          .header h1 { color: #0a0a0a; margin: 0; font-size: 24px; font-weight: 700; }
          .content { background-color: #1e293b; padding: 32px 24px; text-align: center; }
          .login-button { display: inline-block; background-color: #d4af37; color: #0a0a0a; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: 700; margin: 24px 0; font-size: 16px; }
          .warning { background-color: #0f172a; border-left: 4px solid #d4af37; padding: 12px 16px; margin: 24px 0; border-radius: 4px; text-align: left; }
          .warning strong { color: #f4d47c; }
          .fallback { text-align: left; margin-top: 24px; color: #94a3b8; font-size: 14px; }
          .fallback-link { word-break: break-all; color: #f4d47c; }
          .footer { background-color: #0f172a; padding: 24px; text-align: center; border-top: 1px solid #334155; }
          .footer p { color: #64748b; font-size: 13px; margin: 4px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Ptah Portal Login</h1>
          </div>
          <div class="content">
            <p>Click below to access your Ptah Portal:</p>
            <a href="${magicLink}" class="login-button">Enter the Portal</a>

            <div class="warning">
              <strong>Link expires in 2 minutes</strong><br>
              <span style="color: #94a3b8;">Click the link promptly to avoid expiration.</span>
            </div>

            <div class="fallback">
              <p>If the button doesn't work, copy and paste this link into your browser:</p>
              <p class="fallback-link">${magicLink}</p>
            </div>
          </div>
          <div class="footer">
            <p><strong style="color: #94a3b8;">Security Notice:</strong> Didn't request this? You can safely ignore this email.</p>
            <p>— The Ptah Team</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Send contact form message to team
   */
  async sendContactMessage(params: {
    userEmail: string;
    userId: string;
    subject: string;
    message: string;
    category: string;
  }): Promise<void> {
    const { userEmail, userId, subject, message, category } = params;

    const fromEmail = this.config.get<string>('FROM_EMAIL') || 'help@ptah.live';
    const fromName = this.config.get<string>('FROM_NAME') || 'Ptah Team';

    const msg = {
      from: `${fromName} <${fromEmail}>`,
      to: ['help@ptah.live'],
      subject: `[Contact - ${category}] ${subject}`,
      html: this.getContactMessageTemplate({
        userEmail,
        userId,
        subject,
        message,
        category,
      }),
      replyTo: userEmail,
    };

    this.logger.log(`Sending contact message from ${userEmail} (${category})`);
    await this.sendWithRetry(msg, 3);
    this.logger.log(`Contact message sent successfully from ${userEmail}`);
  }

  /**
   * Send session request notification to team
   */
  async sendSessionRequestNotification(params: {
    userEmail: string;
    sessionTopicId: string;
    additionalNotes?: string;
    isFreeSession: boolean;
  }): Promise<void> {
    const { userEmail, sessionTopicId, additionalNotes, isFreeSession } =
      params;

    const fromEmail = this.config.get<string>('FROM_EMAIL') || 'help@ptah.live';
    const fromName = this.config.get<string>('FROM_NAME') || 'Ptah Team';

    const msg = {
      from: `${fromName} <${fromEmail}>`,
      to: ['help@ptah.live'],
      subject: `[Session Request] ${sessionTopicId} - ${userEmail}`,
      html: this.getSessionRequestNotificationTemplate({
        userEmail,
        sessionTopicId,
        additionalNotes,
        isFreeSession,
      }),
      replyTo: userEmail,
    };

    this.logger.log(`Sending session request notification for ${userEmail}`);
    await this.sendWithRetry(msg, 3);
    this.logger.log(`Session request notification sent for ${userEmail}`);
  }

  /**
   * Send session confirmation to user
   */
  async sendSessionConfirmation(params: {
    userEmail: string;
    sessionTopicId: string;
    isFreeSession: boolean;
  }): Promise<void> {
    const { userEmail, sessionTopicId, isFreeSession } = params;

    const fromEmail = this.config.get<string>('FROM_EMAIL') || 'help@ptah.live';
    const fromName = this.config.get<string>('FROM_NAME') || 'Ptah Team';

    const msg = {
      from: `${fromName} <${fromEmail}>`,
      to: [userEmail],
      subject: 'Your Ptah Session Request Has Been Received',
      html: this.getSessionConfirmationTemplate({
        sessionTopicId,
        isFreeSession,
      }),
    };

    this.logger.log(`Sending session confirmation to ${userEmail}`);
    await this.sendWithRetry(msg, 3);
    this.logger.log(`Session confirmation sent to ${userEmail}`);
  }

  /**
   * Builders waitlist confirmation email template.
   *
   * @private
   * @returns HTML email content
   */
  private getWaitlistConfirmationTemplate(): string {
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'https://ptah.live';

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>You're on the Ptah Builders waitlist</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #f1f5f9; margin: 0; padding: 0; background-color: #0f172a; }
          .container { max-width: 600px; margin: 0 auto; }
          .header { background: linear-gradient(135deg, #d4af37 0%, #8a6d10 100%); padding: 32px 24px; text-align: center; }
          .header h1 { color: #0a0a0a; margin: 0; font-size: 26px; font-weight: 700; }
          .header p { color: #0a0a0a; opacity: 0.8; margin: 8px 0 0; font-size: 14px; letter-spacing: 1px; text-transform: uppercase; }
          .content { background-color: #1e293b; padding: 32px 24px; }
          .badge { display: inline-block; background-color: #d4af37; color: #0a0a0a; padding: 4px 16px; border-radius: 12px; font-size: 13px; font-weight: 700; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
          .content p { color: #cbd5e1; }
          .footer { background-color: #0f172a; padding: 24px; text-align: center; border-top: 1px solid #334155; }
          .footer p { color: #64748b; font-size: 13px; margin: 4px 0; }
          .footer a { color: #d4af37; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>You're on the list</h1>
            <p>Ptah Builders Waitlist</p>
          </div>
          <div class="content">
            <div class="badge">Builders</div>
            <p>Thanks for joining the waitlist for <strong style="color: #f4d47c;">Ptah Builders</strong> — the premium tier of the Ptah coding orchestra.</p>
            <p>The full Community edition of Ptah is free and open source, and you can keep building with it today. Builders adds the next layer on top, and we'll email you the moment early access opens up.</p>
            <p>No action needed for now — sit tight and keep orchestrating.</p>
          </div>
          <div class="footer">
            <p>Questions? Just reply to this email.</p>
            <p>— The Ptah Team &middot; <a href="${frontendUrl}">ptah.live</a></p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Build a founding-invite checkout link for the landing pricing page.
   *
   * Shape: `${frontendUrl}/pricing?promo=founding&cycle=<cycle>[&d=<discountId>]`.
   * The `d` param is only appended when the corresponding Paddle discount ID is
   * configured, so a missing env var degrades to a plain founding link rather
   * than a broken `d=` query.
   *
   * @private
   */
  private buildFoundingCheckoutUrl(
    frontendUrl: string,
    cycle: 'monthly' | 'yearly',
    discountId: string | undefined,
  ): string {
    const base = `${frontendUrl}/pricing?promo=founding&cycle=${cycle}`;
    return discountId ? `${base}&d=${encodeURIComponent(discountId)}` : base;
  }

  /**
   * Founding early-adopter invite email template (dark/gold).
   *
   * @private
   * @returns HTML email content
   */
  private getFoundingInviteTemplate(): string {
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'https://ptah.live';
    const monthlyDiscountId = this.config.get<string>(
      'PADDLE_DISCOUNT_ID_BUILDERS_MONTHLY',
    );
    const yearlyDiscountId = this.config.get<string>(
      'PADDLE_DISCOUNT_ID_BUILDERS_YEARLY',
    );
    const monthlyUrl = this.buildFoundingCheckoutUrl(
      frontendUrl,
      'monthly',
      monthlyDiscountId,
    );
    const yearlyUrl = this.buildFoundingCheckoutUrl(
      frontendUrl,
      'yearly',
      yearlyDiscountId,
    );

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>You're invited — founding member pricing</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #f1f5f9; margin: 0; padding: 0; background-color: #0f172a; }
          .container { max-width: 600px; margin: 0 auto; }
          .header { background: linear-gradient(135deg, #d4af37 0%, #8a6d10 100%); padding: 32px 24px; text-align: center; }
          .header h1 { color: #0a0a0a; margin: 0; font-size: 26px; font-weight: 700; }
          .header p { color: #0a0a0a; opacity: 0.8; margin: 8px 0 0; font-size: 14px; letter-spacing: 1px; text-transform: uppercase; }
          .content { background-color: #1e293b; padding: 32px 24px; }
          .badge { display: inline-block; background-color: #d4af37; color: #0a0a0a; padding: 4px 16px; border-radius: 12px; font-size: 13px; font-weight: 700; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
          .content p { color: #cbd5e1; }
          .plans { margin: 24px 0; }
          .plan { background-color: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
          .plan.featured { border-color: #d4af37; }
          .plan h3 { color: #f4d47c; margin: 0 0 4px; font-size: 18px; }
          .plan .price { color: #f1f5f9; font-size: 15px; margin: 0 0 4px; }
          .plan .price s { color: #64748b; }
          .plan .save { color: #4ade80; font-size: 13px; font-weight: 600; margin: 0 0 16px; }
          .cta { display: inline-block; background-color: #d4af37; color: #0a0a0a; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 700; font-size: 15px; }
          .guarantee { background-color: #0f172a; border-left: 4px solid #d4af37; padding: 12px 16px; margin: 24px 0; border-radius: 4px; }
          .guarantee strong { color: #f4d47c; }
          .footer { background-color: #0f172a; padding: 24px; text-align: center; border-top: 1px solid #334155; }
          .footer p { color: #64748b; font-size: 13px; margin: 4px 0; }
          .footer a { color: #d4af37; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>You're invited</h1>
            <p>Founding Member Pricing</p>
          </div>
          <div class="content">
            <div class="badge">Ptah Builders</div>
            <p>You were one of the first to join the waitlist, so you get first access to <strong style="color: #f4d47c;">Ptah Builders</strong> — and a founding-member discount reserved for early adopters.</p>
            <p>Pick the billing cycle that suits you:</p>

            <div class="plans">
              <div class="plan featured">
                <h3>Yearly — best value</h3>
                <p class="price"><s>$290/year</s> &nbsp; $145 for your first year</p>
                <p class="save">50% off the first year</p>
                <a href="${yearlyUrl}" class="cta">Claim yearly →</a>
              </div>
              <div class="plan">
                <h3>Monthly</h3>
                <p class="price"><s>$29/month</s> &nbsp; $18.85/month</p>
                <p class="save">35% off for your first 12 billing cycles</p>
                <a href="${monthlyUrl}" class="cta">Claim monthly →</a>
              </div>
            </div>

            <div class="guarantee">
              <strong>30-day money-back guarantee.</strong>
              <span style="color: #94a3b8;"> Full refund on your first charge if Builders isn't for you. Renewals are cancel-anytime and non-refundable.</span>
            </div>

            <p style="color: #94a3b8; font-size: 14px;">The open-source Community edition stays free forever — Builders simply layers hosted perks, priority support and early access on top.</p>
          </div>
          <div class="footer">
            <p>Questions? Just reply to this email.</p>
            <p>— The Ptah Team &middot; <a href="${frontendUrl}">ptah.live</a></p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getContactMessageTemplate(params: {
    userEmail: string;
    userId: string;
    subject: string;
    message: string;
    category: string;
  }): string {
    const { userEmail, userId, subject, message, category } = params;

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Contact Message</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          h1 { color: #4A5568; margin-bottom: 20px; }
          .user-info { background-color: #F7FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin: 20px 0; }
          .category-badge { display: inline-block; background-color: #3182CE; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; margin-bottom: 16px; }
          .message-body { background-color: #FFFBEB; border-left: 4px solid #F59E0B; padding: 16px; margin: 20px 0; border-radius: 4px; white-space: pre-wrap; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #E2E8F0; font-size: 14px; color: #718096; }
        </style>
      </head>
      <body>
        <h1>New Contact Message</h1>

        <div class="category-badge">${category}</div>

        <div class="user-info">
          <p><strong>From:</strong> ${userEmail}</p>
          <p><strong>User ID:</strong> ${userId}</p>
          <p><strong>Subject:</strong> ${subject}</p>
        </div>

        <h2>Message:</h2>
        <div class="message-body">${message}</div>

        <div class="footer">
          <p>Reply directly to this email to respond to the user.</p>
        </div>
      </body>
      </html>
    `;
  }

  private getSessionRequestNotificationTemplate(params: {
    userEmail: string;
    sessionTopicId: string;
    additionalNotes?: string;
    isFreeSession: boolean;
  }): string {
    const { userEmail, sessionTopicId, additionalNotes, isFreeSession } =
      params;
    const badge = isFreeSession
      ? '<span style="display:inline-block;background-color:#48BB78;color:white;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:600;">FREE</span>'
      : '<span style="display:inline-block;background-color:#ED8936;color:white;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:600;">PAID - $100</span>';

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Session Request</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          h1 { color: #4A5568; margin-bottom: 20px; }
          .details { background-color: #F7FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin: 20px 0; }
          .notes { background-color: #FFFBEB; border-left: 4px solid #F59E0B; padding: 16px; margin: 20px 0; border-radius: 4px; white-space: pre-wrap; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #E2E8F0; font-size: 14px; color: #718096; }
        </style>
      </head>
      <body>
        <h1>New Session Request</h1>

        ${badge}

        <div class="details">
          <p><strong>User:</strong> ${userEmail}</p>
          <p><strong>Topic:</strong> ${sessionTopicId}</p>
          <p><strong>Type:</strong> ${
            isFreeSession ? 'Free (community)' : 'Paid ($100)'
          }</p>
        </div>

        ${
          additionalNotes
            ? `<h2>Additional Notes:</h2><div class="notes">${additionalNotes}</div>`
            : ''
        }

        <div class="footer">
          <p>Reply to this email to contact the user and schedule the session.</p>
        </div>
      </body>
      </html>
    `;
  }

  private getSessionConfirmationTemplate(params: {
    sessionTopicId: string;
    isFreeSession: boolean;
  }): string {
    const { sessionTopicId, isFreeSession } = params;

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Session Request Received</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #f1f5f9; margin: 0; padding: 0; background-color: #0f172a; }
          .container { max-width: 600px; margin: 0 auto; }
          .header { background: linear-gradient(135deg, #d4af37 0%, #8a6d10 100%); padding: 28px 24px; text-align: center; }
          .header h1 { color: #0a0a0a; margin: 0; font-size: 24px; font-weight: 700; }
          .content { background-color: #1e293b; padding: 32px 24px; }
          .details { background-color: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 20px; margin: 24px 0; }
          .details p { margin: 6px 0; color: #cbd5e1; }
          .details strong { color: #f4d47c; }
          .next-steps { background-color: #0f172a; border-left: 4px solid #d4af37; border-radius: 4px; padding: 20px; margin: 24px 0; }
          .next-steps strong { color: #f4d47c; }
          .next-steps ol { padding-left: 20px; color: #cbd5e1; }
          .next-steps li { margin-bottom: 8px; }
          .footer { background-color: #0f172a; padding: 24px; text-align: center; border-top: 1px solid #334155; }
          .footer p { color: #64748b; font-size: 13px; margin: 4px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Session Request Received</h1>
          </div>
          <div class="content">
            <p>Your session request has been submitted successfully.</p>

            <div class="details">
              <p><strong>Topic:</strong> ${sessionTopicId}</p>
              <p><strong>Duration:</strong> 2 hours</p>
              <p><strong>Price:</strong> ${
                isFreeSession ? 'FREE (your first session!)' : '$100'
              }</p>
            </div>

            <div class="next-steps">
              <strong>What happens next:</strong>
              <ol>
                <li>Our team will review your request</li>
                <li>We'll reach out via email with available dates</li>
                <li>You confirm your preferred date and time</li>
                <li>We'll send a calendar invite with the meeting link</li>
              </ol>
            </div>

          </div>
          <div class="footer">
            <p>Questions? Reply to this email.</p>
            <p>— The Ptah Team</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}
