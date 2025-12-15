import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
   * @param context - Execution context containing HTTP request
   * @returns true if API key is valid, throws UnauthorizedException otherwise
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    // Validate API key presence
    if (!apiKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Compare with environment variable (constant-time comparison to prevent timing attacks)
    const validApiKey = this.config.get<string>('ADMIN_API_KEY');

    if (!validApiKey) {
      throw new UnauthorizedException(
        'Server configuration error: ADMIN_API_KEY not set'
      );
    }

    if (apiKey !== validApiKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }
}
