/**
 * LibraryChangeFeed specs (TASK_2026_701, F7d).
 *
 * Coverage:
 *   - A valid `library:changed` push is published as
 *     `{ workspaceRoot, status, reasons, at }`.
 *   - Inert outside Electron (D3).
 *   - Malformed payloads and other message types leave the last value standing.
 */

import { TestBed } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

import { LibraryChangeFeed } from './library-change-feed';

const ROOT = 'D:/projects/qa3elhamor';

function setup(isElectron = true): LibraryChangeFeed {
  TestBed.configureTestingModule({
    providers: [{ provide: VSCodeService, useValue: { isElectron } }],
  });
  return TestBed.inject(LibraryChangeFeed);
}

function push(feed: LibraryChangeFeed, payload: unknown): void {
  feed.handleMessage({ type: MESSAGE_TYPES.LIBRARY_CHANGED, payload });
}

afterEach(() => {
  TestBed.resetTestingModule();
  jest.restoreAllMocks();
});

describe('LibraryChangeFeed', () => {
  it('handles library:changed', () => {
    expect(setup().handledMessageTypes).toEqual(['library:changed']);
  });

  it('is null until a push arrives', () => {
    expect(setup().latest()).toBeNull();
  });

  it('publishes a valid push with the time it arrived', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const feed = setup();

    push(feed, {
      workspaceRoot: ROOT,
      status: 'updated',
      reasons: ['setup-wizard', 'ptah-core'],
    });

    expect(feed.latest()).toEqual({
      workspaceRoot: ROOT,
      status: 'updated',
      reasons: ['setup-wizard', 'ptah-core'],
      at: 1_000,
    });
  });

  it('publishes a failed pass too', () => {
    const feed = setup();
    push(feed, { workspaceRoot: ROOT, status: 'failed', reasons: [] });
    expect(feed.latest()?.status).toBe('failed');
  });

  it('replaces the previous value with each new push, even an identical one', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const feed = setup();
    const payload = { workspaceRoot: ROOT, status: 'updated', reasons: ['a'] };

    push(feed, payload);
    const first = feed.latest();
    now.mockReturnValue(2_000);
    push(feed, payload);

    expect(feed.latest()).not.toBe(first);
    expect(feed.latest()?.at).toBe(2_000);
  });

  it('ignores every push outside Electron (D3)', () => {
    const feed = setup(false);
    push(feed, { workspaceRoot: ROOT, status: 'updated', reasons: [] });
    expect(feed.latest()).toBeNull();
  });

  it.each([
    ['no payload', undefined],
    ['a string', 'library:changed'],
    ['a missing root', { status: 'updated', reasons: [] }],
    ['an empty root', { workspaceRoot: '', status: 'updated', reasons: [] }],
    ['an unknown status', { workspaceRoot: ROOT, status: 'done', reasons: [] }],
    ['reasons not an array', { workspaceRoot: ROOT, status: 'updated', reasons: 'x' }],
    ['a non-string reason', { workspaceRoot: ROOT, status: 'updated', reasons: [1] }],
  ])('keeps the last value on a malformed push (%s)', (_label, payload) => {
    const feed = setup();
    push(feed, { workspaceRoot: ROOT, status: 'updated', reasons: ['ok'] });
    const before = feed.latest();

    push(feed, payload);

    expect(feed.latest()).toBe(before);
  });

  it('ignores other message types', () => {
    const feed = setup();
    feed.handleMessage({
      type: MESSAGE_TYPES.HARNESS_HEALTH_CHANGED,
      payload: { workspaceRoot: ROOT, status: 'updated', reasons: [] },
    });
    expect(feed.latest()).toBeNull();
  });

  it('does not share the caller reasons array', () => {
    const feed = setup();
    const reasons = ['setup-wizard'];
    push(feed, { workspaceRoot: ROOT, status: 'updated', reasons });
    reasons.push('later');
    expect(feed.latest()?.reasons).toEqual(['setup-wizard']);
  });
});
