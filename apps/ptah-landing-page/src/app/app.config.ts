import {
  provideHttpClient,
  withInterceptors,
  withXhr,
} from '@angular/common/http';
import {
  APP_INITIALIZER,
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import {
  provideClientHydration,
  withEventReplay,
  withNoIncrementalHydration,
} from '@angular/platform-browser';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideGsap } from '@hive-academy/angular-gsap';
import { provideI18n } from '@ptah-extension/i18n';
import { provideMarkdownRendering } from '@ptah-extension/markdown';
import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { providePaddleConfig } from '@ptah-web/core';
import { apiInterceptor } from '@ptah-web/core';
import { AuthInitializerService } from '@ptah-web/core';
import { provideApiBaseUrl } from '@ptah-web/core';
import { provideBuildersCheckoutEnabled } from '@ptah-web/core';
import { CORE_I18N_SCOPE } from '@ptah-web/core';
import { UI_I18N_SCOPE } from '@ptah-web/ui';
import { APP_I18N_SCOPE } from './i18n/app.i18n-scope';
import { provideArabicFontLoader } from './i18n/arabic-font.loader';
import { LANDING_LANG_STORAGE_KEY } from './i18n/landing-i18n.constants';

export const appConfig: ApplicationConfig = {
  providers: [
    {
      provide: APP_INITIALIZER,
      useFactory: (authInit: AuthInitializerService) => () =>
        authInit.initialize(),
      deps: [AuthInitializerService],
      multi: true,
    },
    // Resolves the language and loads the global scopes before the first
    // render; the server always renders English. Route resolvers in
    // app.routes.ts load each page's own scope.
    provideI18n({
      storageKey: LANDING_LANG_STORAGE_KEY,
      globalScopes: [APP_I18N_SCOPE, UI_I18N_SCOPE, CORE_I18N_SCOPE],
    }),
    provideArabicFontLoader(),
    provideRouter(
      routes,
      withInMemoryScrolling({
        anchorScrolling: 'enabled',
        scrollPositionRestoration: 'enabled',
      }),
    ),
    provideClientHydration(withEventReplay(), withNoIncrementalHydration()),
    provideHttpClient(withXhr(), withInterceptors([apiInterceptor])),
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideMarkdownRendering({ extensions: 'basic' }),
    provideApiBaseUrl(environment.apiBaseUrl),
    provideBuildersCheckoutEnabled(environment.buildersCheckoutEnabled),
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
