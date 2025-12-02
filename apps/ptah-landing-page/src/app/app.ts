import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-screen bg-base-100 text-base-content">
      <div class="container mx-auto px-6 py-16">
        <h1 class="text-6xl font-display font-bold text-accent mb-4">
          Ptah Extension
        </h1>
        <p class="text-xl text-base-content/80">Ancient Wisdom for Modern AI</p>
        <div class="mt-8 p-6 bg-base-200 rounded-lg border border-accent/20">
          <p class="text-sm">
            Application scaffold complete. Anubis theme loaded successfully.
          </p>
        </div>
      </div>
    </div>
  `,
})
export class App {}
