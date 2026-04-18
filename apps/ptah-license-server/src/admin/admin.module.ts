import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import AdminJS from 'adminjs';
import { AdminModule as AdminJSModule } from '@adminjs/nestjs';
import { Database, Resource } from '@adminjs/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { EmailModule } from '../email/email.module';
import { EmailService } from '../email/services/email.service';
import { AuthModule } from '../app/auth/auth.module';
import { AuthService } from '../app/auth/services/auth.service';
import { getResources } from './resources';
import { adminAuthenticate } from './admin-auth.provider';
import { ensurePrismaDmmfCompat } from './prisma-dmmf-compat';

// Register Prisma adapter with AdminJS
AdminJS.registerAdapter({ Database, Resource });

/**
 * AdminModule - AdminJS admin panel for the Ptah License Server
 *
 * TASK_2025_286: Provides a web-based admin interface at /admin for managing
 * users, licenses, subscriptions, webhooks, and training sessions.
 *
 * Architecture:
 * - Uses AdminJS v6 (CJS-compatible) with @adminjs/prisma adapter
 * - Prisma 7 DMMF compatibility layer bridges the adapter gap
 * - Authentication via WorkOS (email/password) with ADMIN_EMAILS allowlist
 * - Separate session cookie (adminjs_session) from API auth (ptah_auth)
 *
 * Security:
 * - Only emails listed in ADMIN_EMAILS env var can access the panel
 * - Session secret from SESSION_SECRET (falls back to JWT_SECRET)
 * - 24-hour session TTL with httpOnly cookies
 * - Secure cookies in production
 */
@Module({
  imports: [
    AdminJSModule.createAdminAsync({
      imports: [EmailModule, AuthModule],
      inject: [PrismaService, EmailService, AuthService, ConfigService],
      useFactory: (
        prisma: PrismaService,
        emailService: EmailService,
        authService: AuthService,
        configService: ConfigService,
      ) => {
        // Apply Prisma 7 DMMF compatibility shim before resource registration
        ensurePrismaDmmfCompat(prisma);

        const sessionSecret =
          configService.get<string>('SESSION_SECRET') ||
          configService.get<string>('JWT_SECRET') ||
          'change-me-in-production';

        return {
          adminJsOptions: {
            rootPath: '/admin',
            loginPath: '/admin/login',
            logoutPath: '/admin/logout',
            resources: getResources(prisma, emailService),
            branding: {
              companyName: 'Ptah License Server',
              logo: false,
            },
          },
          auth: {
            authenticate: adminAuthenticate(authService, configService),
            cookieName: 'adminjs_session',
            cookiePassword: sessionSecret,
          },
          sessionOptions: {
            resave: false,
            saveUninitialized: false,
            secret: sessionSecret,
            cookie: {
              httpOnly: true,
              secure: configService.get<string>('NODE_ENV') === 'production',
              maxAge: 24 * 60 * 60 * 1000, // 24 hours
            },
          },
        };
      },
    }),
  ],
})
export class AdminModule {}
