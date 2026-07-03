import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Server route configuration for build-time prerendering (SSG).
 *
 * The six marketing routes are prerendered to static HTML at build time so
 * their full copy ships in the initial document (GEO/SEO backbone). Everything
 * else (login, signup, profile, trial-ended, contact, sessions, docs redirect,
 * admin/**) stays client-rendered and boots via the static-host catchall.
 */
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'download', renderMode: RenderMode.Prerender },
  { path: 'pricing', renderMode: RenderMode.Prerender },
  { path: 'terms-and-conditions', renderMode: RenderMode.Prerender },
  { path: 'privacy', renderMode: RenderMode.Prerender },
  { path: 'refund', renderMode: RenderMode.Prerender },
  { path: '**', renderMode: RenderMode.Client },
];
