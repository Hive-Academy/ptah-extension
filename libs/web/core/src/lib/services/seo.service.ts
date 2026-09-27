import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { DEFAULT_LANG, I18nService } from '@ptah-extension/i18n';

export interface SeoConfig {
  /** Translation key of the full <title> text. */
  readonly titleKey: string;
  /** Translation key of the meta description. */
  readonly descriptionKey: string;
  /** Absolute canonical URL for the route. */
  readonly url: string;
  /** Key of og:title / twitter:title — falls back to {@link titleKey}. */
  readonly ogTitleKey?: string;
  /** Key of og:description / twitter:description — falls back to {@link descriptionKey}. */
  readonly ogDescriptionKey?: string;
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
 *
 * The config carries translation keys of scopes the route has already loaded.
 * `<title>` and the meta description follow the active language (a switch
 * re-applies them); `og:*` and `twitter:*` are always written in English,
 * because link previews are crawled from the English prerender. The server
 * renders English, so the prerendered head is English throughout.
 *
 * i18n-check: the keys come from the page scopes (`app`, `landing`, `legal`,
 * `pricing`), not from `core`. So web-core's `i18n-check` target passes
 * `--allow-scope ui,app,landing,legal,pricing` and lists those scopes' i18n
 * dirs in its `inputs`, and the key markers on `applyLocalized` and
 * `english` name the `seo` groups. This departs on purpose from the plan's "core allows only `ui`"
 * rule (implementation-plan.md:289, :351; user decision, TASK_2026_575
 * batch 10).
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly titleService = inject(Title);
  private readonly meta = inject(Meta);
  private readonly doc = inject(DOCUMENT);
  private readonly i18n = inject(I18nService);

  /** The last `setPage` config; the language effect re-applies its text. */
  private page: SeoConfig | null = null;

  constructor() {
    effect(() => {
      this.i18n.lang();
      if (this.page) this.applyLocalized(this.page);
    });
  }

  setPage(config: SeoConfig): void {
    const ogTitle = this.english(config.ogTitleKey ?? config.titleKey);
    const ogDescription = this.english(
      config.ogDescriptionKey ?? config.descriptionKey,
    );

    this.applyLocalized(config);
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

    this.page = config;
  }

  /** `<title>` and the meta description, in the active language. */
  // i18n-keys: app.seo.* landing.seo.* legal.seo.* pricing.seo.*
  private applyLocalized(config: SeoConfig): void {
    this.titleService.setTitle(this.i18n.translate(config.titleKey));
    this.meta.updateTag({
      name: 'description',
      content: this.i18n.translate(config.descriptionKey),
    });
  }

  /** A key's English value, for the tags link previews read. */
  // i18n-keys: app.seo.* landing.seo.* legal.seo.* pricing.seo.*
  private english(key: string): string {
    return this.i18n.translate(key, {}, DEFAULT_LANG);
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
