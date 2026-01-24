import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import {
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { provideMarkdown } from 'ngx-markdown';
import { provideGsap, provideLenis } from '@hive-academy/angular-gsap';
import { routes } from './app.routes';
import { apiInterceptor } from './interceptors/api.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    // Router configuration
    provideRouter(routes),
    // HTTP client with API interceptor for credentials and base URL
    provideHttpClient(withInterceptors([apiInterceptor])),
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    // Markdown rendering for chat messages (required by ExecutionNodeComponent from @ptah-extension/chat)
    provideMarkdown(),
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
