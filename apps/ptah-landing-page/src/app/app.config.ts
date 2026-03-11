import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  APP_INITIALIZER,
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideGsap } from '@hive-academy/angular-gsap';
import { provideMarkdown } from 'ngx-markdown';
import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { providePaddleConfig } from './config/paddle.config';
import { apiInterceptor } from './interceptors/api.interceptor';
import { AuthInitializerService } from './services/auth-initializer.service';

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
    // Paddle checkout configuration with DI token (Pro plan only - Community is free)
    providePaddleConfig({
      environment: environment.paddle.environment,
      token: environment.paddle.token,
      proPriceIdMonthly: environment.paddle.proPriceIdMonthly,
      proPriceIdYearly: environment.paddle.proPriceIdYearly,
      sessionPriceId: environment.paddle.sessionPriceId,
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
    // provideLenis({
    //   lerp: 0.05, // 5% interpolation - smoother but responsive to fast scrolling
    //   duration: 1.2, // Fallback duration for consistent timing (lerp takes priority)
    //   wheelMultiplier: 1.4, // Slightly reduced wheel sensitivity to prevent jumping
    //   touchMultiplier: 1.2, // Balanced touch responsiveness
    //   smoothWheel: true, // Smooth wheel scrolling
    //   useGsapTicker: true, // Sync with GSAP for animations
    // }),
  ],
};
