import { TestBed } from '@angular/core/testing';
import { API_BASE_URL, provideApiBaseUrl } from './api-base-url.token';
import {
  BUILDERS_CHECKOUT_ENABLED,
  provideBuildersCheckoutEnabled,
} from './builders-checkout.token';

/**
 * These tokens replaced direct `environments/environment` imports so the HTTP
 * plumbing and the pricing UI could move out of the app. The defaults are the
 * fail-safe half of that contract, so they are worth pinning.
 */
describe('web-core environment tokens', () => {
  describe('API_BASE_URL', () => {
    it('defaults to same-origin when the app does not provide it', () => {
      TestBed.configureTestingModule({});

      expect(TestBed.inject(API_BASE_URL)).toBe('');
    });

    it('resolves the value passed to provideApiBaseUrl', () => {
      TestBed.configureTestingModule({
        providers: [provideApiBaseUrl('https://api.ptah.live')],
      });

      expect(TestBed.inject(API_BASE_URL)).toBe('https://api.ptah.live');
    });
  });

  describe('BUILDERS_CHECKOUT_ENABLED', () => {
    it('fails safe to checkout-closed when not provided', () => {
      TestBed.configureTestingModule({});

      expect(TestBed.inject(BUILDERS_CHECKOUT_ENABLED)).toBe(false);
    });

    it('resolves the value passed to provideBuildersCheckoutEnabled', () => {
      TestBed.configureTestingModule({
        providers: [provideBuildersCheckoutEnabled(true)],
      });

      expect(TestBed.inject(BUILDERS_CHECKOUT_ENABLED)).toBe(true);
    });
  });
});
