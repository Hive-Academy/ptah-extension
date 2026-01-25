/**
 * Ptah License Server - NestJS Entry Point
 *
 * This is the main bootstrap file for the license server API.
 * Configures:
 * - Raw body parsing for webhook signature verification (Paddle)
 * - Cookie parsing for PKCE state management (WorkOS OAuth)
 * - CORS for cross-origin requests
 * - Global API prefix
 */

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import cookieParser = require('cookie-parser');

async function bootstrap() {
  // Create NestJS application with raw body enabled for webhook signature verification
  // The rawBody option stores the unparsed request body in req.rawBody
  // This is required for Paddle webhook signature verification (HMAC SHA256)
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });

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
    })
  );

  // Get ConfigService for environment variables
  const configService = app.get(ConfigService);

  // Configure CORS for cross-origin requests from frontend
  const frontendUrl =
    configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';
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
    exclude: ['webhooks/paddle', 'webhooks/paddle/{*path}'],
  });

  // Start the server
  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port);

  const nodeEnv = configService.get<string>('NODE_ENV') || 'development';
  Logger.log(
    `Application is running on: http://localhost:${port}/${globalPrefix}`
  );
  Logger.log(
    `Webhook endpoint available at: http://localhost:${port}/webhooks/paddle`
  );
  Logger.log(`Environment: ${nodeEnv}`);
}

bootstrap();
