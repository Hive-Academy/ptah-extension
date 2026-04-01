import {
  Inject,
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';

/**
 * AdminApiKeyGuard - Validates X-API-Key header for admin endpoints
 *
 * Security:
 * - Validates X-API-Key header against ADMIN_API_KEY environment variable
 * - Throws 401 Unauthorized if key is missing or invalid
 * - Prevents unauthorized license creation
 * - Uses hash-based constant-time comparison (no length leak)
 *
 * Usage:
 * @Controller('api/v1/admin')
 * @UseGuards(AdminApiKeyGuard)
 * export class AdminController { }
 */
@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  /**
   * Compute SHA-256 hash of a string.
   * Used for constant-time comparison without leaking key length.
   */
  private hashKey(key: string): Buffer {
    return createHash('sha256').update(key).digest();
  }

  /**
   * Validate admin API key from request header
   *
   * TASK_2025_125: Uses hash-based constant-time comparison to prevent timing attacks.
   * By hashing both keys first, we ensure:
   * 1. Buffers are always the same length (32 bytes for SHA-256)
   * 2. No information about key length is leaked
   * 3. Comparison time is constant regardless of where values differ
   *
   * @param context - Execution context containing HTTP request
   * @returns true if API key is valid, throws UnauthorizedException otherwise
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    // Validate API key presence
    if (!apiKey || typeof apiKey !== 'string') {
      throw new UnauthorizedException('Invalid API key');
    }

    // Get valid API key from environment
    const validApiKey = this.config.get<string>('ADMIN_API_KEY');

    if (!validApiKey) {
      throw new UnauthorizedException(
        'Server configuration error: ADMIN_API_KEY not set',
      );
    }

    // TASK_2025_125: Hash-based constant-time comparison
    // Hash both keys to get fixed-length buffers, then compare
    // This prevents timing attacks from leaking key length or content
    const providedHash = this.hashKey(apiKey);
    const expectedHash = this.hashKey(validApiKey);
    const isValid = timingSafeEqual(providedHash, expectedHash);

    if (!isValid) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }
}
