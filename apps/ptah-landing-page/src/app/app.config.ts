import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
  APP_INITIALIZER,
} from '@angular/core';
import { AuthInitializerService } from './services/auth-initializer.service';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideMarkdown } from 'ngx-markdown';
import { provideGsap, provideLenis } from '@hive-academy/angular-gsap';
import { routes } from './app.routes';
import { apiInterceptor } from './interceptors/api.interceptor';
import { providePaddleConfig } from './config/paddle.config';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    // Auth state synchronization from backend redirects (OAuth, magic link)
    // Must run BEFORE routing to set localStorage hint from ?auth_hint=1 param
    {
      provide: APP_INITIALIZER,
      useFactory: (authInit: AuthInitializerService) => () =>
        authInit.initialize(),
      deps: [AuthInitializerService],
      multi: true,
    },
    // Router configuration
    provideRouter(routes),
    // HTTP client with API interceptor for credentials and base URL
    provideHttpClient(withInterceptors([apiInterceptor])),
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    // Markdown rendering for chat messages (required by ExecutionNodeComponent from @ptah-extension/chat)
    provideMarkdown(),
    // Paddle checkout configuration with DI token (Basic + Pro plans)
    providePaddleConfig({
      environment: environment.paddle.environment,
      token: environment.paddle.token,
      basicPriceIdMonthly: environment.paddle.basicPriceIdMonthly,
      basicPriceIdYearly: environment.paddle.basicPriceIdYearly,
      proPriceIdMonthly: environment.paddle.proPriceIdMonthly,
      proPriceIdYearly: environment.paddle.proPriceIdYearly,
      maxRetries: 3,
      baseRetryDelay: 1000,
      licenseVerifyRetries: 3,
      licenseVerifyDelay: 2000,
    }),
    // GSAP animation defaults for landing page
    provideGsap({
      defaults: {
        ease: 'power2.out',
        duration: 0.8,
      },
    }),
    // Lenis smooth scroll for premium scroll experience
    provideLenis({
      lerp: 0.1, // 10% interpolation per frame - smoother response
      wheelMultiplier: 1, // Standard wheel sensitivity
      touchMultiplier: 2, // Better touch responsiveness
      smoothWheel: true, // Smooth wheel scrolling
      useGsapTicker: true, // Sync with GSAP for animations
    }),
  ],
};
