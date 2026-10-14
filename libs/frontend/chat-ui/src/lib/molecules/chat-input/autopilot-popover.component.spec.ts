import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { AutopilotStateService } from '@ptah-extension/core';
import { SessionId } from '@ptah-extension/shared';
import { AutopilotPopoverComponent } from './autopilot-popover.component';

const TAB_SESSION = SessionId.from('1b4e28ba-2fa1-41d2-883f-0016d3cca427');

function makeAutopilotState(enabled: boolean) {
  const enabledSignal = signal(enabled);
  return {
    enabled: enabledSignal.asReadonly(),
    isPending: signal(false).asReadonly(),
    statusText: computed(() => (enabledSignal() ? 'Full Auto' : 'Manual')),
    setPermissionLevel: jest.fn().mockResolvedValue(undefined),
    toggleAutopilot: jest.fn().mockResolvedValue(undefined),
  };
}

describe('AutopilotPopoverComponent', () => {
  let fixture: ComponentFixture<AutopilotPopoverComponent>;
  let state: ReturnType<typeof makeAutopilotState>;

  async function create(
    enabled: boolean,
    sessionId?: SessionId | null,
  ): Promise<AutopilotPopoverComponent> {
    state = makeAutopilotState(enabled);
    await TestBed.configureTestingModule({
      imports: [AutopilotPopoverComponent],
      providers: [{ provide: AutopilotStateService, useValue: state }],
    }).compileComponents();
    fixture = TestBed.createComponent(AutopilotPopoverComponent);
    if (sessionId !== undefined) {
      fixture.componentRef.setInput('sessionId', sessionId);
    }
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it("enables autopilot on the composer tab's session, not the backend's most recent one", async () => {
    const popover = await create(false, TAB_SESSION);
    popover.selectLevel('yolo');

    await popover.enableAutopilot();

    expect(state.setPermissionLevel).toHaveBeenCalledWith('yolo', TAB_SESSION);
    expect(state.toggleAutopilot).toHaveBeenCalledWith(TAB_SESSION);
  });

  it("disables autopilot on the composer tab's session", async () => {
    const popover = await create(true, TAB_SESSION);

    await popover.disableAutopilot();

    expect(state.toggleAutopilot).toHaveBeenCalledWith(TAB_SESSION);
  });

  it('sends null while the tab has no live session yet', async () => {
    const popover = await create(false);

    await popover.enableAutopilot();

    expect(state.setPermissionLevel).toHaveBeenCalledWith('yolo', null);
    expect(state.toggleAutopilot).toHaveBeenCalledWith(null);
  });

  it('follows the tab when the bound session id changes', async () => {
    const popover = await create(true, null);
    const next = SessionId.from('6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b');
    fixture.componentRef.setInput('sessionId', next);

    await popover.disableAutopilot();

    expect(state.toggleAutopilot).toHaveBeenCalledWith(next);
  });
});
