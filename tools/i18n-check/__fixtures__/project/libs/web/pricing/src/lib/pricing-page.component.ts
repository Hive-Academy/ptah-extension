// i18n-check self-test fixture (data only, never compiled). Planted
// violations are marked PLANT; lines marked PASS must not be reported.
import { Component } from '@angular/core';

// Local declarations: the fixture imports no workspace project.
declare function translate(key: string, params?: object): string;
declare function translateSignal(key: string): () => string;
declare function translateObjectSignal(key: string): () => object;

// PASS: a key constant; every value is a known key.
export const STATUS_I18N_KEYS = {
  active: 'pricing.status.active',
  paused: 'pricing.status.paused',
} as const;

// PASS: group names, read by translateObjectSignal below.
export const SECTION_I18N_KEYS = {
  card: 'pricing.card',
  status: 'pricing.status',
} as const;

// PLANT (not-a-group on the value): a single key, read by translateObjectSignal.
export const CARD_LEAF_I18N_KEYS = { heading: 'pricing.card.heading' } as const;

@Component({
  selector: 'fx-pricing-page',
  template: `
    <h1>{{ 'pricing.page.title' | transloco }}</h1>
    <p>{{ 'pricing.page.missing' | transloco }}</p>
    <p>{{ 'landing.hero.title' | transloco }}</p>
    <p>{{ 'core.checkout.error' | transloco }}</p>
    <span>{{ statusI18nKeys[status] | transloco }}</span>
    <!-- i18n-keys: core.checkout.* -->
    <p>{{ message.key | transloco }}</p>
    <p>{{ dynamicKey | transloco }}</p>
  `,
})
export class PricingPageComponent {
  // PASS: alias of a key constant, used as a computed-key receiver above.
  protected readonly statusI18nKeys = STATUS_I18N_KEYS;
  protected status: keyof typeof STATUS_I18N_KEYS = 'active';
  protected message = { key: 'core.checkout.cancelled' };
  protected dynamicKey = 'pricing.' + 'page.title';

  // PASS: literal translate calls with known keys.
  readonly title = translateSignal('pricing.page.title');
  readonly subtitle = translate('pricing.page.subtitle', { count: 3 });

  // PLANT (unknown-key via the literal scan): not in en.json.
  readonly ghost = 'pricing.page.ghost';

  // i18n-ignore: documentation example of a key path, not a real key
  readonly example = 'pricing.not.a.key';

  // PASS: translateObjectSignal reading a group-name constant.
  readonly sections = translateObjectSignal(SECTION_I18N_KEYS.card);
  // PLANT (not-a-group, reported on CARD_LEAF_I18N_KEYS.heading's value).
  readonly heading = translateObjectSignal(CARD_LEAF_I18N_KEYS.heading);

  // PLANT (not-a-group on the marker): it lists only a single key.
  // i18n-keys: pricing.card.note
  readonly markedGroup = translateObjectSignal(this.dynamicKey);

  // PASS: the marker covers the whole wrapped property; the key argument sits
  // two lines below it.
  // i18n-keys: core.checkout.*
  readonly checkoutNotice = translate(
    this.checkoutMessage.key,
    this.checkoutMessage.params,
  );

  // PASS: the marker covers the whole wrapped array.
  // i18n-ignore: documentation samples of key paths, not real keys
  readonly docSamples = [
    'a sample that is long enough to make Prettier keep one entry per line',
    'pricing.doc.sample.path',
  ];

  // i18n-keys: core.checkout.*
  readonly unrelated = 1;
  // PLANT (unannotated-computed-key): the marker above covers `unrelated` only.
  readonly detachedNotice = translate(this.detachedMessage.key);

  // i18n-ignore: covers the next property only
  readonly unrelatedToo = 2;
  // PLANT (unknown-key via the literal scan): not covered by the marker above.
  readonly detachedSample = 'pricing.detached.sample.path';

  protected checkoutMessage = { key: 'core.checkout.error', params: {} };
  protected detachedMessage = { key: 'core.checkout.error' };

  resolve(i18n: { translate(key: string): string }): string {
    // PLANT (unannotated-computed-key): argument is neither a literal nor annotated.
    return i18n.translate(this.dynamicKey);
  }
}
