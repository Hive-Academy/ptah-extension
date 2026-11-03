import { Routes } from '@angular/router';
import { LandingPageComponent } from '@ptah-web/landing';

/** Routes for the PtahCode desktop-app marketing site. */
export const routes: Routes = [
  {
    path: '',
    component: LandingPageComponent,
  },
  {
    path: 'docs',
    canActivate: [
      () => {
        if (typeof window !== 'undefined') {
          window.location.replace('https://docs.ptah.live');
        }
        return false;
      },
    ],
    children: [],
  },
  {
    path: 'download',
    loadComponent: () =>
      import('./pages/download/download-page.component').then(
        (m) => m.DownloadPageComponent,
      ),
  },
  {
    path: 'terms-and-conditions',
    loadComponent: () =>
      import('@ptah-web/legal').then((m) => m.TermsPageComponent),
  },
  {
    path: 'privacy',
    loadComponent: () =>
      import('@ptah-web/legal').then((m) => m.PrivacyPageComponent),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
