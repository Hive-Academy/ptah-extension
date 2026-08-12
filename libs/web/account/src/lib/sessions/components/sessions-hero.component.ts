import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'ptah-sessions-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pt-28 pb-12 px-4 sm:px-6 lg:px-16">
      <div class="max-w-3xl mx-auto text-center">
        <h1 class="text-4xl sm:text-5xl font-bold mb-4">
          <span
            class="bg-gradient-to-r from-amber-400 via-amber-300 to-amber-500 bg-clip-text text-transparent"
          >
            Ptah Learning Sessions
          </span>
        </h1>
        <p class="text-white/60 text-lg max-w-xl mx-auto mb-4">
          4&#x2013;5 hour live consulting sessions to help you master Ptah and
          supercharge your development workflow.
        </p>
        <div
          class="inline-flex items-center gap-3 bg-slate-900/50 border border-white/10 rounded-full px-5 py-2.5"
        >
          <span class="text-green-400 font-medium text-sm"
            >First session FREE for community members</span
          >
          <span class="text-white/20">|</span>
          <span class="text-white/50 text-sm">$100 per session after</span>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        contain: layout style;
      }
    `,
  ],
})
export class SessionsHeroComponent {}
