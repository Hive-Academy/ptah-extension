/**
 * Ptah License Server - NestJS Entry Point
 *
 * This is the main bootstrap file for the license server API.
 * Configures:
 * - Sentry error tracking and performance monitoring (must be first import)
 * - Raw body parsing for webhook signature verification (Paddle)
 * - Cookie parsing for PKCE state management (WorkOS OAuth)
 * - CORS for cross-origin requests
 * - Global API prefix
 */
import './instrument';

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import * as bodyParser from 'body-parser';
import { AppModule } from './app/app.module';
import cookieParser = require('cookie-parser');

async function bootstrap() {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const logLevels: ('log' | 'error' | 'warn' | 'debug' | 'verbose')[] =
    isProduction
      ? ['log', 'error', 'warn']
      : ['log', 'error', 'warn', 'debug', 'verbose'];

  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: logLevels,
  });
  app.use(
    helmet({
      contentSecurityPolicy: false, // API server, not serving HTML
      crossOriginEmbedderPolicy: false, // Allow API consumption from any origin (CORS handles this)
    }),
  );
  app.use(cookieParser());
  app.use('/webhooks/resend', bodyParser.raw({ type: '*/*' }));
  // ⚠️ THIS GLOBAL PIPE IS CURRENTLY INERT. Do not read it as "input is
  // validated" — it validates nothing, and has never validated anything.
  //
  // Nest resolves a handler parameter's DTO class from the `design:paramtypes`
  // metadata emitted by TypeScript's `emitDecoratorMetadata`. This app is
  // bundled by `@nx/esbuild`, and esbuild does NOT implement
  // `emitDecoratorMetadata` (the flag in `tsconfig.app.json` has no effect on
  // the bundle). Without that metadata `metadata.metatype` is `undefined` and
  // `ValidationPipe.transform()` short-circuits on
  // `if (!metatype || !this.toValidate(metadata)) return value;`.
  //
  // THE LIVE MECHANISM is `dtoPipe()` / `passthroughDtoPipe()` in
  // `src/common/dto-validation.pipe.ts`, bound per-parameter
  // (`@Body(dtoPipe(TheDto))`). `ValidationPipe`'s `expectedType` option is
  // applied BEFORE the short-circuit, which is why the per-param form works
  // where this one does not. `src/common/controller-validation.spec.ts`
  // enforces that every payload param in the server is bound that way.
  //
  // RETAINED DELIBERATELY. It is the safety net for the day the deferred
  // "Option B" lands (an esbuild plugin that emits `design:paramtypes` — see
  // `.ptah/specs/TASK_2026_170/future-enhancements.md`), at which point this
  // becomes the server-wide default and the per-param binding becomes
  // redundant belt-and-braces. Deleting it now would look like dead-code
  // cleanup but would actually remove that safety net.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const configService = app.get(ConfigService);
  const frontendUrl =
    configService.get<string>('FRONTEND_URL') || 'https://ptah.live';
  app.enableCors({
    origin: [frontendUrl],
    credentials: true, // Allow cookies to be sent with requests
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-API-Key'],
  });
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix, {
    exclude: [
      'webhooks/paddle',
      'webhooks/paddle/{*path}',
      'webhooks/resend',
      'webhooks/resend/{*path}',
    ],
  });
  app.enableShutdownHooks();
  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port);

  const nodeEnv = configService.get<string>('NODE_ENV') || 'development';
  Logger.log(
    `Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
  Logger.log(
    `Webhook endpoint available at: http://localhost:${port}/webhooks/paddle`,
  );
  Logger.log(`Environment: ${nodeEnv}`);
}

bootstrap();
