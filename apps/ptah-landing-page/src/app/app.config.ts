import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  APP_INITIALIZER,
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import {
  provideClientHydration,
  withEventReplay,
} from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideGsap } from '@hive-academy/angular-gsap';
import { provideMarkdownRendering } from '@ptah-extension/markdown';
import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { providePaddleConfig } from './config/paddle.config';
import { apiInterceptor } from './interceptors/api.interceptor';
import { AuthInitializerService } from './services/auth-initializer.service';

export const appConfig: ApplicationConfig = {
  providers: [
    {
      provide: APP_INITIALIZER,
      useFactory: (authInit: AuthInitializerService) => () =>
        authInit.initialize(),
      deps: [AuthInitializerService],
      multi: true,
    },
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    provideHttpClient(withInterceptors([apiInterceptor])),
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideMarkdownRendering({ extensions: 'basic' }),
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
    provideGsap({
      defaults: {
        ease: 'power2.out',
        duration: 0.8,
      },
    }),
  ],
};
