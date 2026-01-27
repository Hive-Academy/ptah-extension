import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

/**
 * AdminApiKeyGuard - Validates X-API-Key header for admin endpoints
 *
 * Security:
 * - Validates X-API-Key header against ADMIN_API_KEY environment variable
 * - Throws 401 Unauthorized if key is missing or invalid
 * - Prevents unauthorized license creation
 *
 * Usage:
 * @Controller('api/v1/admin')
 * @UseGuards(AdminApiKeyGuard)
 * export class AdminController { }
 */
@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  /**
   * Validate admin API key from request header
   *
   * TASK_2025_125: Uses constant-time comparison to prevent timing attacks.
   * The timingSafeEqual function ensures comparison takes the same time
   * regardless of where strings differ, preventing information leakage.
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
        'Server configuration error: ADMIN_API_KEY not set'
      );
    }

    // TASK_2025_125: Constant-time comparison to prevent timing attacks
    // 1. Check length first (prevents buffer allocation timing leak)
    // 2. Use timingSafeEqual for content comparison
    const isValid =
      apiKey.length === validApiKey.length &&
      timingSafeEqual(Buffer.from(apiKey), Buffer.from(validApiKey));

    if (!isValid) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }
}
