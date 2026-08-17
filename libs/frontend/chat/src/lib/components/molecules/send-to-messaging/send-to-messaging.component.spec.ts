import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { NativePopoverComponent } from '@ptah-extension/ui';
import {
  ClaudeRpcService,
  RpcResult,
  VSCodeService,
} from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type {
  GatewayBindingDto,
  GatewayPlatformId,
} from '@ptah-extension/shared';

import { SendToMessagingComponent } from './send-to-messaging.component';

/**
 * Stand-in for `NativePopoverComponent`. The real one drives `@floating-ui/dom`
 * against a live layout, which jsdom cannot provide; this keeps the open/closed
 * contract (and the `closed` output that Escape / outside-click both fire) while
 * rendering the projected slots synchronously.
 */
@Component({
  selector: 'ptah-native-popover',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-content select="[trigger]" />
    @if (isOpen()) {
      <ng-content select="[content]" />
    }
  `,
})
class StubNativePopoverComponent {
  readonly isOpen = input.required<boolean>();
  readonly placement = input<string>('bottom');
  readonly offset = input<number>(0);
  readonly hasBackdrop = input<boolean>(true);
  readonly backdropClass = input<'transparent' | 'dark'>('dark');
  readonly opened = output<void>();
  readonly closed = output<void>();
  readonly backdropClicked = output<void>();
}

interface FakeTab {
  id: string;
  claudeSessionId?: string | null;
  attachedBinding?: { bindingId: string; platform: GatewayPlatformId } | null;
}

function makeBinding(
  overrides: Partial<GatewayBindingDto> & { id: string },
): GatewayBindingDto {
  return {
    platform: 'telegram',
    externalChatId: 'chat-1',
    allowListId: null,
    displayName: null,
    approvalStatus: 'approved',
    ptahSessionId: null,
    workspaceRoot: null,
    pairingCode: null,
    createdAt: 0,
    approvedAt: null,
    lastActiveAt: null,
    ...overrides,
  };
}

const TELEGRAM_BINDING = makeBinding({
  id: 'b-tg',
  platform: 'telegram',
  displayName: 'Ops room',
});
const DISCORD_BINDING = makeBinding({
  id: 'b-dc',
  platform: 'discord',
  displayName: 'Guild',
});

function ok<T>(data: T): RpcResult<T> {
  return new RpcResult<T>(true, data);
}
function transportFail<T>(error: string): RpcResult<T> {
  return new RpcResult<T>(false, undefined, error);
}

interface SetupOptions {
  isElectron?: boolean;
  tabs?: FakeTab[];
  /** Adapters reported by `gateway:status`. */
  running?: Array<{ platform: GatewayPlatformId; running: boolean }>;
  bindings?: GatewayBindingDto[];
  /** Make `gateway:listBindings` fail at the transport level. */
  listFails?: boolean;
  /** Make `gateway:status` fail at the transport level. */
  statusFails?: boolean;
  workspacePath?: string | null;
  activeWorkspacePath?: string | null;
}

interface Harness {
  fixture: ComponentFixture<SendToMessagingComponent>;
  rpcCall: jest.Mock;
  tabs: ReturnType<typeof signal<FakeTab[]>>;
  el: HTMLElement;
}

const DEFAULT_TAB: FakeTab = {
  id: 'tab-1',
  claudeSessionId: 'sess-1',
  attachedBinding: null,
};

async function setup(options: SetupOptions = {}): Promise<Harness> {
  const {
    isElectron = true,
    tabs: initialTabs = [DEFAULT_TAB],
    running = [
      { platform: 'telegram', running: true },
      { platform: 'discord', running: true },
    ],
    bindings = [TELEGRAM_BINDING],
    listFails = false,
    statusFails = false,
    workspacePath = '/ws',
    activeWorkspacePath = '/ws',
  } = options;

  TestBed.resetTestingModule();

  const tabs = signal<FakeTab[]>(initialTabs);
  const rpcCall = jest.fn((method: string) => {
    switch (method) {
      case 'gateway:listBindings':
        return Promise.resolve(
          listFails ? transportFail('offline') : ok({ bindings }),
        );
      case 'gateway:status':
        return Promise.resolve(
          statusFails
            ? transportFail('offline')
            : ok({ enabled: true, adapters: running }),
        );
      case 'gateway:attachSession':
        return Promise.resolve(ok({ ok: true, binding: TELEGRAM_BINDING }));
      case 'gateway:detachSession':
        return Promise.resolve(ok({ ok: true, binding: TELEGRAM_BINDING }));
      default:
        return Promise.resolve(ok({}));
    }
  });

  await TestBed.configureTestingModule({
    imports: [SendToMessagingComponent],
    providers: [
      { provide: VSCodeService, useValue: { isElectron } },
      { provide: ClaudeRpcService, useValue: { call: rpcCall } },
      {
        provide: TabManagerService,
        useValue: {
          tabs,
          activeWorkspacePath,
          findTabBySessionIdAcrossWorkspaces: () =>
            workspacePath === null ? null : { workspacePath },
        },
      },
    ],
  })
    .overrideComponent(SendToMessagingComponent, {
      remove: { imports: [NativePopoverComponent] },
      add: { imports: [StubNativePopoverComponent] },
    })
    .compileComponents();

  const fixture = TestBed.createComponent(SendToMessagingComponent);
  fixture.componentRef.setInput('tabId', 'tab-1');
  fixture.detectChanges();

  return {
    fixture,
    rpcCall,
    tabs,
    el: fixture.nativeElement as HTMLElement,
  };
}

/**
 * Flush pending microtasks, then re-render.
 *
 * Deliberately NOT `fixture.whenStable()`: under the Zone test env that also
 * drains pending macrotasks, which fires the success line's auto-clear timer
 * and erases the very confirmation these tests assert on.
 */
async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
  fixture.detectChanges();
}

function byTestId(el: HTMLElement, id: string): HTMLElement | null {
  return el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

async function openPicker(h: Harness): Promise<void> {
  byTestId(h.el, 'tile-send-to-messaging-btn')?.click();
  await settle(h.fixture);
}

async function pickFirstRow(h: Harness, bindingId: string): Promise<void> {
  byTestId(h.el, `handoff-row-${bindingId}`)?.click();
  await settle(h.fixture);
}

describe('SendToMessagingComponent', () => {
  afterEach(() => {
    // Destroys the live fixture, which clears the success-line timer via
    // the component's DestroyRef hook.
    TestBed.resetTestingModule();
  });

  describe('runtime gate', () => {
    it('renders nothing outside Electron', async () => {
      const h = await setup({ isElectron: false });
      expect(byTestId(h.el, 'tile-send-to-messaging-btn')).toBeNull();
      expect(h.el.textContent?.trim()).toBe('');
    });

    it('renders the hand-off trigger in Electron', async () => {
      const h = await setup();
      const btn = byTestId(h.el, 'tile-send-to-messaging-btn');
      expect(btn).not.toBeNull();
      expect(btn?.textContent?.trim()).toBe('Hand off');
    });
  });

  describe('availability', () => {
    it('keeps the trigger visible but disabled when the tab has no session', async () => {
      const h = await setup({
        tabs: [{ id: 'tab-1', claudeSessionId: null }],
      });
      const btn = byTestId(h.el, 'tile-send-to-messaging-btn');
      expect(btn).not.toBeNull();
      expect((btn as HTMLButtonElement).disabled).toBe(true);
      expect(btn?.parentElement?.getAttribute('title')).toBe(
        'Hand off unavailable — no session yet — send a message first',
      );
    });

    it('explains an unresolved tab rather than vanishing', async () => {
      const h = await setup({ tabs: [] });
      const btn = byTestId(h.el, 'tile-send-to-messaging-btn');
      expect((btn as HTMLButtonElement).disabled).toBe(true);
      expect(btn?.parentElement?.getAttribute('title')).toBe(
        'Hand off unavailable — this tile has no chat tab yet',
      );
    });

    it('enables the trigger and labels the action when a session exists', async () => {
      const h = await setup();
      const btn = byTestId(h.el, 'tile-send-to-messaging-btn');
      expect((btn as HTMLButtonElement).disabled).toBe(false);
      expect(btn?.parentElement?.getAttribute('title')).toBe(
        'Hand off session to…',
      );
      expect(btn?.getAttribute('aria-label')).toBe('Hand off session to…');
    });

    it('does not open the picker while disabled', async () => {
      const h = await setup({
        tabs: [{ id: 'tab-1', claudeSessionId: null }],
      });
      await openPicker(h);
      expect(byTestId(h.el, 'handoff-picker')).toBeNull();
      expect(h.rpcCall).not.toHaveBeenCalled();
    });
  });

  describe('picker states', () => {
    it('states the read-only consequence in the picker header', async () => {
      const h = await setup();
      await openPicker(h);
      const picker = byTestId(h.el, 'handoff-picker');
      expect(picker?.textContent).toContain('Hand off session to…');
      expect(picker?.textContent).toContain(
        'The platform you pick takes over this tab.',
      );
    });

    it('loads approved bindings and adapter status together', async () => {
      const h = await setup();
      await openPicker(h);
      expect(h.rpcCall).toHaveBeenCalledWith('gateway:listBindings', {
        status: 'approved',
      });
      expect(h.rpcCall).toHaveBeenCalledWith('gateway:status', {});
      expect(byTestId(h.el, 'handoff-row-b-tg')?.textContent).toContain(
        'Telegram · Ops room',
      );
    });

    it('shows a loading line before the bindings resolve', async () => {
      const h = await setup();
      byTestId(h.el, 'tile-send-to-messaging-btn')?.click();
      h.fixture.detectChanges();
      expect(byTestId(h.el, 'handoff-picker-loading')).not.toBeNull();
      await settle(h.fixture);
      expect(byTestId(h.el, 'handoff-picker-loading')).toBeNull();
    });

    it('shows the empty state when nothing is approved', async () => {
      const h = await setup({ bindings: [] });
      await openPicker(h);
      expect(byTestId(h.el, 'handoff-picker-empty')?.textContent).toContain(
        'No approved bindings. Approve one in the Gateway tab first.',
      );
    });

    it('shows a load error with a retry that refetches', async () => {
      const h = await setup({ listFails: true });
      await openPicker(h);
      expect(
        byTestId(h.el, 'handoff-picker-load-error')?.textContent,
      ).toContain('Couldn’t load messaging bindings.');

      h.rpcCall.mockClear();
      byTestId(h.el, 'handoff-picker-retry')?.click();
      await settle(h.fixture);
      expect(h.rpcCall).toHaveBeenCalledWith('gateway:listBindings', {
        status: 'approved',
      });
    });

    it('greys out and disables a binding whose adapter is stopped', async () => {
      const h = await setup({
        bindings: [TELEGRAM_BINDING, DISCORD_BINDING],
        running: [
          { platform: 'telegram', running: true },
          { platform: 'discord', running: false },
        ],
      });
      await openPicker(h);

      const online = byTestId(h.el, 'handoff-row-b-tg') as HTMLButtonElement;
      const offline = byTestId(h.el, 'handoff-row-b-dc') as HTMLButtonElement;
      expect(online.disabled).toBe(false);
      expect(offline.disabled).toBe(true);
      expect(offline.textContent).toContain(
        'platform offline — start it in Gateway tab',
      );

      offline.click();
      await settle(h.fixture);
      expect(byTestId(h.el, 'handoff-confirm')).toBeNull();
    });

    it('leaves rows selectable when the status probe fails', async () => {
      const h = await setup({ statusFails: true });
      await openPicker(h);
      const row = byTestId(h.el, 'handoff-row-b-tg') as HTMLButtonElement;
      expect(row.disabled).toBe(false);
      expect(byTestId(h.el, 'handoff-row-offline')).toBeNull();
    });

    it('closes on the popover closed output (Escape / outside click)', async () => {
      const h = await setup();
      await openPicker(h);
      expect(byTestId(h.el, 'handoff-picker')).not.toBeNull();

      const popover = h.fixture.debugElement.children[0].children[0];
      popover.triggerEventHandler('closed', undefined);
      await settle(h.fixture);
      expect(byTestId(h.el, 'handoff-picker')).toBeNull();
    });
  });

  describe('attach', () => {
    it('requires an explicit confirm naming the consequence', async () => {
      const h = await setup();
      await openPicker(h);
      await pickFirstRow(h, 'b-tg');

      expect(byTestId(h.el, 'handoff-confirm')?.textContent).toContain(
        'This tab becomes read-only and is driven from Telegram · Ops room. Continue?',
      );
      expect(h.rpcCall).not.toHaveBeenCalledWith(
        'gateway:attachSession',
        expect.anything(),
      );
    });

    it('cancel drops the confirm without attaching', async () => {
      const h = await setup();
      await openPicker(h);
      await pickFirstRow(h, 'b-tg');
      byTestId(h.el, 'handoff-confirm-cancel')?.click();
      await settle(h.fixture);

      expect(byTestId(h.el, 'handoff-confirm')).toBeNull();
      expect(h.rpcCall).not.toHaveBeenCalledWith(
        'gateway:attachSession',
        expect.anything(),
      );
    });

    it('attaches on confirm, closes the picker and confirms success', async () => {
      const h = await setup();
      await openPicker(h);
      await pickFirstRow(h, 'b-tg');
      byTestId(h.el, 'handoff-confirm-continue')?.click();
      await settle(h.fixture);

      expect(h.rpcCall).toHaveBeenCalledWith('gateway:attachSession', {
        bindingId: 'b-tg',
        sessionUuid: 'sess-1',
        workspaceRoot: '/ws',
        externalConversationId: 'default',
      });
      expect(byTestId(h.el, 'handoff-picker')).toBeNull();
      expect(byTestId(h.el, 'handoff-result')?.textContent?.trim()).toBe(
        'Attached to Telegram',
      );
    });

    it('guards against a double-click while the attach is in flight', async () => {
      const h = await setup();
      let release: (() => void) | undefined;
      h.rpcCall.mockImplementation((method: string) => {
        if (method === 'gateway:attachSession') {
          return new Promise((resolve) => {
            release = () =>
              resolve(ok({ ok: true, binding: TELEGRAM_BINDING }));
          });
        }
        if (method === 'gateway:status') {
          return Promise.resolve(
            ok({
              enabled: true,
              adapters: [{ platform: 'telegram', running: true }],
            }),
          );
        }
        return Promise.resolve(ok({ bindings: [TELEGRAM_BINDING] }));
      });

      await openPicker(h);
      await pickFirstRow(h, 'b-tg');

      const confirm = byTestId(h.el, 'handoff-confirm-continue') as HTMLElement;
      confirm.click();
      confirm.click();
      confirm.click();

      const attachCalls = h.rpcCall.mock.calls.filter(
        ([method]) => method === 'gateway:attachSession',
      );
      expect(attachCalls).toHaveLength(1);
      release?.();
      await settle(h.fixture);
    });

    it('keeps the picker open and pins a resumability error to its row', async () => {
      const h = await setup();
      h.rpcCall.mockImplementation((method: string) => {
        if (method === 'gateway:attachSession') {
          return Promise.resolve(
            ok({ ok: false, error: 'session-not-resumable' }),
          );
        }
        if (method === 'gateway:status') {
          return Promise.resolve(
            ok({
              enabled: true,
              adapters: [{ platform: 'telegram', running: true }],
            }),
          );
        }
        return Promise.resolve(ok({ bindings: [TELEGRAM_BINDING] }));
      });

      await openPicker(h);
      await pickFirstRow(h, 'b-tg');
      byTestId(h.el, 'handoff-confirm-continue')?.click();
      await settle(h.fixture);

      expect(byTestId(h.el, 'handoff-picker')).not.toBeNull();
      expect(byTestId(h.el, 'handoff-row-error-b-tg')?.textContent).toContain(
        'This session has no saved turn yet, so it can’t be resumed from a messaging app.',
      );
    });

    it('maps an offline-adapter rejection to a start-it-in-Gateway message', async () => {
      const h = await setup();
      h.rpcCall.mockImplementation((method: string) => {
        if (method === 'gateway:attachSession') {
          return Promise.resolve(
            ok({ ok: false, error: 'adapter-not-running' }),
          );
        }
        if (method === 'gateway:status') {
          return Promise.resolve(
            ok({
              enabled: true,
              adapters: [{ platform: 'telegram', running: true }],
            }),
          );
        }
        return Promise.resolve(ok({ bindings: [TELEGRAM_BINDING] }));
      });

      await openPicker(h);
      await pickFirstRow(h, 'b-tg');
      byTestId(h.el, 'handoff-confirm-continue')?.click();
      await settle(h.fixture);

      expect(byTestId(h.el, 'handoff-row-error-b-tg')?.textContent).toContain(
        'Telegram isn’t running — start it in the Gateway tab, then try again.',
      );
    });

    it('gives recovery guidance when the workspace cannot be resolved', async () => {
      const h = await setup({ workspacePath: null, activeWorkspacePath: null });
      await openPicker(h);
      await pickFirstRow(h, 'b-tg');
      byTestId(h.el, 'handoff-confirm-continue')?.click();
      await settle(h.fixture);

      expect(byTestId(h.el, 'handoff-row-error-b-tg')?.textContent).toContain(
        'Open the tab’s project folder in Ptah, or reopen the tab from its workspace, then try again.',
      );
      expect(h.rpcCall).not.toHaveBeenCalledWith(
        'gateway:attachSession',
        expect.anything(),
      );
    });
  });

  describe('detach', () => {
    const attachedTab: FakeTab = {
      id: 'tab-1',
      claudeSessionId: 'sess-1',
      attachedBinding: { bindingId: 'b-tg', platform: 'telegram' },
    };

    it('shows the attached indicator instead of the trigger', async () => {
      const h = await setup({ tabs: [attachedTab] });
      expect(byTestId(h.el, 'tile-send-to-messaging-btn')).toBeNull();
      const btn = byTestId(h.el, 'tile-resolve-back-btn');
      expect(btn?.textContent).toContain('Telegram');
      expect(btn?.getAttribute('title')).toBe(
        'Session is driven from Telegram — resolve it back to the webview',
      );
    });

    it('detaches without a confirm and reports success', async () => {
      const h = await setup({ tabs: [attachedTab] });
      byTestId(h.el, 'tile-resolve-back-btn')?.click();
      await settle(h.fixture);

      expect(h.rpcCall).toHaveBeenCalledWith('gateway:detachSession', {
        bindingId: 'b-tg',
      });
      expect(byTestId(h.el, 'handoff-result')?.textContent?.trim()).toBe(
        'Resolved back to webview',
      );
    });

    it('surfaces a detach failure inline', async () => {
      const h = await setup({ tabs: [attachedTab] });
      h.rpcCall.mockResolvedValue(
        ok({ ok: false, error: 'binding-not-found' }),
      );

      byTestId(h.el, 'tile-resolve-back-btn')?.click();
      await settle(h.fixture);

      const result = byTestId(h.el, 'handoff-result');
      expect(result?.textContent).toContain(
        'That binding no longer exists — this tab is already back on the webview.',
      );
      expect(result?.getAttribute('role')).toBe('alert');
    });

    it('guards against a double-click while the detach is in flight', async () => {
      const h = await setup({ tabs: [attachedTab] });
      let release: (() => void) | undefined;
      h.rpcCall.mockImplementation(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve(ok({ ok: true, binding: TELEGRAM_BINDING }));
          }),
      );

      const btn = byTestId(h.el, 'tile-resolve-back-btn') as HTMLElement;
      btn.click();
      btn.click();

      expect(
        h.rpcCall.mock.calls.filter(
          ([method]) => method === 'gateway:detachSession',
        ),
      ).toHaveLength(1);
      release?.();
      await settle(h.fixture);
    });
  });
});
