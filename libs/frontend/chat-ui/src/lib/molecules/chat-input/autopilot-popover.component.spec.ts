import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AutopilotStateService, ClaudeRpcService } from '@ptah-extension/core';
import {
  PERMISSION_LEVEL_NAMES,
  SessionId,
  type PermissionLevel,
} from '@ptah-extension/shared';
import { AutopilotPopoverComponent } from './autopilot-popover.component';

const TAB_SESSION = SessionId.from('1b4e28ba-2fa1-41d2-883f-0016d3cca427');
const OTHER_SESSION = SessionId.from('6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b');

interface FakeTabState {
  enabled: boolean;
  permissionLevel: PermissionLevel;
}

function makeAutopilotState(enabled: boolean) {
  const enabledSignal = signal(enabled);
  return {
    isPending: signal(false).asReadonly(),
    // Read by the approval chip ink (agent plan mode wins, like the text).
    agentPlanMode: signal(false).asReadonly(),
    stateFor: (): FakeTabState => ({
      enabled: enabledSignal(),
      permissionLevel: 'yolo',
    }),
    statusTextFor: (state: FakeTabState): string =>
      state.enabled ? 'Full Auto' : 'Manual',
    refreshSession: jest.fn().mockResolvedValue(undefined),
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
    expect(state.refreshSession).not.toHaveBeenCalled();
  });

  it('follows the tab when the bound session id changes', async () => {
    const popover = await create(true, null);
    fixture.componentRef.setInput('sessionId', OTHER_SESSION);
    fixture.detectChanges();

    await popover.disableAutopilot();

    expect(state.toggleAutopilot).toHaveBeenCalledWith(OTHER_SESSION);
    expect(state.refreshSession).toHaveBeenCalledWith(OTHER_SESSION);
  });

  it("re-reads the tab's live level when the dropdown opens", async () => {
    const popover = await create(true, TAB_SESSION);
    state.refreshSession.mockClear();

    popover.toggleDropdown();

    expect(state.refreshSession).toHaveBeenCalledWith(TAB_SESSION);
  });
});

/**
 * TASK_2026_660 — a toggle re-gates only its own tab's session, so a second
 * tab must keep showing its own session's level, not the last toggle's.
 * Real AutopilotStateService over an RPC fake that keeps per-session levels
 * the way the host does.
 */
describe('AutopilotPopoverComponent across tabs', () => {
  const liveLevels = new Map<string, PermissionLevel>();

  function ok<T>(data: T): { isSuccess: () => boolean; data: T } {
    return { isSuccess: () => true, data };
  }

  const rpc = {
    call: jest.fn(
      async (
        method: string,
        params: {
          sessionId?: string | null;
          enabled?: boolean;
          permissionLevel?: PermissionLevel;
        },
      ) => {
        if (method === 'config:autopilot-toggle') {
          if (params.sessionId) {
            liveLevels.set(
              params.sessionId,
              params.enabled ? (params.permissionLevel ?? 'ask') : 'ask',
            );
          }
          return ok({
            enabled: params.enabled,
            permissionLevel: params.permissionLevel,
          });
        }
        // config:autopilot-get
        return ok({
          enabled: false,
          permissionLevel: 'ask',
          ...(params.sessionId
            ? {
                sessionPermissionLevel:
                  liveLevels.get(params.sessionId) ?? null,
              }
            : {}),
        });
      },
    ),
  };

  async function settle(
    ...fixtures: ComponentFixture<AutopilotPopoverComponent>[]
  ): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixtures.forEach((f) => f.detectChanges());
    }
  }

  function label(f: ComponentFixture<AutopilotPopoverComponent>): string {
    const el = (f.nativeElement as HTMLElement).querySelector(
      '.ptah-composer-label',
    );
    return el?.textContent?.trim() ?? '';
  }

  function mount(
    sessionId: SessionId | null,
  ): ComponentFixture<AutopilotPopoverComponent> {
    const f = TestBed.createComponent(AutopilotPopoverComponent);
    f.componentRef.setInput('sessionId', sessionId);
    f.detectChanges();
    return f;
  }

  beforeEach(async () => {
    liveLevels.clear();
    liveLevels.set(TAB_SESSION, 'ask');
    liveLevels.set(OTHER_SESSION, 'auto-edit');
    rpc.call.mockClear();
    await TestBed.configureTestingModule({
      imports: [AutopilotPopoverComponent],
      providers: [{ provide: ClaudeRpcService, useValue: rpc }],
    }).compileComponents();
  });

  it("toggling in tab A leaves tab B's popover on B's own level", async () => {
    const tabA = mount(TAB_SESSION);
    const tabB = mount(OTHER_SESSION);
    await settle(tabA, tabB);
    expect(label(tabA)).toBe('Manual');
    expect(label(tabB)).toBe(PERMISSION_LEVEL_NAMES['auto-edit']);

    tabA.componentInstance.selectLevel('yolo');
    await tabA.componentInstance.enableAutopilot();
    await settle(tabA, tabB);

    expect(label(tabA)).toBe(PERMISSION_LEVEL_NAMES['yolo']);
    expect(label(tabB)).toBe(PERMISSION_LEVEL_NAMES['auto-edit']);
    expect(liveLevels.get(OTHER_SESSION)).toBe('auto-edit');

    // Opening B re-reads B from the host: still its own level.
    tabB.componentInstance.toggleDropdown();
    await settle(tabA, tabB);
    expect(label(tabB)).toBe(PERMISSION_LEVEL_NAMES['auto-edit']);
  });

  it('a fresh tab shows the saved default, which follows the last toggle', async () => {
    const tabA = mount(TAB_SESSION);
    const fresh = mount(null);
    await settle(tabA, fresh);

    tabA.componentInstance.selectLevel('yolo');
    await tabA.componentInstance.enableAutopilot();
    await settle(tabA, fresh);

    expect(label(fresh)).toBe(PERMISSION_LEVEL_NAMES['yolo']);
  });
});
