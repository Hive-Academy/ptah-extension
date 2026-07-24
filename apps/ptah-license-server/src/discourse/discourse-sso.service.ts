import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type {
  DiscourseSsoPayload,
  DiscourseSsoRequest,
  DiscourseSsoResponse,
} from './discourse.types';

/**
 * DiscourseSsoService — pure DiscourseConnect (SSO provider) crypto + payload
 * codec. No HTTP, no DB — trivially unit-testable and side-effect free.
 *
 * DiscourseConnect wire format:
 * - `sso` is a base64 of a URL-encoded querystring (`nonce=..&return_sso_url=..`).
 * - `sig` is the lowercase hex HMAC-SHA256 of the raw base64 `sso` string,
 *   keyed by the shared `DISCOURSE_SSO_SECRET`.
 *
 * Signature validation is constant-time (`timingSafeEqual`) and length-guarded.
 */
@Injectable()
export class DiscourseSsoService {
  private readonly logger = new Logger(DiscourseSsoService.name);
  private readonly secret: string | undefined;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    this.secret =
      this.configService.get<string>('DISCOURSE_SSO_SECRET')?.trim() ||
      undefined;
  }

  /** True when the shared SSO secret is configured. */
  isEnabled(): boolean {
    return Boolean(this.secret);
  }

  /**
   * Validate an inbound `sso`/`sig` pair and extract the DiscourseConnect
   * request fields. Returns `null` when the signature is missing/invalid or the
   * payload is malformed — callers respond with a generic 403 (no detail).
   */
  parseAndValidate(
    sso: string | undefined,
    sig: string | undefined,
  ): DiscourseSsoRequest | null {
    if (!this.secret || !sso || !sig) {
      return null;
    }
    if (!this.verifySignature(sso, sig)) {
      this.logger.warn('Rejected DiscourseConnect request: signature mismatch');
      return null;
    }

    try {
      const decoded = Buffer.from(sso, 'base64').toString('utf8');
      const params = new URLSearchParams(decoded);
      const nonce = params.get('nonce');
      if (!nonce) {
        this.logger.warn('Rejected DiscourseConnect request: missing nonce');
        return null;
      }
      return {
        nonce,
        returnSsoUrl: params.get('return_sso_url') ?? undefined,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Rejected DiscourseConnect request: ${message}`);
      return null;
    }
  }

  /**
   * Build a signed DiscourseConnect response asserting identity + the
   * `builders` group entitlement.
   *
   * `add_groups: 'builders'` for members, `remove_groups: 'builders'` otherwise
   * — so a lapsed member is actively pulled out of the group on next login.
   */
  buildResponse(payload: DiscourseSsoPayload): DiscourseSsoResponse {
    const params = new URLSearchParams();
    params.set('nonce', payload.nonce);
    params.set('external_id', payload.externalId);
    params.set('email', payload.email);
    params.set('name', payload.name);
    if (payload.isBuilders) {
      params.set('add_groups', 'builders');
    } else {
      params.set('remove_groups', 'builders');
    }

    const encoded = Buffer.from(params.toString(), 'utf8').toString('base64');
    const sig = this.hmacHex(encoded);
    return { sso: encoded, sig };
  }

  /**
   * Constant-time verification of `sig` against HMAC(`sso`). Length-guarded so
   * `timingSafeEqual` never throws on unequal-length buffers.
   */
  private verifySignature(sso: string, sig: string): boolean {
    const expected = this.hmacHex(sso);
    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(sig, 'utf8');
    if (expectedBuf.length !== providedBuf.length) {
      return false;
    }
    return timingSafeEqual(expectedBuf, providedBuf);
  }

  private hmacHex(payload: string): string {
    return createHmac('sha256', this.secret as string)
      .update(payload)
      .digest('hex');
  }
}
