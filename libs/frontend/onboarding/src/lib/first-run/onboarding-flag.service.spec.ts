import { TestBed } from '@angular/core/testing';
import { LoggingService } from '@ptah-extension/core';
import {
  ONBOARDING_FLAG_KEY,
  OnboardingFlagService,
} from './onboarding-flag.service';

const SHOWN = '2026-10-01T10:00:00.000Z';

function createService(): OnboardingFlagService {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: LoggingService,
        useValue: { warn: jest.fn(), error: jest.fn() },
      },
    ],
  });
  return TestBed.inject(OnboardingFlagService);
}

function stored(): unknown {
  const raw = localStorage.getItem(ONBOARDING_FLAG_KEY);
  return raw === null ? null : JSON.parse(raw);
}

describe('OnboardingFlagService', () => {
  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  describe('eligibility', () => {
    it('is eligible with no record', () => {
      const service = createService();
      expect(service.storageAvailable()).toBe(true);
      expect(service.flag()).toEqual({});
      expect(service.isFirstRunEligible()).toBe(true);
    });

    it.each([
      ['shownAt', { shownAt: SHOWN }],
      ['dismissedAt', { dismissedAt: SHOWN }],
      ['completedAt', { completedAt: SHOWN }],
    ])('is not eligible once %s is set', (_field, record) => {
      localStorage.setItem(ONBOARDING_FLAG_KEY, JSON.stringify(record));
      const service = createService();
      expect(service.flag()).toEqual(record);
      expect(service.isFirstRunEligible()).toBe(false);
    });

    it('is not eligible when the storage probe fails', () => {
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      const service = createService();
      expect(service.storageAvailable()).toBe(false);
      expect(service.isFirstRunEligible()).toBe(false);
    });

    it('is not eligible when reading the record throws', () => {
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('read failed');
      });
      const service = createService();
      expect(service.storageAvailable()).toBe(true);
      expect(service.isFirstRunEligible()).toBe(false);
    });

    it.each([
      ['invalid JSON', '{not json'],
      ['an unknown key', JSON.stringify({ shownAt: SHOWN, extra: 1 })],
      ['a non-ISO date', JSON.stringify({ shownAt: 'yesterday' })],
      ['a non-object', JSON.stringify('shown')],
    ])('treats %s as unreadable: no redirect, flag empty', (_label, raw) => {
      localStorage.setItem(ONBOARDING_FLAG_KEY, raw);
      const service = createService();
      expect(service.flag()).toEqual({});
      expect(service.isFirstRunEligible()).toBe(false);
    });
  });

  describe('writes', () => {
    it('markShown persists shownAt and ends eligibility', () => {
      const service = createService();
      service.markShown();

      const record = stored() as { shownAt: string };
      expect(new Date(record.shownAt).toISOString()).toBe(record.shownAt);
      expect(service.flag().shownAt).toBe(record.shownAt);
      expect(service.isFirstRunEligible()).toBe(false);
    });

    it('merges into the stored record instead of replacing it', () => {
      const service = createService();
      // Another writer (another window) stored a field after construction.
      localStorage.setItem(
        ONBOARDING_FLAG_KEY,
        JSON.stringify({ completedAt: SHOWN }),
      );

      service.markDismissed();

      expect(stored()).toEqual({
        completedAt: SHOWN,
        dismissedAt: expect.any(String),
      });
      expect(service.flag().completedAt).toBe(SHOWN);
    });

    it('keeps every field across markShown, markDismissed and markCompleted', () => {
      const service = createService();
      service.markShown();
      service.markDismissed();
      service.markCompleted();

      expect(Object.keys(stored() as object).sort()).toEqual([
        'completedAt',
        'dismissedAt',
        'shownAt',
      ]);
    });

    it('suppresses the redirect for the session when markShown cannot write', () => {
      const service = createService();
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      service.markShown();

      expect(stored()).toBeNull();
      expect(service.isFirstRunEligible()).toBe(false);
    });

    it('suppresses when storage was unavailable from the start', () => {
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      const service = createService();

      service.markShown();

      expect(service.flag().shownAt).toEqual(expect.any(String));
      expect(service.isFirstRunEligible()).toBe(false);
    });

    it('never overwrites an unreadable record', () => {
      const raw = JSON.stringify({ shownAt: SHOWN, extra: {} });
      localStorage.setItem(ONBOARDING_FLAG_KEY, raw);
      const service = createService();

      service.markDismissed();

      expect(localStorage.getItem(ONBOARDING_FLAG_KEY)).toBe(raw);
      expect(service.isFirstRunEligible()).toBe(false);
    });

    it('removes its storage probe key', () => {
      createService();
      expect(localStorage.getItem('ptah.onboarding.probe')).toBeNull();
      expect(localStorage.length).toBe(0);
    });
  });
  describe('ready slice', () => {
    const CLAUDE = '2026-10-02T10:00:00.000Z';

    it('keeps a v1 record without ready unchanged', () => {
      const raw = JSON.stringify({ shownAt: SHOWN });
      localStorage.setItem(ONBOARDING_FLAG_KEY, raw);
      const service = createService();
      expect(service.flag()).toEqual({ shownAt: SHOWN });
      expect(localStorage.getItem(ONBOARDING_FLAG_KEY)).toBe(raw);
    });

    it('reads a valid ready slice', () => {
      localStorage.setItem(
        ONBOARDING_FLAG_KEY,
        JSON.stringify({ ready: { claudeAt: CLAUDE } }),
      );
      const service = createService();
      expect(service.flag()).toEqual({ ready: { claudeAt: CLAUDE } });
      expect(service.isFirstRunEligible()).toBe(true);
    });

    it.each([
      ['a string', 'yes'],
      ['a non-datetime field', { claudeAt: 'tomorrow' }],
      ['null', null],
    ])('drops a malformed ready (%s) and keeps the top level', (_n, ready) => {
      localStorage.setItem(
        ONBOARDING_FLAG_KEY,
        JSON.stringify({ shownAt: SHOWN, ready }),
      );
      const service = createService();
      expect(service.flag()).toEqual({ shownAt: SHOWN, ready: {} });
      expect(service.isFirstRunEligible()).toBe(false);
    });

    it('keeps an unknown top-level key unreadable (no redirect)', () => {
      localStorage.setItem(
        ONBOARDING_FLAG_KEY,
        JSON.stringify({ ready: {}, other: 1 }),
      );
      const service = createService();
      expect(service.flag()).toEqual({});
      expect(service.isFirstRunEligible()).toBe(false);
    });

    it('markReady merges into the stored record', () => {
      localStorage.setItem(
        ONBOARDING_FLAG_KEY,
        JSON.stringify({ shownAt: SHOWN, ready: { claudeAt: CLAUDE } }),
      );
      const service = createService();

      service.markReady('settingsAt');

      expect(stored()).toEqual({
        shownAt: SHOWN,
        ready: { claudeAt: CLAUDE, settingsAt: expect.any(String) },
      });
      expect(service.flag().ready?.settingsAt).toEqual(expect.any(String));
    });

    it('markDismissed preserves ready', () => {
      localStorage.setItem(
        ONBOARDING_FLAG_KEY,
        JSON.stringify({ ready: { skippedAt: CLAUDE } }),
      );
      const service = createService();

      service.markDismissed();

      expect(stored()).toEqual({
        dismissedAt: expect.any(String),
        ready: { skippedAt: CLAUDE },
      });
    });

    it('a failed markReady write does not suppress the redirect', () => {
      const service = createService();
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      expect(() => service.markReady('skippedAt')).not.toThrow();

      expect(service.flag().ready?.skippedAt).toEqual(expect.any(String));
      expect(service.isFirstRunEligible()).toBe(true);
    });
  });
});
