import { CommandCenterSendLockService } from './command-center-send-lock.service';

describe('CommandCenterSendLockService', () => {
  it('holds only the root and its SDK session, except for its owner', () => {
    const lock = new CommandCenterSendLockService();
    lock.engage('root', null, 'voice');
    expect(lock.isHeld('root')).toBe(true);
    expect(lock.isHeld('root', 'voice')).toBe(false);
    expect(lock.isHeld('other')).toBe(false);
    lock.rekey('other', 'wrong');
    lock.rekey('root', 'sdk');
    expect(lock.state()?.sdkSessionId).toBe('sdk');
    expect(lock.isHeld('root')).toBe(true);
    expect(lock.isHeld('sdk')).toBe(true);
    expect(lock.isHeld('sdk', 'voice')).toBe(false);
    expect(lock.isHeld('sdk', 'other-token')).toBe(true);
    lock.release('other-token');
    expect(lock.isHeld('sdk')).toBe(true);
    lock.release('voice');
    expect(lock.isHeld('root')).toBe(false);
    expect(lock.isHeld('sdk')).toBe(false);
  });

  it('starts unlocked in a new service instance after a reload', () => {
    const oldPage = new CommandCenterSendLockService();
    oldPage.engage('root', 'sdk', 'voice');
    expect(new CommandCenterSendLockService().isHeld('sdk')).toBe(false);
  });

  it('clears only the matching root and makes a later owner release harmless', () => {
    const lock = new CommandCenterSendLockService();
    lock.engage('root', 'sdk', 'voice');
    lock.clearForRoot('other');
    expect(lock.isHeld('root')).toBe(true);
    expect(lock.isHeld('sdk')).toBe(true);
    lock.clearForRoot('root');
    expect(lock.state()).toBeNull();
    expect(lock.isHeld('root')).toBe(false);
    expect(lock.isHeld('sdk')).toBe(false);
    lock.release('voice');
    expect(lock.state()).toBeNull();
  });

  it('notifies the released root on an owner release', () => {
    const lock = new CommandCenterSendLockService();
    const listener = jest.fn();
    lock.onRelease(listener);
    lock.engage('root', 'sdk', 'voice');

    lock.release('voice');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('root');
  });

  it('notifies only when clearForRoot clears the active root', () => {
    const lock = new CommandCenterSendLockService();
    const listener = jest.fn();
    lock.onRelease(listener);
    lock.engage('root', 'sdk', 'voice');

    lock.clearForRoot('other');
    expect(listener).not.toHaveBeenCalled();
    lock.clearForRoot('root');
    lock.clearForRoot('root');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('root');
  });

  it('notifies the old root when engage replaces a different root', () => {
    const lock = new CommandCenterSendLockService();
    const listener = jest.fn();
    lock.onRelease(listener);
    lock.engage('old-root', 'old-sdk', 'voice');

    lock.engage('old-root', 'new-sdk', 'voice');
    expect(listener).not.toHaveBeenCalled();
    lock.engage('new-root', 'new-sdk', 'voice');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('old-root');
    expect(lock.state()?.rootTabId).toBe('new-root');
  });

  it('does not notify on release with the wrong token', () => {
    const lock = new CommandCenterSendLockService();
    const listener = jest.fn();
    lock.onRelease(listener);
    lock.engage('root', 'sdk', 'voice');

    lock.release('other-token');

    expect(listener).not.toHaveBeenCalled();
    expect(lock.isHeld('root')).toBe(true);
  });

  it('stops notifying an unsubscribed listener', () => {
    const lock = new CommandCenterSendLockService();
    const listener = jest.fn();
    const unsubscribe = lock.onRelease(listener);
    lock.engage('root', 'sdk', 'voice');

    unsubscribe();
    lock.release('voice');

    expect(listener).not.toHaveBeenCalled();
  });
});
