/**
 * UpdateBannerService specs
 *
 * Coverage:
 *  1. handleMessage with available payload → state becomes available
 *  2. handleMessage with checking/idle when dismissed → stays dismissed
 *  3. handleMessage with available/error when dismissed → exits dismissed
 *  4. dismiss() → state becomes dismissed
 *  5. guard clauses for malformed messages
 */

import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { UpdateBannerService } from './update-banner.service';
import type { UpdateLifecycleState } from '@ptah-extension/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMsg(payload: UpdateLifecycleState) {
  return { type: 'update:statusChanged', payload };
}

function available(): UpdateLifecycleState {
  return {
    state: 'available',
    currentVersion: '0.1.48',
    newVersion: '0.1.49',
    releaseNotesMarkdown: null,
    downloadUrl: 'https://dl.example/0.1.49.exe',
    releaseUrl:
      'https://github.com/Hive-Academy/ptah-extension/releases/tag/electron-v0.1.49',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UpdateBannerService', () => {
  let service: UpdateBannerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        UpdateBannerService,
        // isElectron=false → constructor hydration is a no-op (the update:*
        // namespace is Electron-only), so these specs exercise the push path.
        { provide: VSCodeService, useValue: { isElectron: false } },
        { provide: ClaudeRpcService, useValue: { call: jest.fn() } },
      ],
    });
    service = TestBed.inject(UpdateBannerService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('initial state is idle', () => {
    expect(service.state().state).toBe('idle');
  });

  describe('handleMessage — normal (non-dismissed) transitions', () => {
    it('transitions to available when payload.state is available', () => {
      service.handleMessage(makeMsg(available()));
      expect(service.state().state).toBe('available');
    });

    it('transitions to checking', () => {
      service.handleMessage(makeMsg({ state: 'checking' }));
      expect(service.state().state).toBe('checking');
    });

    it('transitions to error', () => {
      service.handleMessage(makeMsg({ state: 'error', message: 'oops' }));
      expect(service.state().state).toBe('error');
    });
  });

  describe('dismiss()', () => {
    it('sets state to dismissed', () => {
      service.handleMessage(makeMsg(available()));
      service.dismiss();
      expect(service.state().state).toBe('dismissed');
    });
  });

  describe('handleMessage — dismissed suppression (non-actionable states)', () => {
    beforeEach(() => {
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

    it('exits dismissed to available when payload.state is available', () => {
      service.handleMessage(makeMsg(available()));
      expect(service.state().state).toBe('available');
    });

    it('exits dismissed to error when payload.state is error', () => {
      service.handleMessage(makeMsg({ state: 'error', message: 'disk full' }));
      expect(service.state().state).toBe('error');
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
