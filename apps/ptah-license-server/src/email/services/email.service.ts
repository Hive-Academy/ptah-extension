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
    private readonly config: ConfigService,
    @Inject(RESEND_MAIL_SERVICE)
    private readonly mailService: ResendMailService
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
    },
    attempts: number
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
            `Email send failed after ${attempts} attempts: ${errorMessage}`
          );
          throw error;
        }

        const delayMs = Math.pow(2, i) * 1000;
        this.logger.warn(
          `Email send attempt ${
            i + 1
          } failed, retrying in ${delayMs}ms: ${errorMessage}`
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
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          h1 { color: #4A5568; margin-bottom: 20px; }
          .license-key { background-color: #F7FAFC; border: 2px solid #E2E8F0; border-radius: 8px; padding: 16px; font-family: 'Courier New', monospace; font-size: 14px; word-break: break-all; margin: 20px 0; }
          .plan-badge { display: inline-block; background-color: #48BB78; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; margin-bottom: 10px; }
          ol { padding-left: 20px; }
          li { margin-bottom: 8px; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #E2E8F0; font-size: 14px; color: #718096; }
          a { color: #4299E1; text-decoration: none; }
        </style>
      </head>
      <body>
        <h1>Welcome to Ptah Premium!</h1>
        <div class="plan-badge">${plan}</div>
        <p>Your Ptah premium license is ready. Here's your license key:</p>
        <div class="license-key">${licenseKey}</div>
        ${expirationText}

        <h2>Setup Instructions:</h2>
        <ol>
          <li>Open VS Code settings (<strong>Cmd+,</strong> on Mac or <strong>Ctrl+,</strong> on Windows/Linux)</li>
          <li>Search for <strong>"Ptah"</strong> in the settings search bar</li>
          <li>Find <strong>"Ptah: License Key"</strong> setting</li>
          <li>Paste your license key in the input field</li>
          <li>Reload VS Code window (<strong>Cmd+Shift+P</strong> → "Reload Window")</li>
        </ol>

        <p>Manage your license at: <a href="${frontendUrl}/portal/dashboard">${frontendUrl}/portal/dashboard</a></p>

        <div class="footer">
          <p>Need help? Reply to this email or reach out to our support team.</p>
          <p>- The Ptah Team</p>
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
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          h1 { color: #4A5568; margin-bottom: 20px; }
          .login-button { display: inline-block; background-color: #4299E1; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 20px 0; }
          .warning { background-color: #FFF5F5; border-left: 4px solid #FC8181; padding: 12px; margin: 20px 0; border-radius: 4px; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #E2E8F0; font-size: 14px; color: #718096; }
        </style>
      </head>
      <body>
        <h1>Login to Ptah Portal</h1>
        <p>Click the button below to access your Ptah Portal:</p>
        <a href="${magicLink}" class="login-button">Login to Portal</a>

        <div class="warning">
          <strong>⏱️ This link expires in 2 minutes</strong><br>
          Please click the link soon to avoid expiration.
        </div>

        <p>If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #4299E1;">${magicLink}</p>

        <div class="footer">
          <p><strong>Security Notice:</strong> Didn't request this login link? You can safely ignore this email.</p>
          <p>- The Ptah Team</p>
        </div>
      </body>
      </html>
    `;
  }

  // ============================================================
  // Contact & Session Email Methods
  // ============================================================

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

  // ============================================================
  // Trial Reminder Email Methods (TASK_2025_142)
  // ============================================================

  /**
   * Send 7-day trial reminder email
   *
   * @param params - Email, firstName, trialEnd date
   * @throws Error after 3 failed retry attempts
   */
  async sendTrialReminder7Day(params: {
    email: string;
    firstName: string | null;
    trialEnd: Date;
  }): Promise<void> {
    const { email, firstName, trialEnd } = params;

    const fromEmail = this.config.get<string>('FROM_EMAIL') || 'help@ptah.live';
    const fromName = this.config.get<string>('FROM_NAME') || 'Ptah Team';

    const msg = {
      from: `${fromName} <${fromEmail}>`,
      to: [email],
      subject: 'Your Ptah Pro trial ends in 7 days',
      html: this.getTrialReminder7DayTemplate({ firstName, trialEnd }),
    };

    this.logger.log(`Sending 7-day trial reminder to ${email}`);
    await this.sendWithRetry(msg, 3);
    this.logger.log(`7-day trial reminder sent successfully to ${email}`);
  }

  /**
   * Send 3-day trial reminder email
   *
   * @param params - Email, firstName, trialEnd date
   * @throws Error after 3 failed retry attempts
   */
  async sendTrialReminder3Day(params: {
    email: string;
    firstName: string | null;
    trialEnd: Date;
  }): Promise<void> {
    const { email, firstName, trialEnd } = params;

    const fromEmail = this.config.get<string>('FROM_EMAIL') || 'help@ptah.live';
    const fromName = this.config.get<string>('FROM_NAME') || 'Ptah Team';

    const msg = {
      from: `${fromName} <${fromEmail}>`,
      to: [email],
      subject: '3 days left in your Ptah Pro trial',
      html: this.getTrialReminder3DayTemplate({ firstName, trialEnd }),
    };

    this.logger.log(`Sending 3-day trial reminder to ${email}`);
    await this.sendWithRetry(msg, 3);
    this.logger.log(`3-day trial reminder sent successfully to ${email}`);
  }

  /**
   * Send 1-day trial reminder email
   *
   * @param params - Email, firstName, trialEnd date
   * @throws Error after 3 failed retry attempts
   */
  async sendTrialReminder1Day(params: {
    email: string;
    firstName: string | null;
    trialEnd: Date;
  }): Promise<void> {
    const { email, firstName, trialEnd } = params;

    const fromEmail = this.config.get<string>('FROM_EMAIL') || 'help@ptah.live';
    const fromName = this.config.get<string>('FROM_NAME') || 'Ptah Team';

    const msg = {
      from: `${fromName} <${fromEmail}>`,
      to: [email],
      subject: 'Your Ptah Pro trial ends tomorrow',
      html: this.getTrialReminder1DayTemplate({ firstName, trialEnd }),
    };

    this.logger.log(`Sending 1-day trial reminder to ${email}`);
    await this.sendWithRetry(msg, 3);
    this.logger.log(`1-day trial reminder sent successfully to ${email}`);
  }

  /**
   * Send trial expired notification email
   *
   * @param params - Email, firstName
   * @throws Error after 3 failed retry attempts
   */
  async sendTrialExpired(params: {
    email: string;
    firstName: string | null;
  }): Promise<void> {
    const { email, firstName } = params;

    const fromEmail = this.config.get<string>('FROM_EMAIL') || 'help@ptah.live';
    const fromName = this.config.get<string>('FROM_NAME') || 'Ptah Team';

    const msg = {
      from: `${fromName} <${fromEmail}>`,
      to: [email],
      subject: 'Your Ptah Pro trial has ended',
      html: this.getTrialExpiredTemplate({ firstName }),
    };

    this.logger.log(`Sending trial expired notification to ${email}`);
    await this.sendWithRetry(msg, 3);
    this.logger.log(`Trial expired notification sent successfully to ${email}`);
  }

  /**
   * Send notification that user has been downgraded to Community plan
   *
   * TASK_2025_143: Called when trial expires and user is auto-downgraded
   *
   * @param params - Email, firstName
   * @throws Error after 3 failed retry attempts
   */
  async sendTrialDowngradedToCommunity(params: {
    email: string;
    firstName: string | null;
  }): Promise<void> {
    const { email, firstName } = params;

    const fromEmail = this.config.get<string>('FROM_EMAIL') || 'help@ptah.live';
    const fromName = this.config.get<string>('FROM_NAME') || 'Ptah Team';

    const msg = {
      from: `${fromName} <${fromEmail}>`,
      to: [email],
      subject: "Welcome to Ptah Community - You're all set!",
      html: this.getTrialDowngradedToCommunityTemplate({ firstName }),
    };

    this.logger.log(`Sending Community welcome email to ${email}`);
    await this.sendWithRetry(msg, 3);
    this.logger.log(`Community welcome email sent successfully to ${email}`);
  }

  // ============================================================
  // Trial Reminder Email Templates (TASK_2025_142)
  // ============================================================

  /**
   * 7-day trial reminder email template
   *
   * @private
   * @param params - Template parameters (firstName, trialEnd)
   * @returns HTML email content
   */
  private getTrialReminder7DayTemplate(params: {
    firstName: string | null;
    trialEnd: Date;
  }): string {
    const { firstName, trialEnd } = params;
    const greeting = firstName ? `Hi ${firstName}` : 'Hi there';
    const endDate = trialEnd.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'https://ptah.live';

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Ptah Pro trial ends in 7 days</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          h1 { color: #4A5568; margin-bottom: 20px; }
          .countdown-badge { display: inline-block; background-color: #3182CE; color: white; padding: 4px 12px; border-radius: 12px; font-size: 14px; font-weight: 600; margin-bottom: 16px; }
          .feature-list { background-color: #F7FAFC; border-radius: 8px; padding: 16px; margin: 20px 0; }
          .feature-item { display: flex; align-items: center; margin-bottom: 8px; }
          .feature-icon { width: 20px; height: 20px; margin-right: 8px; color: #48BB78; }
          .cta-button { display: inline-block; background-color: #4F46E5; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 20px 0; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #E2E8F0; font-size: 14px; color: #718096; }
        </style>
      </head>
      <body>
        <h1>${greeting},</h1>

        <div class="countdown-badge">7 days remaining</div>

        <p>Your Ptah Pro trial will end on <strong>${endDate}</strong>.</p>

        <p>You've been enjoying these Pro features:</p>

        <div class="feature-list">
          <div class="feature-item">
            <span class="feature-icon">✓</span>
            <span>Advanced multi-agent orchestration</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon">✓</span>
            <span>Priority API access & faster responses</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon">✓</span>
            <span>Extended context window & memory</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon">✓</span>
            <span>Custom agent creation & MCP tools</span>
          </div>
        </div>

        <p>Upgrade now to keep using these features after your trial ends.</p>

        <a href="${frontendUrl}/pricing" class="cta-button">Upgrade Now</a>

        <div class="footer">
          <p>If you have any questions, just reply to this email.</p>
          <p>- The Ptah Team</p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * 3-day trial reminder email template
   *
   * @private
   * @param params - Template parameters (firstName, trialEnd)
   * @returns HTML email content
   */
  private getTrialReminder3DayTemplate(params: {
    firstName: string | null;
    trialEnd: Date;
  }): string {
    const { firstName, trialEnd } = params;
    const greeting = firstName ? `Hi ${firstName}` : 'Hi there';
    const endDate = trialEnd.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'https://ptah.live';

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>3 days left in your Ptah Pro trial</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          h1 { color: #4A5568; margin-bottom: 20px; }
          .countdown-badge { display: inline-block; background-color: #ED8936; color: white; padding: 4px 12px; border-radius: 12px; font-size: 14px; font-weight: 600; margin-bottom: 16px; }
          .comparison-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          .comparison-table th, .comparison-table td { padding: 12px; text-align: left; border-bottom: 1px solid #E2E8F0; }
          .comparison-table th { background-color: #F7FAFC; }
          .check { color: #48BB78; }
          .cross { color: #E53E3E; }
          .cta-button { display: inline-block; background-color: #4F46E5; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 20px 0; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #E2E8F0; font-size: 14px; color: #718096; }
        </style>
      </head>
      <body>
        <h1>${greeting},</h1>

        <div class="countdown-badge">Only 3 days left</div>

        <p>Your Ptah Pro trial ends on <strong>${endDate}</strong>. Here's what changes after your trial:</p>

        <table class="comparison-table">
          <tr>
            <th>Feature</th>
            <th>Pro</th>
            <th>Community</th>
          </tr>
          <tr>
            <td>Multi-agent orchestration</td>
            <td class="check">✓ Full</td>
            <td class="cross">✗ Limited</td>
          </tr>
          <tr>
            <td>Context window</td>
            <td class="check">✓ Extended</td>
            <td class="cross">✗ Standard</td>
          </tr>
          <tr>
            <td>Custom agents & MCP</td>
            <td class="check">✓ Unlimited</td>
            <td class="cross">✗ None</td>
          </tr>
          <tr>
            <td>Priority support</td>
            <td class="check">✓ Yes</td>
            <td class="cross">✗ No</td>
          </tr>
        </table>

        <a href="${frontendUrl}/pricing" class="cta-button">Upgrade to Pro</a>

        <div class="footer">
          <p>Questions? Reply to this email and we'll help you out.</p>
          <p>- The Ptah Team</p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * 1-day trial reminder email template (urgent)
   *
   * @private
   * @param params - Template parameters (firstName, trialEnd)
   * @returns HTML email content
   */
  private getTrialReminder1DayTemplate(params: {
    firstName: string | null;
    trialEnd: Date;
  }): string {
    const { firstName, trialEnd } = params;
    const greeting = firstName
      ? `${firstName}, this is your last chance!`
      : 'This is your last chance!';
    const endDate = trialEnd.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'https://ptah.live';

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Ptah Pro trial ends tomorrow</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          h1 { color: #E53E3E; margin-bottom: 20px; }
          .urgent-badge { display: inline-block; background-color: #E53E3E; color: white; padding: 6px 16px; border-radius: 12px; font-size: 14px; font-weight: 600; margin-bottom: 16px; }
          .warning-box { background-color: #FFF5F5; border-left: 4px solid #E53E3E; padding: 16px; margin: 20px 0; border-radius: 4px; }
          .cta-button { display: inline-block; background-color: #4F46E5; color: white; padding: 14px 36px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 20px 0; font-size: 16px; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #E2E8F0; font-size: 14px; color: #718096; }
        </style>
      </head>
      <body>
        <h1>${greeting}</h1>

        <div class="urgent-badge">Trial ends tomorrow</div>

        <p>Your Ptah Pro trial expires on <strong>${endDate}</strong>.</p>

        <div class="warning-box">
          <strong>What happens tomorrow:</strong><br>
          You'll be moved to the Community tier with limited features. Upgrade now to keep full access to Pro features without interruption.
        </div>

        <a href="${frontendUrl}/pricing" class="cta-button">Upgrade Now</a>

        <p style="color: #718096; font-size: 14px;">
          Not ready to upgrade? No worries - you can continue using Ptah with the Community tier,
          and upgrade anytime to restore Pro features.
        </p>

        <div class="footer">
          <p>Questions? Reply to this email.</p>
          <p>- The Ptah Team</p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Trial expired notification email template
   *
   * @private
   * @param params - Template parameters (firstName)
   * @returns HTML email content
   */
  private getTrialExpiredTemplate(params: {
    firstName: string | null;
  }): string {
    const { firstName } = params;
    const greeting = firstName ? `Hi ${firstName}` : 'Hi there';
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'https://ptah.live';

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Ptah Pro trial has ended</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          h1 { color: #4A5568; margin-bottom: 20px; }
          .status-box { background-color: #F7FAFC; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center; }
          .status-icon { font-size: 48px; margin-bottom: 12px; }
          .community-info { background-color: #EBF8FF; border-radius: 8px; padding: 16px; margin: 20px 0; }
          .cta-button { display: inline-block; background-color: #4F46E5; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 20px 0; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #E2E8F0; font-size: 14px; color: #718096; }
        </style>
      </head>
      <body>
        <h1>${greeting},</h1>

        <div class="status-box">
          <div class="status-icon">📅</div>
          <p><strong>Your 14-day Pro trial has ended</strong></p>
        </div>

        <div class="community-info">
          <p><strong>What's changed:</strong></p>
          <p>You now have access to Ptah's Community tier, which includes basic AI assistance
          and standard features. You can continue using Ptah for free!</p>
        </div>

        <p>Want to restore full Pro access? Upgrade anytime to unlock all premium features:</p>

        <ul>
          <li>Advanced multi-agent orchestration</li>
          <li>Extended context window & memory</li>
          <li>Custom agent creation & MCP tools</li>
          <li>Priority support</li>
        </ul>

        <a href="${frontendUrl}/pricing" class="cta-button">View Plans</a>

        <div class="footer">
          <p>Thank you for trying Ptah Pro! If you have feedback, we'd love to hear it.</p>
          <p>- The Ptah Team</p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Template for trial downgraded to Community email
   *
   * TASK_2025_143: Positive messaging about Community tier
   * Focus on what they CAN do, not what they lost
   *
   * @private
   * @param params - Template parameters (firstName)
   * @returns HTML email content
   */
  private getTrialDowngradedToCommunityTemplate(params: {
    firstName: string | null;
  }): string {
    const { firstName } = params;
    const greeting = firstName ? `Hi ${firstName}` : 'Hi there';
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'https://ptah.live';

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Ptah Community</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          h1 { color: #4A5568; margin-bottom: 20px; }
          .welcome-box { background-color: #F0FFF4; border: 1px solid #9AE6B4; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center; }
          .welcome-icon { font-size: 48px; margin-bottom: 12px; }
          .feature-list { background-color: #F7FAFC; border-radius: 8px; padding: 16px; margin: 20px 0; }
          .feature-item { display: flex; align-items: center; margin-bottom: 8px; }
          .feature-icon { width: 20px; height: 20px; margin-right: 8px; color: #48BB78; }
          .upgrade-box { background-color: #EBF8FF; border-radius: 8px; padding: 16px; margin: 20px 0; }
          .cta-button { display: inline-block; background-color: #4F46E5; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 20px 0; }
          .cta-secondary { display: inline-block; color: #4F46E5; text-decoration: none; font-weight: 600; margin-left: 16px; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #E2E8F0; font-size: 14px; color: #718096; }
        </style>
      </head>
      <body>
        <h1>${greeting},</h1>

        <div class="welcome-box">
          <div class="welcome-icon">🎉</div>
          <p><strong>Welcome to Ptah Community!</strong></p>
          <p>Your account is ready - you can keep using Ptah for free.</p>
        </div>

        <p>Your Pro trial has ended, but you still have access to great features:</p>

        <div class="feature-list">
          <div class="feature-item">
            <span class="feature-icon">✓</span>
            <span>AI-powered code assistance</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon">✓</span>
            <span>Chat with Claude in VS Code</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon">✓</span>
            <span>Basic code generation & editing</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon">✓</span>
            <span>Session history & management</span>
          </div>
        </div>

        <div class="upgrade-box">
          <p><strong>Want more power?</strong></p>
          <p>Upgrade to Pro anytime for advanced features like multi-agent orchestration,
          MCP tools, workspace intelligence, and priority support.</p>
        </div>

        <a href="${frontendUrl}/pricing" class="cta-button">Upgrade to Pro</a>
        <a href="${frontendUrl}/profile" class="cta-secondary">View Your Account →</a>

        <div class="footer">
          <p>Thank you for being part of the Ptah community!</p>
          <p>- The Ptah Team</p>
        </div>
      </body>
      </html>
    `;
  }

  // ============================================================
  // Contact & Session Email Templates
  // ============================================================

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
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          h1 { color: #4A5568; margin-bottom: 20px; }
          .status-box { background-color: #F0FFF4; border: 1px solid #9AE6B4; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center; }
          .status-icon { font-size: 48px; margin-bottom: 12px; }
          .details { background-color: #F7FAFC; border-radius: 8px; padding: 16px; margin: 20px 0; }
          .next-steps { background-color: #EBF8FF; border-radius: 8px; padding: 16px; margin: 20px 0; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #E2E8F0; font-size: 14px; color: #718096; }
        </style>
      </head>
      <body>
        <h1>Session Request Received!</h1>

        <div class="status-box">
          <div class="status-icon">✅</div>
          <p><strong>Your session request has been submitted</strong></p>
        </div>

        <div class="details">
          <p><strong>Topic:</strong> ${sessionTopicId}</p>
          <p><strong>Duration:</strong> 2 hours</p>
          <p><strong>Price:</strong> ${
            isFreeSession ? 'FREE (your first session!)' : '$100'
          }</p>
        </div>

        <div class="next-steps">
          <p><strong>What happens next:</strong></p>
          <ol>
            <li>Our team will review your request</li>
            <li>We'll reach out via email with available dates</li>
            <li>You'll confirm your preferred date and time</li>
            <li>We'll send you a calendar invite with the meeting link</li>
          </ol>
        </div>

        <div class="footer">
          <p>Questions? Reply to this email and we'll help you out.</p>
          <p>- The Ptah Team</p>
        </div>
      </body>
      </html>
    `;
  }
}
