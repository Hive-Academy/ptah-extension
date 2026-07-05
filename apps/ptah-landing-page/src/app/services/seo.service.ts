import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

export interface SeoConfig {
  /** Full <title> text. */
  readonly title: string;
  /** Meta description. */
  readonly description: string;
  /** Absolute canonical URL for the route. */
  readonly url: string;
  /** og:title / twitter:title — falls back to {@link title}. */
  readonly ogTitle?: string;
  /** og:description / twitter:description — falls back to {@link description}. */
  readonly ogDescription?: string;
  /** Absolute og:image URL — falls back to the site default in index.html. */
  readonly ogImage?: string;
}

/**
 * SeoService — per-route title, meta, canonical, and JSON-LD wiring.
 *
 * Call `setPage()` synchronously from a page component's constructor so the
 * head is updated during prerender (SSG), landing the correct tags in the
 * static HTML for crawlers and generative engines. Uses Angular's `Title` /
 * `Meta` (which update the tags seeded in index.html in place) plus `DOCUMENT`
 * for the canonical link and structured-data scripts, all SSR-safe.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly titleService = inject(Title);
  private readonly meta = inject(Meta);
  private readonly doc = inject(DOCUMENT);

  setPage(config: SeoConfig): void {
    const ogTitle = config.ogTitle ?? config.title;
    const ogDescription = config.ogDescription ?? config.description;

    this.titleService.setTitle(config.title);
    this.meta.updateTag({ name: 'description', content: config.description });
    this.setCanonical(config.url);

    this.meta.updateTag({ property: 'og:title', content: ogTitle });
    this.meta.updateTag({ property: 'og:description', content: ogDescription });
    this.meta.updateTag({ property: 'og:url', content: config.url });
    this.meta.updateTag({ property: 'og:type', content: 'website' });
    if (config.ogImage) {
      this.meta.updateTag({ property: 'og:image', content: config.ogImage });
    }

    this.meta.updateTag({ name: 'twitter:title', content: ogTitle });
    this.meta.updateTag({
      name: 'twitter:description',
      content: ogDescription,
    });
  }

  private setCanonical(url: string): void {
    let link = this.doc.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    if (!link) {
      link = this.doc.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.doc.head.appendChild(link);
    }
    link.setAttribute('href', url);
  }
}
