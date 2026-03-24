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
            <p>You now have access to Ptah's full AI coding orchestra — 4 agent runtimes, 200+ LLM models, and 14 MCP tools, all unified in VS Code.</p>
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
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #f1f5f9; margin: 0; padding: 0; background-color: #0f172a; }
          .container { max-width: 600px; margin: 0 auto; }
          .header { background: linear-gradient(135deg, #d4af37 0%, #8a6d10 100%); padding: 28px 24px; text-align: center; }
          .header h1 { color: #0a0a0a; margin: 0; font-size: 24px; font-weight: 700; }
          .content { background-color: #1e293b; padding: 32px 24px; }
          .countdown-badge { display: inline-block; background-color: #d4af37; color: #0a0a0a; padding: 5px 16px; border-radius: 12px; font-size: 13px; font-weight: 700; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
          .feature-list { background-color: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 20px; margin: 24px 0; }
          .feature-item { margin-bottom: 10px; color: #cbd5e1; }
          .feature-icon { color: #d4af37; margin-right: 8px; }
          .cta-button { display: inline-block; background-color: #d4af37; color: #0a0a0a; padding: 14px 36px; border-radius: 6px; text-decoration: none; font-weight: 700; margin: 20px 0; font-size: 15px; }
          .footer { background-color: #0f172a; padding: 24px; text-align: center; border-top: 1px solid #334155; }
          .footer p { color: #64748b; font-size: 13px; margin: 4px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>7 Days Left in Your Trial</h1>
          </div>
          <div class="content">
            <p>${greeting},</p>

            <div class="countdown-badge">7 days remaining</div>

            <p>Your Ptah Pro trial ends on <strong style="color: #f4d47c;">${endDate}</strong>.</p>

            <p>Here's the orchestra you've been commanding:</p>

            <div class="feature-list">
              <div class="feature-item">
                <span class="feature-icon">&#10003;</span>
                <span>4 agent runtimes — Gemini CLI, Codex, Copilot, Ptah CLI</span>
              </div>
              <div class="feature-item">
                <span class="feature-icon">&#10003;</span>
                <span>200+ LLM models via unified provider switching</span>
              </div>
              <div class="feature-item">
                <span class="feature-icon">&#10003;</span>
                <span>14 MCP tools for workspace intelligence</span>
              </div>
              <div class="feature-item">
                <span class="feature-icon">&#10003;</span>
                <span>Skill plugins from skills.sh registry</span>
              </div>
            </div>

            <p>Upgrade now to keep the full orchestra after your trial ends.</p>

            <a href="${frontendUrl}/pricing" class="cta-button">Upgrade to Pro</a>

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
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #f1f5f9; margin: 0; padding: 0; background-color: #0f172a; }
          .container { max-width: 600px; margin: 0 auto; }
          .header { background: linear-gradient(135deg, #d4af37 0%, #8a6d10 100%); padding: 28px 24px; text-align: center; }
          .header h1 { color: #0a0a0a; margin: 0; font-size: 24px; font-weight: 700; }
          .content { background-color: #1e293b; padding: 32px 24px; }
          .countdown-badge { display: inline-block; background-color: #b45309; color: #fff; padding: 5px 16px; border-radius: 12px; font-size: 13px; font-weight: 700; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
          .comparison-table { width: 100%; border-collapse: collapse; margin: 24px 0; }
          .comparison-table th { padding: 12px; text-align: left; background-color: #0f172a; color: #f4d47c; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #d4af37; }
          .comparison-table td { padding: 12px; text-align: left; border-bottom: 1px solid #334155; color: #cbd5e1; }
          .check { color: #d4af37; font-weight: 600; }
          .cross { color: #64748b; }
          .cta-button { display: inline-block; background-color: #d4af37; color: #0a0a0a; padding: 14px 36px; border-radius: 6px; text-decoration: none; font-weight: 700; margin: 20px 0; font-size: 15px; }
          .footer { background-color: #0f172a; padding: 24px; text-align: center; border-top: 1px solid #334155; }
          .footer p { color: #64748b; font-size: 13px; margin: 4px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>3 Days Left — Don't Lose the Orchestra</h1>
          </div>
          <div class="content">
            <p>${greeting},</p>

            <div class="countdown-badge">Only 3 days left</div>

            <p>Your Ptah Pro trial ends on <strong style="color: #f4d47c;">${endDate}</strong>. Here's what changes:</p>

            <table class="comparison-table">
              <tr>
                <th>Capability</th>
                <th>Pro</th>
                <th>Community</th>
              </tr>
              <tr>
                <td>Agent orchestration</td>
                <td class="check">4 runtimes (Gemini, Codex, Copilot, Ptah CLI)</td>
                <td class="cross">Single agent</td>
              </tr>
              <tr>
                <td>LLM models</td>
                <td class="check">200+ via unified providers</td>
                <td class="cross">Limited selection</td>
              </tr>
              <tr>
                <td>MCP tools</td>
                <td class="check">14 workspace tools</td>
                <td class="cross">Basic tools only</td>
              </tr>
              <tr>
                <td>Skill plugins</td>
                <td class="check">Full skills.sh access</td>
                <td class="cross">None</td>
              </tr>
            </table>

            <a href="${frontendUrl}/pricing" class="cta-button">Keep Full Access</a>

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
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #f1f5f9; margin: 0; padding: 0; background-color: #0f172a; }
          .container { max-width: 600px; margin: 0 auto; }
          .header { background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); padding: 28px 24px; text-align: center; }
          .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; }
          .content { background-color: #1e293b; padding: 32px 24px; }
          .urgent-badge { display: inline-block; background-color: #dc2626; color: #fff; padding: 5px 16px; border-radius: 12px; font-size: 13px; font-weight: 700; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
          .warning-box { background-color: #0f172a; border-left: 4px solid #dc2626; padding: 16px; margin: 24px 0; border-radius: 4px; }
          .warning-box strong { color: #fca5a5; }
          .cta-button { display: inline-block; background-color: #d4af37; color: #0a0a0a; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: 700; margin: 24px 0; font-size: 16px; }
          .soft-note { color: #64748b; font-size: 14px; margin-top: 20px; }
          .footer { background-color: #0f172a; padding: 24px; text-align: center; border-top: 1px solid #334155; }
          .footer p { color: #64748b; font-size: 13px; margin: 4px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Your Trial Ends Tomorrow</h1>
          </div>
          <div class="content">
            <p style="font-size: 18px; font-weight: 600;">${greeting}</p>

            <div class="urgent-badge">Final day</div>

            <p>Your Ptah Pro trial expires on <strong style="color: #fca5a5;">${endDate}</strong>.</p>

            <div class="warning-box">
              <strong>Tomorrow you lose access to:</strong><br>
              <span style="color: #cbd5e1;">4 agent runtimes, 200+ LLM models, 14 MCP tools, skill plugins, and fire-and-check orchestration. You'll be moved to the Community tier with a single agent and basic tools.</span>
            </div>

            <div style="text-align: center;">
              <a href="${frontendUrl}/pricing" class="cta-button">Keep the Full Orchestra</a>
            </div>

            <p class="soft-note">
              Not ready? No worries — you can continue with the Community tier for free, and upgrade anytime to restore full access.
            </p>

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
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #f1f5f9; margin: 0; padding: 0; background-color: #0f172a; }
          .container { max-width: 600px; margin: 0 auto; }
          .header { background: linear-gradient(135deg, #334155 0%, #1e293b 100%); padding: 28px 24px; text-align: center; }
          .header h1 { color: #f1f5f9; margin: 0; font-size: 24px; font-weight: 700; }
          .header p { color: #94a3b8; margin: 8px 0 0; font-size: 14px; }
          .content { background-color: #1e293b; padding: 32px 24px; }
          .community-info { background-color: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 20px; margin: 24px 0; }
          .community-info strong { color: #94a3b8; }
          .restore-section { margin-top: 28px; }
          .restore-section h3 { color: #f4d47c; font-size: 16px; margin-bottom: 12px; }
          .feature-item { margin-bottom: 8px; color: #cbd5e1; }
          .feature-icon { color: #d4af37; margin-right: 8px; }
          .cta-button { display: inline-block; background-color: #d4af37; color: #0a0a0a; padding: 14px 36px; border-radius: 6px; text-decoration: none; font-weight: 700; margin: 20px 0; font-size: 15px; }
          .footer { background-color: #0f172a; padding: 24px; text-align: center; border-top: 1px solid #334155; }
          .footer p { color: #64748b; font-size: 13px; margin: 4px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Your Pro Trial Has Ended</h1>
            <p>You've been moved to the Community tier</p>
          </div>
          <div class="content">
            <p>${greeting},</p>

            <div class="community-info">
              <strong>What's changed:</strong>
              <p style="color: #cbd5e1;">You're now on the Community tier with single-agent access and basic tools. You can continue using Ptah for free.</p>
            </div>

            <div class="restore-section">
              <h3>Restore the full orchestra anytime:</h3>
              <div class="feature-item">
                <span class="feature-icon">&#10003;</span>
                <span>4 agent runtimes — spawn, delegate, conquer</span>
              </div>
              <div class="feature-item">
                <span class="feature-icon">&#10003;</span>
                <span>200+ LLM models — one harness, every model</span>
              </div>
              <div class="feature-item">
                <span class="feature-icon">&#10003;</span>
                <span>14 MCP tools & skill plugins from skills.sh</span>
              </div>
              <div class="feature-item">
                <span class="feature-icon">&#10003;</span>
                <span>Setup Wizard — instant project awareness from day one</span>
              </div>
            </div>

            <a href="${frontendUrl}/pricing" class="cta-button">View Pro Plans</a>

          </div>
          <div class="footer">
            <p>Thank you for trying Ptah Pro. We'd love your feedback — just reply.</p>
            <p>— The Ptah Team</p>
          </div>
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
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #f1f5f9; margin: 0; padding: 0; background-color: #0f172a; }
          .container { max-width: 600px; margin: 0 auto; }
          .header { background: linear-gradient(135deg, #d4af37 0%, #8a6d10 100%); padding: 28px 24px; text-align: center; }
          .header h1 { color: #0a0a0a; margin: 0; font-size: 24px; font-weight: 700; }
          .header p { color: #0a0a0a; opacity: 0.8; margin: 8px 0 0; font-size: 14px; }
          .content { background-color: #1e293b; padding: 32px 24px; }
          .feature-list { background-color: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 20px; margin: 24px 0; }
          .feature-item { margin-bottom: 10px; color: #cbd5e1; }
          .feature-icon { color: #d4af37; margin-right: 8px; }
          .upgrade-box { background-color: #0f172a; border: 1px solid #d4af37; border-radius: 8px; padding: 20px; margin: 24px 0; }
          .upgrade-box strong { color: #f4d47c; }
          .cta-button { display: inline-block; background-color: #d4af37; color: #0a0a0a; padding: 14px 36px; border-radius: 6px; text-decoration: none; font-weight: 700; margin: 20px 8px 20px 0; font-size: 15px; }
          .cta-secondary { display: inline-block; color: #f4d47c; text-decoration: none; font-weight: 600; font-size: 14px; }
          .footer { background-color: #0f172a; padding: 24px; text-align: center; border-top: 1px solid #334155; }
          .footer p { color: #64748b; font-size: 13px; margin: 4px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to Ptah Community</h1>
            <p>Your account is ready — keep coding for free</p>
          </div>
          <div class="content">
            <p>${greeting},</p>

            <p>Your Pro trial has ended, but the Community tier still gives you solid ground to build on:</p>

            <div class="feature-list">
              <div class="feature-item">
                <span class="feature-icon">&#10003;</span>
                <span>AI-powered code assistance in VS Code</span>
              </div>
              <div class="feature-item">
                <span class="feature-icon">&#10003;</span>
                <span>Single-agent chat with Claude</span>
              </div>
              <div class="feature-item">
                <span class="feature-icon">&#10003;</span>
                <span>Code generation, editing, and explanations</span>
              </div>
              <div class="feature-item">
                <span class="feature-icon">&#10003;</span>
                <span>Session history and management</span>
              </div>
            </div>

            <div class="upgrade-box">
              <strong>Ready for the full orchestra?</strong>
              <p style="color: #cbd5e1; margin: 8px 0 0;">Upgrade to Pro for 4 agent runtimes, 200+ LLM models, 14 MCP tools, skill plugins, and fire-and-check orchestration.</p>
            </div>

            <a href="${frontendUrl}/pricing" class="cta-button">Upgrade to Pro</a>
            <a href="${frontendUrl}/profile" class="cta-secondary">View Your Account &#8594;</a>

          </div>
          <div class="footer">
            <p>Thank you for being part of the Ptah community.</p>
            <p>— The Ptah Team</p>
          </div>
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
