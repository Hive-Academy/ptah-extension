import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

export interface UnsubscribePayload {
  sub: string;
  purpose: 'unsubscribe';
  iat?: number;
  v: number;
}

/**
 * UnsubscribeTokenService
 *
 * Manages HS256 JWT tokens for email unsubscription.
 * Tokens are immortal (no expiry) to maximize recipient trust (CAN-SPAM compliance).
 */
@Injectable()
export class UnsubscribeTokenService implements OnModuleInit {
  private readonly logger = new Logger(UnsubscribeTokenService.name);
  private readonly secret: string;
  private readonly VERSION = 1;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {
    this.secret =
      this.configService.get<string>('UNSUBSCRIBE_TOKEN_SECRET') || '';
  }

  onModuleInit() {
    // Fail-closed at module init: throw if UNSUBSCRIBE_TOKEN_SECRET missing or <32 bytes.
    if (!this.secret || this.secret.length < 32) {
      const error =
        'UNSUBSCRIBE_TOKEN_SECRET is missing or too short (must be at least 32 bytes).';
      this.logger.error(error);
      throw new Error(error);
    }
    this.logger.log('UnsubscribeTokenService initialized');
  }

  /**
   * Sign a new unsubscribe token for a user
   */
  async sign(userId: string): Promise<string> {
    const payload: UnsubscribePayload = {
      sub: userId,
      purpose: 'unsubscribe',
      v: this.VERSION,
    };

    return this.jwtService.signAsync(payload, {
      secret: this.secret,
    });
  }

  /**
   * Verify an unsubscribe token and return the userId
   */
  async verify(token: string): Promise<string | null> {
    try {
      const payload = await this.jwtService.verifyAsync<UnsubscribePayload>(
        token,
        {
          secret: this.secret,
        },
      );

      // Rejects mismatched purpose or version
      if (payload.purpose !== 'unsubscribe' || payload.v !== this.VERSION) {
        this.logger.warn(
          `Invalid unsubscribe token payload: purpose=${payload.purpose}, v=${payload.v}`,
        );
        return null;
      }

      return payload.sub;
    } catch (error) {
      this.logger.debug(
        `Token verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return null;
    }
  }
}
