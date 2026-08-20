import { Component, ChangeDetectionStrategy } from '@angular/core';
import { NavigationComponent } from '@ptah-web/ui';
import { FooterComponent } from '@ptah-web/ui';
import { ContactHeroComponent } from './components/contact-hero.component';
import { ContactFormComponent } from './components/contact-form.component';

@Component({
  selector: 'ptah-contact-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NavigationComponent,
    FooterComponent,
    ContactHeroComponent,
    ContactFormComponent,
  ],
  template: `
    <div class="min-h-screen bg-base-100 text-base-content">
      <ptah-navigation />
      <ptah-contact-hero />
      <ptah-contact-form />
      <ptah-footer />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        contain: layout style;
      }

      ptah-contact-hero,
      ptah-contact-form {
        display: block;
        contain: layout style;
        backface-visibility: hidden;
      }
    `,
  ],
})
export class ContactPageComponent {}
