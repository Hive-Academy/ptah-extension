/**
 * UpdateBannerService specs
 *
 * Coverage (8 scenarios):
 *  1. handleMessage with update-available payload → state becomes available
 *  2. handleMessage with update-downloaded payload → state becomes downloaded
 *  3. handleMessage with checking when dismissed → stays dismissed
 *  4. handleMessage with idle when dismissed → stays dismissed
 *  5. handleMessage with downloaded when dismissed → exits dismissed to downloaded
 *  6. handleMessage with available when dismissed → exits dismissed to available
 *  7. handleMessage with error when dismissed → exits dismissed to error
 *  8. dismiss() → state becomes dismissed
 */

import { TestBed } from '@angular/core/testing';
import { UpdateBannerService } from './update-banner.service';
import type { UpdateLifecycleState } from '@ptah-extension/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMsg(payload: UpdateLifecycleState) {
  return { type: 'update:statusChanged', payload };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UpdateBannerService', () => {
  let service: UpdateBannerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [UpdateBannerService],
    });
    service = TestBed.inject(UpdateBannerService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('initial state is idle', () => {
    expect(service.state().state).toBe('idle');
  });

  describe('handleMessage — normal (non-dismissed) transitions', () => {
    it('transitions to available when payload.state is available', () => {
      const payload: UpdateLifecycleState = {
        state: 'available',
        currentVersion: '1.0.0',
        newVersion: '1.1.0',
        releaseNotesMarkdown: null,
      };
      service.handleMessage(makeMsg(payload));
      expect(service.state().state).toBe('available');
    });

    it('transitions to downloaded when payload.state is downloaded', () => {
      const payload: UpdateLifecycleState = {
        state: 'downloaded',
        currentVersion: '1.0.0',
        newVersion: '1.1.0',
        releaseNotesMarkdown: null,
      };
      service.handleMessage(makeMsg(payload));
      expect(service.state().state).toBe('downloaded');
    });

    it('transitions to checking', () => {
      service.handleMessage(makeMsg({ state: 'checking' }));
      expect(service.state().state).toBe('checking');
    });

    it('transitions to downloading', () => {
      service.handleMessage(
        makeMsg({
          state: 'downloading',
          currentVersion: '1.0.0',
          newVersion: '1.1.0',
          percent: 50,
          bytesPerSecond: 1000,
          transferred: 5000,
          total: 10000,
        }),
      );
      expect(service.state().state).toBe('downloading');
    });

    it('transitions to error', () => {
      service.handleMessage(makeMsg({ state: 'error', message: 'oops' }));
      expect(service.state().state).toBe('error');
    });
  });

  describe('dismiss()', () => {
    it('sets state to dismissed', () => {
      service.handleMessage(
        makeMsg({
          state: 'available',
          currentVersion: '1.0.0',
          newVersion: '1.1.0',
        }),
      );
      service.dismiss();
      expect(service.state().state).toBe('dismissed');
    });
  });

  describe('handleMessage — dismissed suppression (non-actionable states)', () => {
    beforeEach(() => {
      // Prime state to dismissed first.
      service.dismiss();
      expect(service.state().state).toBe('dismissed');
    });

    it('stays dismissed when payload.state is checking', () => {
      service.handleMessage(makeMsg({ state: 'checking' }));
      expect(service.state().state).toBe('dismissed');
    });

    it('stays dismissed when payload.state is idle', () => {
      service.handleMessage(makeMsg({ state: 'idle' }));
      expect(service.state().state).toBe('dismissed');
    });
  });

  describe('handleMessage — dismissed suppression (actionable states exit dismissed)', () => {
    beforeEach(() => {
      service.dismiss();
      expect(service.state().state).toBe('dismissed');
    });

    it('exits dismissed to downloaded when payload.state is downloaded', () => {
      service.handleMessage(
        makeMsg({
          state: 'downloaded',
          currentVersion: '1.0.0',
          newVersion: '1.1.0',
          releaseNotesMarkdown: null,
        }),
      );
      expect(service.state().state).toBe('downloaded');
    });

    it('exits dismissed to available when payload.state is available', () => {
      service.handleMessage(
        makeMsg({
          state: 'available',
          currentVersion: '1.0.0',
          newVersion: '1.1.0',
          releaseNotesMarkdown: null,
        }),
      );
      expect(service.state().state).toBe('available');
    });

    it('exits dismissed to error when payload.state is error', () => {
      service.handleMessage(makeMsg({ state: 'error', message: 'disk full' }));
      expect(service.state().state).toBe('error');
    });

    it('exits dismissed to downloading when payload.state is downloading', () => {
      service.handleMessage(
        makeMsg({
          state: 'downloading',
          currentVersion: '1.0.0',
          newVersion: '1.1.0',
          percent: 20,
          bytesPerSecond: 500,
          transferred: 2000,
          total: 10000,
        }),
      );
      expect(service.state().state).toBe('downloading');
    });
  });

  describe('handleMessage — guard clauses for malformed messages', () => {
    it('ignores null payload', () => {
      service.handleMessage({ type: 'update:statusChanged', payload: null });
      expect(service.state().state).toBe('idle');
    });

    it('ignores non-object payload', () => {
      service.handleMessage({ type: 'update:statusChanged', payload: 'bad' });
      expect(service.state().state).toBe('idle');
    });

    it('ignores payload without state key', () => {
      service.handleMessage({
        type: 'update:statusChanged',
        payload: { version: '1.0.0' },
      });
      expect(service.state().state).toBe('idle');
    });

    it('ignores undefined payload', () => {
      service.handleMessage({ type: 'update:statusChanged' });
      expect(service.state().state).toBe('idle');
    });
  });

  describe('handledMessageTypes', () => {
    it('declares UPDATE_STATUS_CHANGED message type', () => {
      expect(service.handledMessageTypes).toContain('update:statusChanged');
    });
  });
});
