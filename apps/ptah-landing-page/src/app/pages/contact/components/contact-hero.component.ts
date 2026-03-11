import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'ptah-contact-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pt-28 pb-12 px-4 sm:px-6 lg:px-16">
      <div class="max-w-3xl mx-auto text-center">
        <h1 class="text-4xl sm:text-5xl font-bold mb-4">
          <span
            class="bg-gradient-to-r from-amber-400 via-amber-300 to-amber-500 bg-clip-text text-transparent"
          >
            Get in Touch
          </span>
        </h1>
        <p class="text-white/60 text-lg max-w-xl mx-auto">
          Have a question, feedback, or need help? We'd love to hear from you.
          Fill out the form below and we'll get back to you as soon as possible.
        </p>
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
export class ContactHeroComponent {}
