import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sgMail from '@sendgrid/mail';

/**
 * EmailService - SendGrid email delivery with retry logic
 *
 * Features:
 * - License key email delivery with setup instructions
 * - Magic link email delivery for portal login
 * - 3-attempt retry with exponential backoff (1s, 2s, 4s)
 * - Graceful error handling (throws after 3 failures)
 *
 * Configuration (environment variables):
 * - SENDGRID_API_KEY: SendGrid API key
 * - SENDGRID_FROM_EMAIL: Sender email address
 * - SENDGRID_FROM_NAME: Sender display name
 * - FRONTEND_URL: Customer portal URL for links
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('SENDGRID_API_KEY');

    if (!apiKey) {
      this.logger.warn(
        'SENDGRID_API_KEY not configured - email sending will fail'
      );
    } else {
      sgMail.setApiKey(apiKey);
      this.logger.log('SendGrid initialized successfully');
    }
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

    const msg = {
      to: email,
      from: {
        email:
          this.config.get<string>('SENDGRID_FROM_EMAIL') || 'ptah@nghive.tech',
        name: this.config.get<string>('SENDGRID_FROM_NAME') || 'Ptah Team',
      },
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

    const msg = {
      to: email,
      from: {
        email:
          this.config.get<string>('SENDGRID_FROM_EMAIL') || 'ptah@nghive.tech',
        name: this.config.get<string>('SENDGRID_FROM_NAME') || 'Ptah Team',
      },
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
   * @param msg - SendGrid message object
   * @param attempts - Number of retry attempts
   * @throws Error if all attempts fail
   */
  private async sendWithRetry(
    msg: sgMail.MailDataRequired,
    attempts: number
  ): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      try {
        await sgMail.send(msg);
        return; // Success - exit retry loop
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';

        if (i === attempts - 1) {
          // Last attempt failed - throw error
          this.logger.error(
            `Email send failed after ${attempts} attempts: ${errorMessage}`
          );
          throw error;
        }

        // Retry with exponential backoff: 2^i * 1000ms (1s, 2s, 4s)
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
      this.config.get<string>('FRONTEND_URL') || 'https://ptah.dev';

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
          <strong>⏱️ This link expires in 30 seconds</strong><br>
          Please click the link immediately to avoid expiration.
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
}
