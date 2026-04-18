import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailModule } from '../email/email.module';
import { EmailService } from '../email/services/email.service';
import { AuthModule } from '../app/auth/auth.module';
import { AuthService } from '../app/auth/services/auth.service';
import { adminAuthenticate } from './admin-auth.provider';

@Module({
  imports: [
    // Dynamic import required: AdminJS v7 is ESM-only, NestJS is CJS.
    // This is the official workaround from https://docs.adminjs.co/installation/plugins/nest
    import('adminjs').then(async ({ default: AdminJS }) => {
      const { Database, Resource, getModelByName } =
        await import('@adminjs/prisma');
      const { AdminModule: AdminJSModule } = await import('@adminjs/nestjs');

      AdminJS.registerAdapter({ Database, Resource });

      return AdminJSModule.createAdminAsync({
        imports: [EmailModule, AuthModule],
        inject: [PrismaService, EmailService, AuthService, ConfigService],
        useFactory: (
          prisma: PrismaService,
          emailService: EmailService,
          authService: AuthService,
          configService: ConfigService,
        ) => {
          const { getResources } = require('./resources');
          const sessionSecret =
            configService.get<string>('SESSION_SECRET') ||
            configService.get<string>('JWT_SECRET') ||
            'change-me-in-production';

          return {
            adminJsOptions: {
              rootPath: '/admin',
              loginPath: '/admin/login',
              logoutPath: '/admin/logout',
              resources: getResources(prisma, emailService, getModelByName),
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
                maxAge: 24 * 60 * 60 * 1000,
              },
            },
          };
        },
      });
    }),
  ],
})
export class AdminModule {}
