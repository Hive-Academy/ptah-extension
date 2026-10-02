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

  describe('failed effort writes (setEffort swallows failure and rolls back)', () => {
    /** Simulates EffortStateService on a failed `config:effort-set`: the signal keeps its value. */
    const failingWrite = () => Promise.resolve();

    it('enable() stays off and resolves false when the xhigh pin does not land', async () => {
      setEffort.mockImplementationOnce(failingWrite);
      await expect(service.enable()).resolves.toBe(false);
      expect(service.enabled()).toBe(false);
      expect(current).toBe('medium');
    });

    it('disable() stays on and resolves false when the restore does not land', async () => {
      await service.enable(); // captured 'medium', now xhigh
      setEffort.mockImplementationOnce(failingWrite);
      await expect(service.disable()).resolves.toBe(false);
      expect(service.enabled()).toBe(true);
      expect(current).toBe('xhigh');

      // The remembered effort survives the failure, so a retry restores it.
      await expect(service.disable()).resolves.toBe(true);
      expect(current).toBe('medium');
    });

    it('toggle() resolves true when the switch lands', async () => {
      await expect(service.toggle(true)).resolves.toBe(true);
      await expect(service.toggle(false)).resolves.toBe(true);
      expect(service.enabled()).toBe(false);
    });
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
