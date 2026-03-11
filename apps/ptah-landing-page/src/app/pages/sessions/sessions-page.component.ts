import { Component, ChangeDetectionStrategy } from '@angular/core';
import { NavigationComponent } from '../../components/navigation.component';
import { FooterComponent } from '../../components/footer.component';
import { SessionsGridComponent } from './components/sessions-grid.component';

@Component({
  selector: 'ptah-sessions-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NavigationComponent, FooterComponent, SessionsGridComponent],
  template: `
    <div class="min-h-screen bg-base-100 text-base-content">
      <ptah-navigation />
      <ptah-sessions-grid />
      <ptah-footer />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        contain: layout style;
      }

      ptah-sessions-grid {
        display: block;
        contain: layout style;
        backface-visibility: hidden;
      }
    `,
  ],
})
export class SessionsPageComponent {}
