import { TestBed } from '@angular/core/testing';
import {
  MESSAGE_TYPES,
  type SurfaceUpdatedPayload,
} from '@ptah-extension/shared';

import { SurfaceUpdateInbox } from './surface-update-inbox.service';

/** A well-formed push; the inbox never looks past `routingId`. */
function makePayload(routingId: string): SurfaceUpdatedPayload {
  return {
    routingId,
    surfaceId: 'surface-1',
    revision: 1,
    origin: 'agent',
    change: { kind: 'deleted', reason: 'agent-deleted' },
  };
}

describe('SurfaceUpdateInbox', () => {
  let inbox: SurfaceUpdateInbox;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    inbox = TestBed.inject(SurfaceUpdateInbox);
  });

  it('declares exactly the surface:updated message type', () => {
    expect(inbox.handledMessageTypes).toEqual([MESSAGE_TYPES.SURFACE_UPDATED]);
  });

  it('starts with nothing claimed', () => {
    expect(inbox.isClaimed('anything')).toBe(false);
  });

  it('claim() marks the routing id and release() clears it', () => {
    const listener = jest.fn();
    inbox.claim('route-1', listener);
    expect(inbox.isClaimed('route-1')).toBe(true);

    inbox.release('route-1');
    expect(inbox.isClaimed('route-1')).toBe(false);
  });

  it('release() of an unclaimed routing id is a no-op', () => {
    expect(() => inbox.release('ghost')).not.toThrow();
  });

  it('a duplicate claim() throws synchronously', () => {
    inbox.claim('route-1', jest.fn());
    expect(() => inbox.claim('route-1', jest.fn())).toThrow(
      'SurfaceUpdateInbox: routing id is already claimed: route-1',
    );
  });

  it('a routing id can be claimed again after release()', () => {
    inbox.claim('route-1', jest.fn());
    inbox.release('route-1');

    const second = jest.fn();
    expect(() => inbox.claim('route-1', second)).not.toThrow();

    inbox.handleMessage({
      type: MESSAGE_TYPES.SURFACE_UPDATED,
      payload: makePayload('route-1'),
    });
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('a claimed id calls exactly its listener, with the same payload object', () => {
    const first = jest.fn();
    const second = jest.fn();
    inbox.claim('route-1', first);
    inbox.claim('route-2', second);

    const payload = makePayload('route-2');
    inbox.handleMessage({ type: MESSAGE_TYPES.SURFACE_UPDATED, payload });

    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(payload);
    expect(second.mock.calls[0][0]).toBe(payload);
    expect(first).not.toHaveBeenCalled();
  });

  it('delivers the payload unmodified — the inbox validates nothing but the key', () => {
    const listener = jest.fn();
    inbox.claim('route-1', listener);

    // Not a valid SurfaceUpdatedPayload; the inbox must not care. The lazy
    // consumer runs its own structural guard on this raw object.
    const payload = { routingId: 'route-1', anything: 'goes' };
    inbox.handleMessage({ type: MESSAGE_TYPES.SURFACE_UPDATED, payload });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toBe(payload);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'surface:updated'],
    ['a number', 42],
    ['an array', ['route-1']],
  ])('drops a non-object payload (%s) and calls no listener', (_label, payload) => {
    const listener = jest.fn();
    inbox.claim('route-1', listener);

    inbox.handleMessage({ type: MESSAGE_TYPES.SURFACE_UPDATED, payload });

    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', {}],
    ['non-string', { routingId: 42 }],
    ['empty string', { routingId: '' }],
  ])(
    'drops a payload whose routingId is %s and calls no listener',
    (_label, payload) => {
      const listener = jest.fn();
      inbox.claim('route-1', listener);

      inbox.handleMessage({ type: MESSAGE_TYPES.SURFACE_UPDATED, payload });

      expect(listener).not.toHaveBeenCalled();
    },
  );

  it('drops a push for an unclaimed routing id', () => {
    const listener = jest.fn();
    inbox.claim('route-1', listener);

    inbox.handleMessage({
      type: MESSAGE_TYPES.SURFACE_UPDATED,
      payload: makePayload('route-unclaimed'),
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('drops a push for a released routing id', () => {
    const listener = jest.fn();
    inbox.claim('route-1', listener);
    inbox.release('route-1');

    inbox.handleMessage({
      type: MESSAGE_TYPES.SURFACE_UPDATED,
      payload: makePayload('route-1'),
    });

    expect(listener).not.toHaveBeenCalled();
  });
});
