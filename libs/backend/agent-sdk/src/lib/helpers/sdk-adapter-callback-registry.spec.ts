import 'reflect-metadata';

import { SdkAdapterCallbackRegistry } from './sdk-adapter-callback-registry';

describe('SdkAdapterCallbackRegistry', () => {
  it('starts with all slots empty (getters return undefined)', () => {
    const reg = new SdkAdapterCallbackRegistry();
    expect(reg.getSessionIdResolved()).toBeUndefined();
    expect(reg.getResultStats()).toBeUndefined();
    expect(reg.getCompactionStart()).toBeUndefined();
    expect(reg.getWorktreeCreated()).toBeUndefined();
    expect(reg.getWorktreeRemoved()).toBeUndefined();
  });

  it('stores and returns the same callback identity for each slot', () => {
    const reg = new SdkAdapterCallbackRegistry();
    const sessionIdCb = jest.fn();
    const statsCb = jest.fn();
    const compactCb = jest.fn();
    const worktreeAddCb = jest.fn();
    const worktreeRmCb = jest.fn();

    reg.setSessionIdResolved(sessionIdCb);
    reg.setResultStats(statsCb);
    reg.setCompactionStart(compactCb);
    reg.setWorktreeCreated(worktreeAddCb);
    reg.setWorktreeRemoved(worktreeRmCb);

    expect(reg.getSessionIdResolved()).toBe(sessionIdCb);
    expect(reg.getResultStats()).toBe(statsCb);
    expect(reg.getCompactionStart()).toBe(compactCb);
    expect(reg.getWorktreeCreated()).toBe(worktreeAddCb);
    expect(reg.getWorktreeRemoved()).toBe(worktreeRmCb);
  });

  it('emitSessionIdResolved is a no-op when no callback is set', () => {
    const reg = new SdkAdapterCallbackRegistry();
    expect(() => reg.emitSessionIdResolved('tab', 'real-id')).not.toThrow();
  });

  it('emitSessionIdResolved invokes the registered callback with both args', () => {
    const reg = new SdkAdapterCallbackRegistry();
    const cb = jest.fn();
    reg.setSessionIdResolved(cb);

    reg.emitSessionIdResolved('tab_1', 'real-uuid-1');

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('tab_1', 'real-uuid-1');
  });

  it('hasSessionIdResolved reports presence accurately', () => {
    const reg = new SdkAdapterCallbackRegistry();
    expect(reg.hasSessionIdResolved()).toBe(false);
    reg.setSessionIdResolved(jest.fn());
    expect(reg.hasSessionIdResolved()).toBe(true);
  });

  it('clear() empties every slot', () => {
    const reg = new SdkAdapterCallbackRegistry();
    reg.setSessionIdResolved(jest.fn());
    reg.setResultStats(jest.fn());
    reg.setCompactionStart(jest.fn());
    reg.setWorktreeCreated(jest.fn());
    reg.setWorktreeRemoved(jest.fn());

    reg.clear();

    expect(reg.getSessionIdResolved()).toBeUndefined();
    expect(reg.getResultStats()).toBeUndefined();
    expect(reg.getCompactionStart()).toBeUndefined();
    expect(reg.getWorktreeCreated()).toBeUndefined();
    expect(reg.getWorktreeRemoved()).toBeUndefined();
    expect(reg.hasSessionIdResolved()).toBe(false);
  });

  it('a setter replaces the previously stored callback identity', () => {
    const reg = new SdkAdapterCallbackRegistry();
    const first = jest.fn();
    const second = jest.fn();
    reg.setResultStats(first);
    reg.setResultStats(second);
    expect(reg.getResultStats()).toBe(second);
    expect(reg.getResultStats()).not.toBe(first);
  });
});
