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

// IMPORTANT: Sentry instrumentation MUST be imported before all other modules
// to ensure proper monkey-patching of Node.js internals and framework hooks.
import './instrument';

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app/app.module';
import cookieParser = require('cookie-parser');

async function bootstrap() {
  // Create NestJS application with raw body enabled for webhook signature verification
  // The rawBody option stores the unparsed request body in req.rawBody
  // This is required for Paddle webhook signature verification (HMAC SHA256)
  // Determine log levels based on environment.
  // Production: suppress verbose/debug to reduce noise and log volume.
  // Development: show everything for easier debugging.
  const isProduction = process.env['NODE_ENV'] === 'production';
  const logLevels: ('log' | 'error' | 'warn' | 'debug' | 'verbose')[] =
    isProduction
      ? ['log', 'error', 'warn']
      : ['log', 'error', 'warn', 'debug', 'verbose'];

  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: logLevels,
  });

  // Configure helmet for HTTP security headers (HSTS, X-Frame-Options, etc.)
  // Must be applied before other middleware to ensure headers are set on all responses
  app.use(
    helmet({
      contentSecurityPolicy: false, // Disabled: AdminJS admin panel serves inline scripts/styles
      crossOriginEmbedderPolicy: false, // Allow API consumption from any origin (CORS handles this)
    }),
  );

  // Configure cookie-parser middleware for PKCE state cookie management
  // Used by WorkOS OAuth flow to store state parameter in HTTP-only cookies
  app.use(cookieParser());

  // Configure global ValidationPipe for DTO validation
  // - whitelist: strips properties not in DTO (prevents mass assignment)
  // - forbidNonWhitelisted: throws error for unknown properties
  // - transform: auto-transforms payloads to DTO instances with type coercion
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Get ConfigService for environment variables
  const configService = app.get(ConfigService);

  // Configure CORS for cross-origin requests from frontend
  const frontendUrl =
    configService.get<string>('FRONTEND_URL') || 'https://ptah.live';
  app.enableCors({
    origin: [frontendUrl],
    credentials: true, // Allow cookies to be sent with requests
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-API-Key'],
  });

  // Set global API prefix for all routes
  // Routes will be: /api/auth/*, /api/v1/licenses/*, /api/v1/admin/*
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix, {
    // Exclude webhook routes from the global prefix
    // Paddle webhooks expect: POST /webhooks/paddle (not /api/webhooks/paddle)
    // Note: NestJS 11+ uses path-to-regexp v8 which requires named parameters
    exclude: [
      'webhooks/paddle',
      'webhooks/paddle/{*path}',
      'admin',
      'admin/{*path}',
    ],
  });

  // Flush Sentry events on graceful shutdown (SIGTERM from Docker)
  app.enableShutdownHooks();

  // Start the server
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
