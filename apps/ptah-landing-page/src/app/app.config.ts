import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideMarkdown } from 'ngx-markdown';
import { provideGsap, provideLenis } from '@hive-academy/angular-gsap';

export const appConfig: ApplicationConfig = {
  providers: [
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
      lerp: 0.08,
      wheelMultiplier: 0.7,
    }),
  ],
};
