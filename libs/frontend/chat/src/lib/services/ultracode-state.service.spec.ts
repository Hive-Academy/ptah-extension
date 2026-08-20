/**
 * UltracodeStateService specs — the session-scoped mode that pins effort to
 * xhigh and stamps outgoing human input with the `ultracode` keyword.
 *
 * Focus:
 *   - enable() captures the current effort and switches to xhigh
 *   - disable() restores the captured effort (including SDK default)
 *   - applyKeyword() is a no-op when off, prefixes when on, idempotent otherwise
 */

import { TestBed } from '@angular/core/testing';
import { EffortStateService } from '@ptah-extension/core';
import type { EffortLevel } from '@ptah-extension/shared';
import { UltracodeStateService } from './ultracode-state.service';

describe('UltracodeStateService', () => {
  let service: UltracodeStateService;
  let setEffort: jest.Mock;
  let current: EffortLevel | undefined;

  beforeEach(() => {
    current = 'medium';
    setEffort = jest.fn((effort: EffortLevel | undefined) => {
      current = effort;
      return Promise.resolve();
    });

    TestBed.configureTestingModule({
      providers: [
        UltracodeStateService,
        {
          provide: EffortStateService,
          useValue: { currentEffort: () => current, setEffort },
        },
      ],
    });
    service = TestBed.inject(UltracodeStateService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('is disabled by default', () => {
    expect(service.enabled()).toBe(false);
  });

  it('enable() switches effort to xhigh and flips the flag', async () => {
    await service.enable();
    expect(service.enabled()).toBe(true);
    expect(setEffort).toHaveBeenLastCalledWith('xhigh');
  });

  it('disable() restores the effort captured before enable()', async () => {
    await service.enable(); // captured 'medium', now xhigh
    await service.disable();
    expect(service.enabled()).toBe(false);
    expect(setEffort).toHaveBeenLastCalledWith('medium');
  });

  it('restores the SDK default (undefined) when that was the prior effort', async () => {
    current = undefined;
    await service.enable();
    await service.disable();
    expect(setEffort).toHaveBeenLastCalledWith(undefined);
  });

  it('enable() is idempotent — a second call does not trap the prior effort', async () => {
    await service.enable(); // captures 'medium'
    setEffort.mockClear();
    await service.enable(); // no-op, must not re-capture xhigh as "previous"
    expect(setEffort).not.toHaveBeenCalled();

    await service.disable();
    expect(setEffort).toHaveBeenLastCalledWith('medium');
  });

  describe('applyKeyword', () => {
    it('leaves content untouched while disabled', () => {
      expect(service.applyKeyword('hello')).toBe('hello');
    });

    it('prefixes content with the keyword while enabled', async () => {
      await service.enable();
      expect(service.applyKeyword('hello')).toBe('ultracode: hello');
    });

    it('does not double-stamp content that already has the keyword', async () => {
      await service.enable();
      expect(service.applyKeyword('ultracode: hi')).toBe('ultracode: hi');
    });
  });
});
