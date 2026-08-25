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
   * Welcome an approved waitlist member into the free founding cohort.
   *
   * Fired once, after the approval transaction commits, by
   * `WaitlistApprovalService`. This is the ONLY outbound message an approval
   * produces (R3.3).
   *
   * ⚠️ THE LICENCE KEY TRAVELS IN THIS MAIL, AND THAT IS DELIBERATE.
   * `sendLicenseKey` is NOT also sent on the approval path. The suppression is
   * structural rather than conditional: `issueComplimentaryLicenseTx` has no
   * mail side effect at all, so every caller owns its own outbound message and
   * this one owns the approval's. Do not add a `sendEmail: false` flag to
   * re-enable the other mail "when needed" — a flag is a second, silently
   * flippable way to send an approved member two contradictory messages, which
   * is the exact failure TASK_2026_201 removes.
   *
   * ⚠️ THE BODY SELLS NOTHING. No amount, no percentage, no checkout link, no
   * refund or renewal terms. That is not a style preference: this mail replaced
   * a paid invite, and `founding-cohort-welcome.spec.ts` fails the build on the
   * rendered HTML if any of it comes back.
   *
   * @param params - Email parameters (email, licenseKey, expiresAt)
   * @throws Error after 3 failed retry attempts
   */
  async sendFoundingCohortWelcome(params: {
    email: string;
    licenseKey: string;
    expiresAt: Date | null;
  }): Promise<void> {
    const { email, licenseKey, expiresAt } = params;

    const fromEmail = this.config.get<string>('FROM_EMAIL') || 'help@ptah.live';
    const fromName = this.config.get<string>('FROM_NAME') || 'Ptah Team';

    const msg = {
      from: `${fromName} <${fromEmail}>`,
      to: [email],
      subject: "You're in — Ptah Builders, free for the founding cohort",
      html: this.getFoundingCohortWelcomeTemplate({ licenseKey, expiresAt }),
    };

    this.logger.log(`Sending founding cohort welcome to ${email}`);
    await this.sendWithRetry(msg, 3);
    this.logger.log(`Founding cohort welcome sent to ${email}`);
  }

  /**
   * Welcome a newly provisioned Builders member to the live sessions, listing
   * the next few and how to join.
   *
   * ⚠️ WHY THIS EXISTS RATHER THAN A GOOGLE CALENDAR INVITATION.
   * The provisioning fan-out adds the member as an attendee on the cohort's
   * recurring event, and the obvious way to notify them would be to let Google
   * do it (`sendUpdates=all` on that patch). Google refuses to be that precise:
   * it treats an attendee addition as an EVENT UPDATE and mails an "Updated
   * Invitation" to EVERY existing guest, with no parameter to narrow it to the
   * person who was added. On a cohort of N members every signup would send N
   * emails, and every existing member would be pinged by every new one.
   *
   * So the calendar write stays silent (`sendUpdates=none`) and the welcome is
   * ours: exactly one message, to exactly the new member, with content we
   * control. The event still lands in their Google Calendar — attendance is
   * real, only the notification is ours.
   *
   * Callers treat delivery as BEST-EFFORT: this runs inside the Paddle webhook
   * fan-out, where a mail failure must never fail provisioning.
   *
   * @param params.sessions - The next few upcoming sessions, already sorted.
   *                          An empty list still sends: membership is active
   *                          and "nothing scheduled yet" is honest.
   */
  async sendBuildersSessionWelcome(params: {
    email: string;
    sessions: Array<{
      title: string;
      startsAt: string;
      meetLink: string | null;
    }>;
  }): Promise<void> {
    const { email, sessions } = params;

    const fromEmail = this.config.get<string>('FROM_EMAIL') || 'help@ptah.live';
    const fromName = this.config.get<string>('FROM_NAME') || 'Ptah Team';

    const msg = {
      from: `${fromName} <${fromEmail}>`,
      to: [email],
      subject: "You're in — Ptah Builders live sessions",
      html: this.getBuildersSessionWelcomeTemplate({ sessions }),
    };

    this.logger.log(
      `Sending Builders session welcome to ${email} (${sessions.length} upcoming)`,
    );
    await this.sendWithRetry(msg, 3);
    this.logger.log(`Builders session welcome sent to ${email}`);
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
  /**
   * Body for {@link sendBuildersSessionWelcome}.
   *
   * Times are rendered in UTC with the offset spelled out, because an email is
   * rendered wherever the reader opens it and there is no browser locale to
   * lean on. The members' area shows the same sessions in their own timezone,
   * which is why the CTA points there.
   */
  private getBuildersSessionWelcomeTemplate(params: {
    sessions: Array<{
      title: string;
      startsAt: string;
      meetLink: string | null;
    }>;
  }): string {
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'https://ptah.live';

    const sessionRows = params.sessions
      .map((session) => {
        const when = formatUtc(session.startsAt);
        const join = session.meetLink
          ? `<a href="${escapeHtml(session.meetLink)}" style="color: #d4af37; text-decoration: none;">Join link</a>`
          : '<span style="color: #64748b;">Join link to follow</span>';
        return `
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #334155;">
              <div style="color: #f1f5f9; font-weight: 600;">${escapeHtml(session.title)}</div>
              <div style="color: #94a3b8; font-size: 13px;">${when} &middot; ${join}</div>
            </td>
          </tr>`;
      })
      .join('');

    const schedule =
      params.sessions.length > 0
        ? `<table style="width: 100%; border-collapse: collapse; margin: 8px 0 20px;">${sessionRows}</table>`
        : `<p style="color: #94a3b8;">Nothing is on the schedule this minute — the next one will appear in the members' area as soon as it is set.</p>`;

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>You're in — Ptah Builders live sessions</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #f1f5f9; margin: 0; padding: 0; background-color: #0f172a; }
          .container { max-width: 600px; margin: 0 auto; }
          .header { background: linear-gradient(135deg, #d4af37 0%, #8a6d10 100%); padding: 32px 24px; text-align: center; }
          .header h1 { color: #0a0a0a; margin: 0; font-size: 26px; font-weight: 700; }
          .header p { color: #0a0a0a; opacity: 0.8; margin: 8px 0 0; font-size: 14px; letter-spacing: 1px; text-transform: uppercase; }
          .content { background-color: #1e293b; padding: 32px 24px; }
          .badge { display: inline-block; background-color: #d4af37; color: #0a0a0a; padding: 4px 16px; border-radius: 12px; font-size: 13px; font-weight: 700; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
          .content p { color: #cbd5e1; }
          .cta { display: inline-block; background-color: #d4af37; color: #0a0a0a; padding: 12px 28px; border-radius: 8px; font-weight: 700; text-decoration: none; margin-top: 8px; }
          .footer { background-color: #0f172a; padding: 24px; text-align: center; border-top: 1px solid #334155; }
          .footer p { color: #64748b; font-size: 13px; margin: 4px 0; }
          .footer a { color: #d4af37; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>You're in</h1>
            <p>Ptah Builders Live Sessions</p>
          </div>
          <div class="content">
            <div class="badge">Builders</div>
            <p>Your membership is active, and you have been added to the Builders live sessions. They will show up in your calendar automatically.</p>
            <p style="color: #f1f5f9; font-weight: 600; margin-bottom: 0;">Coming up</p>
            ${schedule}
            <p>Every session, in your own timezone, lives in the members' area:</p>
            <p><a class="cta" href="${frontendUrl}/members">Open the members' area</a></p>
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
   * Body for {@link sendFoundingCohortWelcome} — the free founding-cohort
   * welcome (dark/gold house style).
   *
   * ⚠️ FRAMING IS A DECISION, NOT A DRAFT (TASK_2026_201 C3).
   * The mail leads with what the member KEEPS — the course, the recordings and
   * the community for a full year — and never with a countdown. A gift framed
   * as an expiring window reads as a trial, and this cohort is not a trial. The
   * literal expiry date is real and is not hidden; it sits in the licence block
   * at the bottom, where somebody checking specifics will look for it. Warm at
   * the top, precise at the bottom.
   *
   * ⚠️ THE GRADIENT HAS NO PERCENTAGE COLOR STOPS, ON PURPOSE.
   * Every sibling writes `linear-gradient(135deg, #d4af37 0%, #8a6d10 100%)`.
   * Here the stops are omitted — the default stop positions are exactly 0 and
   * 100, so the render is identical — because the R3 guard forbids a `%`
   * ANYWHERE in this body. A blanket rule is enforceable by a regex; "a
   * percentage, unless it is a CSS length" is not. Restoring `0%`/`100%` fails
   * `founding-cohort-welcome.spec.ts`. Use unitless stops or none at all.
   *
   * @private
   * @param params - Template parameters (licenseKey, expiresAt)
   * @returns HTML email content
   */
  private getFoundingCohortWelcomeTemplate(params: {
    licenseKey: string;
    expiresAt: Date | null;
  }): string {
    const { licenseKey, expiresAt } = params;
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'https://ptah.live';

    const accessText = expiresAt
      ? `<p class="expiry"><strong>Access runs through:</strong> ${expiresAt.toLocaleDateString(
          'en-US',
          {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          },
        )}</p>`
      : '<p class="expiry"><strong>Access runs through:</strong> No end date</p>';

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>You're in — Ptah Builders, free for the founding cohort</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #f1f5f9; margin: 0; padding: 0; background-color: #0f172a; }
          .container { max-width: 600px; margin: 0 auto; }
          .header { background: linear-gradient(135deg, #d4af37, #8a6d10); padding: 32px 24px; text-align: center; }
          .header h1 { color: #0a0a0a; margin: 0; font-size: 26px; font-weight: 700; }
          .header p { color: #0a0a0a; opacity: 0.8; margin: 8px 0 0; font-size: 14px; letter-spacing: 1px; text-transform: uppercase; }
          .content { background-color: #1e293b; padding: 32px 24px; }
          .badge { display: inline-block; background-color: #d4af37; color: #0a0a0a; padding: 4px 16px; border-radius: 12px; font-size: 13px; font-weight: 700; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
          .content p { color: #cbd5e1; }
          .content ul { color: #cbd5e1; padding-left: 20px; margin: 8px 0 20px; }
          .content li { margin-bottom: 8px; }
          .content li strong { color: #f1f5f9; }
          .keeps { background-color: #0f172a; border-left: 4px solid #d4af37; padding: 12px 16px; margin: 20px 0; border-radius: 4px; }
          .keeps p { color: #f4d47c; margin: 0; }
          .cta { display: inline-block; background-color: #d4af37; color: #0a0a0a; padding: 12px 28px; border-radius: 8px; font-weight: 700; text-decoration: none; margin-top: 8px; }
          .details { border-top: 1px solid #334155; margin-top: 32px; padding-top: 20px; }
          .details h2 { color: #f4d47c; font-size: 16px; margin: 0 0 8px; }
          .license-key { background-color: #0f172a; border: 2px solid #d4af37; border-radius: 8px; padding: 16px; font-family: 'Courier New', monospace; font-size: 14px; word-break: break-all; margin: 12px 0; color: #f4d47c; }
          .expiry { color: #94a3b8; font-size: 14px; margin: 0; }
          .expiry strong { color: #cbd5e1; }
          .footer { background-color: #0f172a; padding: 24px; text-align: center; border-top: 1px solid #334155; }
          .footer p { color: #64748b; font-size: 13px; margin: 4px 0; }
          .footer a { color: #d4af37; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>You're in</h1>
            <p>Ptah Builders — Founding Cohort</p>
          </div>
          <div class="content">
            <div class="badge">Founding Member</div>
            <p>Your place in the founding cohort of <strong style="color: #f4d47c;">Ptah Builders</strong> is confirmed, and it is <strong style="color: #f4d47c;">free</strong>. We have not asked you for a card, and we will not ask you for one when the cohort finishes.</p>

            <div class="keeps">
              <p>Founding members keep the course, the recordings and the community for a full year — the two-week cohort is the live part, not the whole of it.</p>
            </div>

            <p style="color: #f1f5f9; font-weight: 600; margin-bottom: 0;">What is waiting for you</p>
            <ul>
              <li><strong>The SaaS-building course</strong> — the full curriculum, yours to work through at your own pace.</li>
              <li><strong>The live sessions</strong> — builds, walkthroughs and open questions, recorded so a missed hour is never a missed session.</li>
              <li><strong>The members' community</strong> — the forum where the cohort thinks out loud, and its whole archive.</li>
              <li><strong>The packs</strong> — the agent packs and templates the course builds on.</li>
            </ul>

            <p>Everything lives behind one door:</p>
            <p><a class="cta" href="${frontendUrl}/members">Open the members' area</a></p>

            <p style="color: #94a3b8; font-size: 14px;">Sign in with <strong style="color: #cbd5e1;">this email address</strong> — the one this message arrived at. Your membership is already attached to it, so there is nothing to set up first.</p>

            <div class="details">
              <h2>Your licence</h2>
              <p style="color: #94a3b8; font-size: 14px; margin: 0;">Paste this key into Ptah in VS Code or the desktop app to unlock the Builders features there.</p>
              <div class="license-key">${licenseKey}</div>
              ${accessText}
            </div>
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

/**
 * ISO 8601 → a fixed, unambiguous UTC rendering, e.g. "Wed 5 Aug 2026, 17:00 UTC".
 *
 * Email is rendered wherever the reader opens it, with no browser locale and no
 * script, so a "local time" is not something this can honestly produce. Naming
 * the zone explicitly beats printing a bare time that silently means a
 * different hour for every reader. The members' area does the timezone-aware
 * rendering, which is why the mail links there.
 */
function formatUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'Time to be confirmed';
  }
  return `${date.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    hour12: false,
  })} UTC`;
}

/**
 * Escape a value for interpolation into the HTML body.
 *
 * Session titles come from the Google Calendar event, which an admin types.
 * That is not attacker-controlled in any realistic sense, but it is
 * human-controlled text reaching a markup template, and an unescaped `&` in
 * "Q&A session" is enough to corrupt the mail on its own.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
