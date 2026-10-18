import { TestBed } from '@angular/core/testing';
import { CommandCenterSendLockService } from '@ptah-extension/chat-state';
import { CommandCenterSessionCoordinator } from '../model/session-coordinator';
import { createHarness } from './integration-harness.testing';

describe('Command Center session integration', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('opens the marked chat session and sends text through the existing sender', async () => {
    const { fixture, sender } = createHarness();
    const page = fixture.componentInstance.page;
    expect(await page.open()).toBeNull();
    page.coordinator.chooseCurrentTab();
    expect(page.store.sessionId()).toBe('11111111-1111-4111-8111-111111111111');
    await page.sendCommand('Investigate CI');
    expect(sender.send).toHaveBeenCalledWith(
      'Investigate CI',
      expect.objectContaining({
        tabId: page.store.markedTabId(),
        ownerToken: expect.any(String),
      }),
    );
    fixture.destroy();
  });

  it('keeps the session identity across page voice exit and a new page open', async () => {
    const { fixture } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    page.coordinator.chooseCurrentTab();
    await page.exit();
    expect(page.store.sessionId()).toBe('11111111-1111-4111-8111-111111111111');
    expect(await page.open()).toBeNull();
    page.coordinator.chooseCurrentTab();
    fixture.destroy();
  });

  it('uses one active root and exposes an explicit New action', async () => {
    const { fixture } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    page.coordinator.chooseCurrentTab();
    const coordinator = fixture.debugElement.injector.get(
      CommandCenterSessionCoordinator,
    );
    expect(coordinator.newCommandCenter()).toBe(page.store.markedTabId());
    expect(page.store.sessionId()).toBeNull();
    fixture.destroy();
  });

  it('engages the competing-send lock during voice mode and releases it on mute', async () => {
    const { fixture } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    page.coordinator.chooseCurrentTab();
    const lock = TestBed.inject(CommandCenterSendLockService);
    const tabId = page.store.markedTabId() ?? '';
    page.coordinator.startVoice();
    expect(lock.isHeld(tabId, 'other-owner')).toBe(true);
    page.coordinator.mute();
    expect(lock.isHeld(tabId, 'other-owner')).toBe(false);
    fixture.destroy();
  });
});
