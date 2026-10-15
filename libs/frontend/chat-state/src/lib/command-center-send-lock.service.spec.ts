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
});
