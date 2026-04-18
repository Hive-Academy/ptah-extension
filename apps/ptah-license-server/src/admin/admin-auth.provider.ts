import { AuthService } from '../app/auth/services/auth.service';
import { ConfigService } from '@nestjs/config';

/**
 * AdminJS authenticate callback factory
 *
 * Validates email/password credentials against WorkOS via AuthService,
 * then checks if the authenticated email is in the ADMIN_EMAILS allowlist.
 *
 * Flow:
 * 1. User enters email + password on AdminJS login page
 * 2. Authenticate against WorkOS via AuthService.authenticateWithPassword()
 * 3. Check email against ADMIN_EMAILS env var (comma-separated list)
 * 4. Return admin user object if allowed, null if not
 *
 * Security:
 * - Full WorkOS auth validation (not just email check)
 * - Email allowlist prevents non-admin users from accessing panel
 * - AdminJS session cookie is separate from ptah_auth API cookie
 * - All errors return null (never leak authentication details)
 */
export function adminAuthenticate(
  authService: AuthService,
  configService: ConfigService,
) {
  return async (
    email: string,
    password: string,
  ): Promise<{ email: string; id: string; role: string } | null> => {
    try {
      // Step 1: Parse admin email allowlist from environment
      const adminEmails = (configService.get<string>('ADMIN_EMAILS') || '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);

      if (adminEmails.length === 0) {
        // No admin emails configured -- deny all access
        return null;
      }

      // Step 2: Authenticate with WorkOS (validates credentials)
      const { user } = await authService.authenticateWithPassword(
        email,
        password,
      );

      // Step 3: Check email against admin allowlist
      if (!adminEmails.includes(user.email.toLowerCase())) {
        // User authenticated but not an admin
        return null;
      }

      // Step 4: Return admin user (stored in AdminJS session)
      return { email: user.email, id: user.id, role: 'admin' };
    } catch {
      // Authentication failed (wrong password, WorkOS error, etc.)
      return null;
    }
  };
}
