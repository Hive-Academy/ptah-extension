import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class ResendWebhookGuard implements CanActivate {
  private readonly logger = new Logger(ResendWebhookGuard.name);
  private readonly secret: string;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {
    let secret = this.config.get<string>('RESEND_WEBHOOK_SECRET') || '';
    if (secret.startsWith('whsec_')) {
      secret = secret.substring(6);
    }
    this.secret = secret;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (!this.secret) {
      this.logger.error(
        'RESEND_WEBHOOK_SECRET is not configured. Webhook rejected.',
      );
      throw new UnauthorizedException('Webhook secret not configured');
    }
    const svixId = request.headers['svix-id'] as string;
    const svixTimestamp = request.headers['svix-timestamp'] as string;
    const svixSignature = request.headers['svix-signature'] as string;

    if (!svixId || !svixTimestamp || !svixSignature) {
      this.logger.warn('Missing Svix headers in Resend webhook');
      throw new UnauthorizedException('Missing Svix headers');
    }
    const now = Math.floor(Date.now() / 1000);
    const timestamp = parseInt(svixTimestamp, 10);
    if (isNaN(timestamp) || Math.abs(now - timestamp) > 300) {
      this.logger.warn(
        `Resend webhook timestamp drift too large: ${svixTimestamp}`,
      );
      throw new UnauthorizedException('Timestamp drift too large');
    }
    const rawBody = request.rawBody;
    if (!rawBody) {
      this.logger.error(
        'Raw body not found on request. Ensure raw-body middleware is registered for this route.',
      );
      throw new UnauthorizedException('Internal error: raw body missing');
    }
    const toSign = `${svixId}.${svixTimestamp}.${rawBody.toString('utf8')}`;
    const hmac = crypto.createHmac(
      'sha256',
      Buffer.from(this.secret, 'base64'),
    );
    const computedSignature = hmac.update(toSign).digest('base64');
    const signatures = svixSignature.split(' ');
    let verified = false;

    for (const sigPair of signatures) {
      const [version, signature] = sigPair.split(',');
      if (version !== 'v1' || !signature) continue;

      try {
        const computedBuffer = Buffer.from(computedSignature, 'base64');
        const providedBuffer = Buffer.from(signature, 'base64');

        if (
          computedBuffer.length === providedBuffer.length &&
          crypto.timingSafeEqual(computedBuffer, providedBuffer)
        ) {
          verified = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!verified) {
      this.logger.warn('Resend webhook signature verification failed');
      throw new UnauthorizedException('Invalid signature');
    }
    try {
      request.body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      this.logger.warn('Failed to parse Resend webhook body as JSON');
      throw new UnauthorizedException('Invalid JSON payload');
    }

    return true;
  }
}
